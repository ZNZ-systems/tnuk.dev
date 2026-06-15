import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import { loadOpenAIAuthMode, openaiModel, openaiTimeoutMs } from "../../config.js";
import {
  REVIEW_TOOL_NAMES,
  ReviewEvidenceTracker,
  ReviewToolRegistry,
  type ReviewToolExecution,
} from "../tools.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ReviewBackend,
} from "../backend.js";
import type { OpenAITransport } from "./openai-transport.js";

const MAX_TOOL_ROUNDS = 24;

const SYSTEM_INSTRUCTIONS = [
  "You are an automated pre-push code-quality review gate.",
  "You have sandboxed repository tools scoped to the repo and commit range in the user message.",
  "You are not a diff summarizer: inspect the diff, commits, and changed files before giving a verdict.",
  "Start with git_diff mode=stat, git_diff mode=name-status, and git_log; then inspect per-file diffs/read files as needed.",
  "Tool outputs never silently truncate: if a tool reports output_too_large, narrow by path or line range and continue.",
  "If you cannot inspect enough evidence to satisfy the gate, fail closed with VERDICT: BLOCK and explain the missing evidence.",
  "Do not ask the user for more files. Respond exactly in the verdict format specified by the user message.",
].join(" ");

function buildUserInput(prompt: string): string {
  return [
    prompt,
    "",
    "## OpenAI backend evidence protocol",
    "- Use the provided git/file tools to gather evidence; no diff is pre-inlined.",
    "- Broad diffs may be too large by design. Use name-status/stat first, then per-file git_diff and read_file calls.",
    "- Treat tool errors or incomplete evidence as a gate failure, not as permission to guess PASS.",
  ].join("\n");
}

async function resolveTransport(): Promise<OpenAITransport> {
  const authMode = loadOpenAIAuthMode();
  if (authMode === "api") {
    const { createOpenAIApiTransport } = await import("./openai-api-transport.js");
    return createOpenAIApiTransport();
  }
  const { createChatGptCodexTransport } = await import("./chatgpt-codex-transport.js");
  return createChatGptCodexTransport();
}

function isFunctionCall(item: { type?: unknown }): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

type ParsedArguments =
  | { ok: true; value: unknown }
  | { ok: false; message: string; raw: string };

function parseArguments(call: ResponseFunctionToolCall): ParsedArguments {
  if (!call.arguments.trim()) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(call.arguments) as unknown };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message, raw: call.arguments };
  }
}

function describeToolCall(call: ResponseFunctionToolCall, args: ParsedArguments): string {
  if (!args.ok || typeof args.value !== "object" || args.value === null) {
    return call.name;
  }
  const obj = args.value as Record<string, unknown>;
  const details: string[] = [];
  for (const key of ["mode", "kind", "format", "path", "startLine", "endLine"] as const) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") {
      details.push(`${key}=${String(value)}`);
    }
  }
  return details.length ? `${call.name} ${details.join(" ")}` : call.name;
}

function executeCall(
  registry: ReviewToolRegistry,
  call: ResponseFunctionToolCall,
  parsedArgs: ParsedArguments,
): ReviewToolExecution {
  if (!parsedArgs.ok) {
    return registry.invalidArguments(call.name, parsedArgs.message, parsedArgs.raw);
  }
  return registry.execute(call.name, parsedArgs.value);
}

function evidenceError(evidence: ReviewEvidenceTracker): BackendError {
  return new BackendError(
    "OpenAI returned a final answer before collecting required review evidence " +
      `(missing: ${evidence.missingLabels().join(", ")}). Refusing to parse or emit a verdict on incomplete evidence.`,
    "agent",
  );
}

function mirrorReview(rawText: string): void {
  if (!rawText.trim()) {
    return;
  }
  process.stderr.write("[thermo-review] review:\n");
  process.stderr.write(rawText.endsWith("\n") ? rawText : `${rawText}\n`);
}

/**
 * OpenAI backend: stable official API by default, experimental ChatGPT/Codex via
 * an isolated transport adapter. Both modes share the same sandboxed tool loop
 * and backend-enforced evidence state machine.
 */
export class OpenAIBackend implements ReviewBackend {
  readonly id = "openai" as const;
  readonly capabilities = {
    canInspectRepository: true,
    inspection: "sandboxed-tools",
    tools: REVIEW_TOOL_NAMES,
  } as const;

  async preflight(): Promise<void> {
    try {
      await resolveTransport();
    } catch (err) {
      throw err instanceof BackendError
        ? err
        : new BackendError(err instanceof Error ? err.message : String(err), "config");
    }
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    const transport = await resolveTransport();
    const model = openaiModel();
    const input: ResponseInput = [{ role: "user", content: buildUserInput(prompt) }];
    const registry = new ReviewToolRegistry(scope);
    const evidence = new ReviewEvidenceTracker();

    onProgress(
      `contacting OpenAI (auth=${transport.id}, model=${model}, high reasoning, sandboxed repo tools)…`,
    );

    const timeoutMs = openaiTimeoutMs();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
        if (round > 1) {
          onProgress(`continuing OpenAI tool loop (${round}/${MAX_TOOL_ROUNDS})…`);
        }

        const roundResult = await transport.runToolRound({
          model,
          instructions: SYSTEM_INSTRUCTIONS,
          input,
          tools: registry.openAITools(),
          signal: controller.signal,
        });

        const functionCalls = roundResult.outputItems.filter(isFunctionCall);
        if (functionCalls.length > 0) {
          const outputs: ResponseInputItem[] = [];
          for (const call of functionCalls) {
            const parsedArgs = parseArguments(call);
            onProgress(`tool: ${describeToolCall(call, parsedArgs)}`);
            const toolExecution = executeCall(registry, call, parsedArgs);
            evidence.record(toolExecution);
            outputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: toolExecution.output,
            });
          }
          input.push(...roundResult.outputItems, ...outputs);
          continue;
        }

        const rawText = roundResult.rawText;
        if (rawText.trim()) {
          if (!evidence.isSatisfied()) {
            throw evidenceError(evidence);
          }
          mirrorReview(rawText);
          return { rawText, runId: roundResult.responseId, agentId: undefined };
        }

        if (roundResult.incompleteDetails) {
          throw new Error(`response incomplete: ${JSON.stringify(roundResult.incompleteDetails)}`);
        }
        throw new Error("response completed without final text or tool calls");
      }

      throw new Error(
        `OpenAI exceeded ${MAX_TOOL_ROUNDS} tool rounds without a verdict; refusing to guess on incomplete evidence.`,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        throw new BackendError(
          `Review timed out after ${Math.round(timeoutMs / 1000)}s with no completion. ` +
            "Try a smaller diff (--base <ref>), a faster THERMO_REVIEW_OPENAI_MODEL, or raise THERMO_REVIEW_OPENAI_TIMEOUT_MS.",
          "agent",
        );
      }
      throw transport.mapError(err);
    } finally {
      clearTimeout(deadline);
    }
  }
}

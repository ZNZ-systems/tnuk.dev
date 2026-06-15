import OpenAI from "openai";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
  Tool,
} from "openai/resources/responses/responses";

import { CHATGPT_CODEX_BASE_URL, chatGptBackendHeaders } from "../../auth/openai-private-backend.js";
import { getValidCredentials } from "../../auth/token-store.js";
import {
  loadOpenAIApiKey,
  loadOpenAIAuthMode,
  openaiModel,
  openaiTimeoutMs,
  type OpenAIAuthMode,
} from "../../config.js";
import { executeReviewTool, REVIEW_TOOLS } from "../tools.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ReviewBackend,
} from "../backend.js";

const REQUEST_TIMEOUT_MS = 600_000;
const MAX_TOOL_ROUNDS = 24;

const MISSING_OPENAI_API_KEY_MESSAGE =
  "OPENAI_API_KEY not set for the OpenAI provider.\n" +
  '  export OPENAI_API_KEY="sk-..."\n' +
  "  or add it to ~/.config/thermo-review/env\n" +
  "  (Experimental ChatGPT OAuth requires THERMO_REVIEW_OPENAI_AUTH=chatgpt.)";

const SYSTEM_INSTRUCTIONS = [
  "You are an automated pre-push code-quality review gate.",
  "You have sandboxed repository tools scoped to the repo and commit range in the user message.",
  "You are not a diff summarizer: inspect the diff, commits, and changed files before giving a verdict.",
  "Start with git_diff mode=stat, git_diff mode=name-status, and git_log; then inspect per-file diffs/read files as needed.",
  "Tool outputs never silently truncate: if a tool reports output_too_large, narrow by path or line range and continue.",
  "If you cannot inspect enough evidence to satisfy the gate, fail closed with VERDICT: BLOCK and explain the missing evidence.",
  "Do not ask the user for more files. Respond exactly in the verdict format specified by the user message.",
].join(" ");

interface ClientBundle {
  client: OpenAI;
  authMode: OpenAIAuthMode;
}

function buildOfficialClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
}

async function buildChatGptClient(): Promise<OpenAI> {
  const creds = await getValidCredentials();
  return new OpenAI({
    baseURL: CHATGPT_CODEX_BASE_URL,
    apiKey: creds.accessToken,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: chatGptBackendHeaders(creds.accountId),
  });
}

async function buildClient(): Promise<ClientBundle> {
  const authMode = loadOpenAIAuthMode();
  if (authMode === "api") {
    const apiKey = loadOpenAIApiKey();
    if (!apiKey) {
      throw new BackendError(MISSING_OPENAI_API_KEY_MESSAGE, "config");
    }
    return { client: buildOfficialClient(apiKey), authMode };
  }
  return { client: await buildChatGptClient(), authMode };
}

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

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function parseArguments(call: ResponseFunctionToolCall): unknown {
  if (!call.arguments.trim()) {
    return {};
  }
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { __invalidJson: message, raw: call.arguments };
  }
}

function describeToolCall(call: ResponseFunctionToolCall, args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return call.name;
  }
  const obj = args as Record<string, unknown>;
  const details: string[] = [];
  for (const key of ["mode", "kind", "format", "path", "startLine", "endLine"] as const) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") {
      details.push(`${key}=${String(value)}`);
    }
  }
  return details.length ? `${call.name} ${details.join(" ")}` : call.name;
}

function invalidJsonOutput(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  const obj = args as Record<string, unknown>;
  const message = obj["__invalidJson"];
  if (typeof message !== "string") {
    return undefined;
  }
  return JSON.stringify({ ok: false, error: "invalid_arguments_json", message, raw: obj["raw"] });
}

function extractText(response: Response): string {
  if (response.output_text) {
    return response.output_text;
  }
  const chunks: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }
    for (const block of item.content) {
      if (block.type === "output_text") {
        chunks.push(block.text);
      }
    }
  }
  return chunks.join("");
}

function mirrorReview(rawText: string): void {
  if (!rawText.trim()) {
    return;
  }
  process.stderr.write("[thermo-review] review:\n");
  process.stderr.write(rawText.endsWith("\n") ? rawText : `${rawText}\n`);
}

function mapError(err: unknown, authMode: OpenAIAuthMode): BackendError {
  if (err instanceof BackendError) {
    return err;
  }
  const status = (err as { status?: unknown }).status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403 || /invalid_grant|unauthorized/i.test(message)) {
    if (authMode === "chatgpt") {
      return new BackendError(
        `OpenAI ChatGPT auth rejected${typeof status === "number" ? ` (${status})` : ""}. Run \`thermo-review login\` again.`,
        "config",
      );
    }
    return new BackendError(
      `OpenAI API key rejected${typeof status === "number" ? ` (${status})` : ""}. Check OPENAI_API_KEY.`,
      "config",
    );
  }
  if (status === 404 || /model.*not found|not supported/i.test(message)) {
    return new BackendError(
      `Model "${openaiModel()}" is not available for this OpenAI auth mode. Set THERMO_REVIEW_OPENAI_MODEL to one it serves.`,
      "agent",
    );
  }
  return new BackendError(`OpenAI review failed: ${message}`, "agent");
}

/**
 * Reviews via an OpenAI Responses tool loop. The stable mode uses the official
 * OpenAI API key; the experimental ChatGPT OAuth transport is available only
 * when explicitly selected by THERMO_REVIEW_OPENAI_AUTH=chatgpt.
 */
export class OpenAIBackend implements ReviewBackend {
  readonly id = "openai" as const;
  readonly capabilities = {
    canInspectRepository: true,
    inspection: "sandboxed-tools",
    tools: ["git_diff", "git_log", "list_files", "read_file"],
  } as const;

  async preflight(): Promise<void> {
    try {
      await buildClient();
    } catch (err) {
      throw err instanceof BackendError
        ? err
        : new BackendError(err instanceof Error ? err.message : String(err), "config");
    }
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    const { client, authMode } = await buildClient();
    const model = openaiModel();
    const input: ResponseInput = [{ role: "user", content: buildUserInput(prompt) }];

    onProgress(
      `contacting OpenAI (auth=${authMode}, model=${model}, high reasoning, sandboxed repo tools)…`,
    );

    const timeoutMs = openaiTimeoutMs();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
        if (round > 1) {
          onProgress(`continuing OpenAI tool loop (${round}/${MAX_TOOL_ROUNDS})…`);
        }

        const response = await client.responses.create(
          {
            model,
            instructions: SYSTEM_INSTRUCTIONS,
            input,
            include: ["reasoning.encrypted_content"],
            tools: [...REVIEW_TOOLS] as Tool[],
            tool_choice: "auto",
            parallel_tool_calls: true,
            stream: false,
            store: false,
            reasoning: { effort: "high" },
            truncation: "disabled",
          },
          { signal: controller.signal },
        );

        if (response.error) {
          throw new Error(`${response.error.code}: ${response.error.message}`);
        }

        const functionCalls = response.output.filter(isFunctionCall);
        if (functionCalls.length > 0) {
          const outputs: ResponseInputItem[] = [];
          for (const call of functionCalls) {
            const args = parseArguments(call);
            onProgress(`tool: ${describeToolCall(call, args)}`);
            outputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: invalidJsonOutput(args) ?? executeReviewTool(scope, call.name, args),
            });
          }
          input.push(...(response.output as ResponseInputItem[]), ...outputs);
          continue;
        }

        const rawText = extractText(response);
        if (rawText.trim()) {
          mirrorReview(rawText);
          return { rawText, runId: response.id, agentId: undefined };
        }

        if (response.incomplete_details) {
          throw new Error(`response incomplete: ${JSON.stringify(response.incomplete_details)}`);
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
      throw mapError(err, authMode);
    } finally {
      clearTimeout(deadline);
    }
  }
}

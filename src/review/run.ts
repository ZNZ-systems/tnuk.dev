import { Agent, CursorAgentError, CursorSdkError, type SDKMessage } from "@cursor/sdk";

import { loadReviewCredentials, loadSkillContent, TNUK_API_BASE_URL } from "../config.js";
import type { ReviewOutputOptions, ReviewResult, ReviewScope } from "../types.js";
import {
  formatBlockedOutput,
  formatPassOutput,
  writeLastReview,
} from "./format-blocked.js";
import { parseVerdict } from "./parse-verdict.js";
import { buildReviewPrompt } from "./prompt.js";

function logProgress(message: string): void {
  process.stderr.write(`[thermo-review] ${message}\n`);
}

class SeatProxyError extends Error {
  readonly exitCode = 1;

  constructor(message: string) {
    super(message);
    this.name = "SeatProxyError";
  }
}

function writeSeatInactiveError(): void {
  process.stderr.write(
    "Error: your tnuk seat is not active.\n" +
      "  - Run `tnuk login` to re-authenticate, or\n" +
      "  - Ask your org admin to confirm your team subscription at https://tnuk.dev\n",
  );
}

function mapSeatProxyError(err: unknown): SeatProxyError | null {
  if (!(err instanceof CursorSdkError || err instanceof CursorAgentError)) {
    return null;
  }
  const status = (err as CursorSdkError).status;
  if (status !== 401 && status !== 402 && status !== 403) {
    return null;
  }
  return new SeatProxyError(err.message);
}

/** Temporarily point the SDK at the tnuk Worker proxy; restores env on exit. */
async function withSeatBackend<T>(baseUrl: string, fn: () => Promise<T>): Promise<T> {
  const prevBase = process.env["CURSOR_API_BASE_URL"];
  const prevBackend = process.env["CURSOR_BACKEND_URL"];
  process.env["CURSOR_API_BASE_URL"] = baseUrl;
  process.env["CURSOR_BACKEND_URL"] = baseUrl;
  try {
    return await fn();
  } catch (err) {
    const seatErr = mapSeatProxyError(err);
    if (seatErr) throw seatErr;
    throw err;
  } finally {
    if (prevBase === undefined) delete process.env["CURSOR_API_BASE_URL"];
    else process.env["CURSOR_API_BASE_URL"] = prevBase;
    if (prevBackend === undefined) delete process.env["CURSOR_BACKEND_URL"];
    else process.env["CURSOR_BACKEND_URL"] = prevBackend;
  }
}

async function streamReviewText(stream: AsyncGenerator<SDKMessage, void>): Promise<string> {
  const chunks: string[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case "assistant":
        for (const block of event.message.content) {
          if (block.type === "text") {
            chunks.push(block.text);
          }
        }
        break;
      case "thinking":
        logProgress("thinking…");
        break;
      case "tool_call":
        logProgress(`tool: ${event.name} (${event.status})`);
        break;
      case "status":
        logProgress(`status: ${event.status}`);
        break;
      default:
        break;
    }
  }

  return chunks.join("");
}

/**
 * Runs thermo-nuclear review via local Cursor SDK agent.
 */
export async function runReview(
  scope: ReviewScope,
  options: ReviewOutputOptions & { failClosed?: boolean },
): Promise<{ exitCode: number; result?: ReviewResult }> {
  const credentials = loadReviewCredentials();
  if (!credentials) {
    process.stderr.write(
      "Error: no review credentials.\n" +
        "  Team seat: run `tnuk login`, or set TNUK_TOKEN\n" +
        "  Local dev:  set CURSOR_API_KEY or add it to ~/.config/thermo-review/env\n",
    );
    return { exitCode: 1 };
  }

  const failClosed = options.failClosed ?? true;
  const run = () =>
    runReviewAgent({
      apiKey: credentials.apiKey,
      scope,
      options,
      failClosed,
    });

  try {
    if (credentials.mode === "seat") {
      return await withSeatBackend(TNUK_API_BASE_URL, run);
    }
    return await run();
  } catch (err) {
    if (err instanceof SeatProxyError) {
      writeSeatInactiveError();
      return { exitCode: err.exitCode };
    }
    throw err;
  }
}

async function runReviewAgent(args: {
  apiKey: string;
  scope: ReviewScope;
  options: ReviewOutputOptions;
  failClosed: boolean;
}): Promise<{ exitCode: number; result?: ReviewResult }> {
  const { apiKey, scope, options, failClosed } = args;

  let skillContent: string;
  try {
    skillContent = loadSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    return { exitCode: 1 };
  }

  const prompt = buildReviewPrompt(skillContent, scope);
  logProgress(`Reviewing ${scope.description}`);

  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: "composer-2.5" },
      local: {
        cwd: scope.repoRoot,
        // Skill rubric is inlined in the prompt — skip plugins to avoid double-loading it.
        settingSources: ["project", "user"],
      },
    });

    const run = await agent.send(prompt);
    logProgress(`run started: ${run.id}`);

    const textPromise = streamReviewText(run.stream());
    const waitResult = await run.wait();
    const streamedText = await textPromise;
    const rawText = streamedText || waitResult.result || run.result || "";

    if (waitResult.status === "error") {
      process.stderr.write(`Error: agent run failed (${waitResult.id})\n`);
      return { exitCode: 2 };
    }

    const parsed = parseVerdict(rawText, failClosed);
    const reviewResult: ReviewResult = {
      parsed,
      runId: waitResult.id,
      agentId: run.agentId,
      rawText,
    };

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          verdict: parsed.verdict,
          summary: parsed.summary,
          review: parsed.body,
          runId: waitResult.id,
          agentId: run.agentId,
          parseFailed: parsed.parseFailed,
        })}\n`,
      );
    } else if (options.quiet) {
      process.stdout.write(`VERDICT: ${parsed.verdict} — ${parsed.summary}\n`);
    } else if (parsed.verdict === "BLOCK") {
      const formatted = formatBlockedOutput(parsed, scope);
      process.stdout.write(`${formatted}\n`);
      writeLastReview(scope.repoRoot, formatted);
    } else {
      process.stdout.write(`${formatPassOutput(parsed)}\n`);
    }

    return {
      exitCode: parsed.verdict === "BLOCK" ? 3 : 0,
      result: reviewResult,
    };
  } catch (err) {
    if (err instanceof CursorSdkError || err instanceof CursorAgentError) {
      process.stderr.write(
        `Error: review failed: ${err.message} (retryable=${String(err.isRetryable)})\n`,
      );
      return { exitCode: 1 };
    }
    throw err;
  }
}

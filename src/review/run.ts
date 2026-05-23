import { Agent, CursorAgentError, type SDKMessage } from "@cursor/sdk";

import { exchangeAuthToken, sessionFailureExit } from "../auth/session.js";
import { loadSkillContent } from "../config.js";
import type { ReviewOutputOptions, ReviewResult, ReviewScope } from "../types.js";
import {
  formatBlockedOutput,
  formatPassOutput,
  writeLastReview,
} from "./format-blocked.js";
import { parseVerdict } from "./parse-verdict.js";
import { buildReviewPrompt } from "./prompt.js";

function logProgress(message: string): void {
  process.stderr.write(`[tnuk] ${message}\n`);
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
  const session = await exchangeAuthToken();
  if (!session.ok) {
    return { exitCode: sessionFailureExit(session) };
  }

  let skillContent: string;
  try {
    skillContent = loadSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tnuk: ${message}\n`);
    return { exitCode: 1 };
  }

  const prompt = buildReviewPrompt(skillContent, scope);
  const failClosed = options.failClosed ?? true;
  const apiKey = session.cursorApiKey;

  logProgress(`Reviewing ${scope.description}`);

  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: "composer-2.5" },
      local: {
        cwd: scope.repoRoot,
        settingSources: ["project", "plugins", "user"],
      },
    });

    const run = await agent.send(prompt);
    logProgress(`run started: ${run.id}`);

    const textPromise = streamReviewText(run.stream());
    const waitResult = await run.wait();
    const streamedText = await textPromise;
    const rawText = streamedText || waitResult.result || run.result || "";

    if (waitResult.status === "error") {
      process.stderr.write(`tnuk: agent run failed (${waitResult.id})\n`);
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
    if (err instanceof CursorAgentError) {
      if (err.isRetryable) {
        process.stderr.write("tnuk: skipped (Cursor service unavailable)\n");
        return { exitCode: 0 };
      }
      process.stderr.write(`tnuk: SDK startup failed: ${err.message}\n`);
      return { exitCode: 1 };
    }
    throw err;
  }
}

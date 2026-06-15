import { loadSkillContent } from "../config.js";
import { scopeHasChanges } from "../git/push-scope.js";
import type { ParsedVerdict, ReviewOutputOptions, ReviewResult, ReviewScope } from "../types.js";
import { BackendError, type BackendRunOutput, type ProviderId } from "./backend.js";
import { formatBlockedOutput, formatPassOutput, writeLastReview } from "./format-blocked.js";
import { parseVerdict } from "./parse-verdict.js";
import { buildReviewPrompt } from "./prompt.js";
import { resolveBackend } from "./provider.js";

function logProgress(message: string): void {
  process.stderr.write(`[thermo-review] ${message}\n`);
}

/** Writes the verdict to stdout in the requested format and persists blocks. */
function emitVerdict(
  parsed: ParsedVerdict,
  scope: ReviewScope,
  options: ReviewOutputOptions,
  ids: { runId: string | undefined; agentId: string | undefined },
): void {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        verdict: parsed.verdict,
        summary: parsed.summary,
        review: parsed.body,
        runId: ids.runId,
        agentId: ids.agentId,
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
}

/**
 * Runs the thermo-nuclear review. Owns skill loading, prompt building, verdict
 * parsing, output formatting, and exit codes; delegates the actual agent run to
 * the selected backend (Cursor SDK or OpenAI Responses tool loop).
 */
export async function runReview(
  scope: ReviewScope,
  options: ReviewOutputOptions & { failClosed?: boolean; provider?: ProviderId },
): Promise<{ exitCode: number; result?: ReviewResult }> {
  const failClosed = options.failClosed ?? true;

  if (!scopeHasChanges(scope)) {
    const parsed: ParsedVerdict = {
      verdict: "PASS",
      summary: "No changes in review range; nothing to review.",
      body: "",
      parseFailed: false,
    };
    emitVerdict(parsed, scope, options, { runId: undefined, agentId: undefined });
    return {
      exitCode: 0,
      result: { parsed, runId: undefined, agentId: undefined, rawText: "" },
    };
  }

  const backend = await resolveBackend(options.provider);
  if (!backend.capabilities.canInspectRepository) {
    process.stderr.write(
      `Error: provider "${backend.id}" cannot inspect the repository; refusing to run a diff-only review gate.\n`,
    );
    return { exitCode: 2 };
  }

  try {
    await backend.preflight();
  } catch (err) {
    if (err instanceof BackendError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return { exitCode: 1 };
    }
    throw err;
  }

  let skillContent: string;
  try {
    skillContent = loadSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    return { exitCode: 1 };
  }

  const prompt = buildReviewPrompt(skillContent, scope);

  logProgress(
    `Reviewing ${scope.description} via ${backend.id} (${backend.capabilities.inspection})`,
  );

  let out: BackendRunOutput;
  try {
    out = await backend.run({ scope, prompt, onProgress: logProgress });
  } catch (err) {
    if (err instanceof BackendError) {
      process.stderr.write(`Error: ${err.message}\n`);
      return { exitCode: err.kind === "config" ? 1 : 2 };
    }
    throw err;
  }

  const parsed = parseVerdict(out.rawText, failClosed);
  const reviewResult: ReviewResult = {
    parsed,
    runId: out.runId,
    agentId: out.agentId,
    rawText: out.rawText,
  };

  emitVerdict(parsed, scope, options, { runId: out.runId, agentId: out.agentId });

  return {
    exitCode: parsed.verdict === "BLOCK" ? 3 : 0,
    result: reviewResult,
  };
}

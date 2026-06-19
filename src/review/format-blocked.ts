import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractPriorityFindings } from "./parse-verdict.js";
import type { ParsedVerdict, ReviewScope } from "../types.js";

const BAR = "═".repeat(50);
const DASH = "─".repeat(50);

/**
 * Formats BLOCK output for terminal copy-paste into Cursor agent.
 */
export function formatBlockedOutput(
  parsed: ParsedVerdict,
  scope: ReviewScope,
): string {
  const findings = extractPriorityFindings(parsed.body);
  const findingsBlock =
    findings.length > 0
      ? findings.map((f, i) => `  ${i + 1}. ${f}`).join("\n")
      : "  (see full review below)";

  const agentBlock = [
    "/thermo-nuclear-code-quality-review",
    "",
    `Fix these blockers from pre-push review on branch ${scope.branch}:`,
    "",
    parsed.body,
  ].join("\n");

  return [
    BAR,
    " THERMO-NUCLEAR REVIEW — PUSH BLOCKED",
    BAR,
    "",
    `Summary: ${parsed.summary}`,
    "",
    "Priority findings:",
    findingsBlock,
    "",
    DASH,
    " COPY BELOW INTO CURSOR AGENT",
    DASH,
    "",
    agentBlock,
    "",
    "Push again after fixes: git push",
    "Skip once (not recommended): git push --no-verify",
    BAR,
  ].join("\n");
}

/**
 * Writes the last review to <gitDir>/thermo-review-last.md for re-copy. This is a
 * convenience artifact, never a gate: a write failure (e.g. a read-only or unusual
 * git dir) must never abort the push, so it is fully failure-isolated.
 */
export function writeLastReview(gitDir: string, content: string): void {
  try {
    writeFileSync(join(gitDir, "thermo-review-last.md"), content, "utf8");
  } catch {
    // Best-effort re-copy file; swallow so the verdict/exit code are unaffected.
  }
}

/**
 * Formats PASS output (minimal).
 */
export function formatPassOutput(parsed: ParsedVerdict): string {
  return `VERDICT: PASS — ${parsed.summary}`;
}

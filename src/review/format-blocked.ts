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
 * Writes last review to .git/thermo-review-last.md for re-copy.
 */
export function writeLastReview(repoRoot: string, content: string): void {
  const path = join(repoRoot, ".git", "thermo-review-last.md");
  writeFileSync(path, content, "utf8");
}

/**
 * Formats PASS output (minimal).
 */
export function formatPassOutput(parsed: ParsedVerdict): string {
  return `VERDICT: PASS — ${parsed.summary}`;
}

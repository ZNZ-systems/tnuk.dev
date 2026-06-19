import type { ParsedVerdict, Verdict } from "../types.js";

const VERDICT_RE = /^VERDICT:\s*(PASS|BLOCK)\s*$/im;
const SUMMARY_RE = /^SUMMARY:\s*(.+)$/im;

function stripFrontmatter(text: string): string {
  if (text.startsWith("---")) {
    const end = text.indexOf("---", 3);
    if (end !== -1) {
      return text.slice(end + 3).trimStart();
    }
  }
  return text;
}

/**
 * Parses VERDICT and SUMMARY from agent output. Fail closed when missing.
 */
export function parseVerdict(rawText: string, failClosed: boolean): ParsedVerdict {
  const text = stripFrontmatter(rawText.trim());
  const verdictMatch = VERDICT_RE.exec(text);
  const summaryMatch = SUMMARY_RE.exec(text);

  const verdictRaw = verdictMatch?.[1]?.toUpperCase();
  const summary = summaryMatch?.[1]?.trim() ?? "Review completed without summary line.";

  let verdict: Verdict;
  let parseFailed = false;

  if (verdictRaw === "PASS") {
    verdict = "PASS";
  } else if (verdictRaw === "BLOCK") {
    verdict = "BLOCK";
  } else if (failClosed) {
    verdict = "BLOCK";
    parseFailed = true;
  } else {
    verdict = "PASS";
    parseFailed = true;
  }

  const bodyStart = summaryMatch?.index !== undefined
    ? text.slice(summaryMatch.index + summaryMatch[0].length).trim()
    : text;

  return {
    verdict,
    summary: parseFailed && !summaryMatch ? "Could not parse VERDICT/SUMMARY; failing closed." : summary,
    body: bodyStart,
    parseFailed,
  };
}

/**
 * Extracts numbered priority findings.
 *
 * When the "## Priority findings" header is absent, the default behaviour scans the
 * whole body for numbered lines (best-effort for terminal display). Pass
 * `wholeBodyFallback: false` to require the header instead — used where stray
 * numbered prose must NOT be mistaken for findings (e.g. deriving ledger decisions).
 */
export function extractPriorityFindings(
  body: string,
  options: { wholeBodyFallback?: boolean } = {},
): string[] {
  const wholeBodyFallback = options.wholeBodyFallback ?? true;
  // Stop at the next "## " heading, a "---" rule, or end of input. NOTE: `$` (not
  // `\Z`, which JS lacks — it would match a literal "z" under the /i flag and
  // truncate findings at the first "z").
  const sectionMatch = /##\s*Priority findings\s*\n([\s\S]*?)(?:\n##\s|\n---|$)/i.exec(body);
  if (!sectionMatch && !wholeBodyFallback) {
    return [];
  }
  const section = sectionMatch?.[1] ?? body;

  const findings: string[] = [];
  for (const line of section.split("\n")) {
    const item = /^\s*\d+\.\s+(.+)$/.exec(line.trim());
    if (item?.[1]) {
      findings.push(item[1].trim());
    }
    if (findings.length >= 8) {
      break;
    }
  }

  return findings;
}

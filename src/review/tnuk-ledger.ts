import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReviewScope, Verdict } from "../types.js";
import { extractPriorityFindings } from "./parse-verdict.js";

/**
 * Branch-scoped review state ("tnuk ledger"). Records the standing structural
 * decisions a review takes on each blocking round so the next round can build on
 * them instead of circling — suggesting one direction, then its opposite. Lives
 * under the real git dir (local, never committed, never part of the reviewed diff)
 * and is wiped automatically when the branch passes the gate.
 *
 * Hard rule: the ledger is an AID, never a GATE. Every operation here is
 * failure-isolated — a read/write/delete error must never change a verdict or
 * block a push, so callers can invoke these freely without guarding them.
 */

export const DECISIONS_START = "<!-- TNUK:DECISIONS:START -->";
export const DECISIONS_END = "<!-- TNUK:DECISIONS:END -->";
const HISTORY_START = "<!-- TNUK:HISTORY:START -->";
const HISTORY_END = "<!-- TNUK:HISTORY:END -->";

/** Cap history growth; older lines fall off the bottom. */
const MAX_HISTORY = 20;
/** Keep history/finding lines to a single readable line in the ledger. */
const MAX_LINE = 160;

/** Prior-decision context fed into the next round's review prompt. */
export interface LedgerContext {
  /** Carried-forward decisions/reversals markdown (no delimiters). */
  decisions: string;
  /** Compact history lines ("- round N · sha · VERDICT · summary"). */
  history: string[];
  /** Number of blocking review rounds already recorded for this branch. */
  rounds: number;
}

/** The parsed review outcome a write folds into the ledger. */
export interface LedgerUpdate {
  verdict: Verdict;
  summary: string;
  body: string;
  rawText: string;
}

/** Escape hatch: THERMO_REVIEW_NO_TNUK=1 disables the ledger entirely. */
export function tnukDisabled(): boolean {
  return process.env["THERMO_REVIEW_NO_TNUK"] === "1";
}

function slugBranch(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "HEAD";
}

/**
 * On-disk file name for a branch. Lossless (just `<branch>.md`) when the branch
 * name is already filesystem-safe; otherwise the lossy slug is disambiguated with
 * a short hash of the raw name so distinct branches that share a slug (e.g.
 * `feature/x` vs `feature-x`) never collide onto the same ledger.
 */
function ledgerFileName(branch: string): string {
  const slug = slugBranch(branch);
  if (slug === branch) {
    return `${slug}.md`;
  }
  const hash = createHash("sha1").update(branch).digest("hex").slice(0, 8);
  return `${slug}-${hash}.md`;
}

/** `<gitDir>/thermo-review/tnuk/<branch>.md` for the scope's branch. */
export function ledgerPathForScope(scope: ReviewScope): string {
  return join(scope.gitDir, "thermo-review", "tnuk", ledgerFileName(scope.branch));
}

/** First delimited region (START..END). Safe for the controlled, marker-neutralized ledger file. */
function extractBetween(text: string, start: string, end: string): string | undefined {
  const from = text.indexOf(start);
  if (from === -1) {
    return undefined;
  }
  const after = from + start.length;
  const to = text.indexOf(end, after);
  if (to === -1) {
    return undefined;
  }
  return text.slice(after, to).trim();
}

/** Last delimited region — for untrusted agent output that may echo a prior block then update it. */
function extractLastBetween(text: string, start: string, end: string): string | undefined {
  const from = text.lastIndexOf(start);
  if (from === -1) {
    return undefined;
  }
  const after = from + start.length;
  const to = text.indexOf(end, after);
  if (to === -1) {
    return undefined;
  }
  return text.slice(after, to).trim();
}

/** True when a decisions block has at least one real "### Dn" entry (not just template headers). */
function hasDecisionEntry(decisions: string): boolean {
  return /^#{1,6}\s*D\d+\b/m.test(decisions);
}

/**
 * Pulls the agent-authored decisions block out of a raw review response. Takes the
 * LAST marker pair (an echo-then-update emits two), and rejects a template-only
 * skeleton with no actual decisions so it can't erase carried-forward decisions.
 */
export function extractDecisionsFromReview(rawText: string): string | undefined {
  const inner = extractLastBetween(rawText, DECISIONS_START, DECISIONS_END);
  if (!inner || !hasDecisionEntry(inner)) {
    return undefined;
  }
  return inner;
}

/** Defang any TNUK markers embedded in stored text so file re-parse can't be hijacked. */
function neutralizeMarkers(text: string): string {
  // Insert a zero-width space so an echoed "<!-- TNUK:...:END -->" inside the
  // decisions text no longer matches our delimiter when the file is re-parsed.
  const zwsp = String.fromCharCode(0x200b);
  return text.replaceAll("TNUK:", `TNUK${zwsp}:`);
}

function frontmatterValue(text: string, key: string): string | undefined {
  if (!text.startsWith("---")) {
    return undefined;
  }
  const end = text.indexOf("\n---", 3);
  const block = end === -1 ? text : text.slice(0, end);
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(block);
  return match?.[1]?.trim();
}

function roundsFrom(text: string): number {
  const raw = frontmatterValue(text, "rounds");
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function historyFrom(text: string): string[] {
  const block = extractBetween(text, HISTORY_START, HISTORY_END) ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function nowIso(): string {
  return new Date().toISOString();
}

function oneLine(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_LINE) {
    return collapsed;
  }
  // Slice by code point so truncation can't split a surrogate pair.
  return `${[...collapsed].slice(0, MAX_LINE - 1).join("")}…`;
}

/** An existing ledger only if it actually belongs to this branch (guards stale collisions). */
function existingForBranch(scope: ReviewScope, path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const text = readFileSync(path, "utf8");
  return frontmatterValue(text, "branch") === scope.branch ? text : undefined;
}

/**
 * Reads the prior decisions for a branch, or undefined when there is no usable
 * ledger (missing/disabled/unreadable/empty, or a stale file for a different
 * branch). Never throws.
 */
export function readLedger(scope: ReviewScope): LedgerContext | undefined {
  if (tnukDisabled()) {
    return undefined;
  }
  try {
    const text = existingForBranch(scope, ledgerPathForScope(scope));
    if (!text) {
      return undefined;
    }
    const decisions = extractBetween(text, DECISIONS_START, DECISIONS_END) ?? "";
    const history = historyFrom(text);
    if (!decisions && history.length === 0) {
      return undefined;
    }
    return { decisions, history, rounds: roundsFrom(text) };
  } catch {
    return undefined;
  }
}

/** Decisions derived from findings when the review emits no structured block. */
function fallbackDecisions(body: string): string {
  // Strict: only a real "## Priority findings" section seeds decisions, so stray
  // numbered prose can't be fabricated into binding standing decisions.
  const findings = extractPriorityFindings(body, { wholeBodyFallback: false });
  const items = findings.length
    ? findings
        .map(
          (finding, i) =>
            `### D${i + 1} — ${oneLine(finding)} · [open] · since this round\n` +
            "(auto-recorded from this round's priority findings)",
        )
        .join("\n\n")
    : "_No structured decisions were emitted by the review._";
  return [
    "## Standing decisions",
    "_(auto-derived; the review did not emit a structured decisions block)_",
    "",
    items,
    "",
    "## Reversals",
    "_(none)_",
  ].join("\n");
}

function renderLedgerFile(parts: {
  scope: ReviewScope;
  created: string;
  rounds: number;
  verdict: Verdict;
  decisions: string;
  history: string[];
}): string {
  const { scope } = parts;
  return [
    "---",
    "tnuk-ledger: 1",
    `branch: ${scope.branch}`,
    `base: ${scope.baseRef}`,
    `created: ${parts.created}`,
    `updated: ${nowIso()}`,
    `rounds: ${parts.rounds}`,
    `last-verdict: ${parts.verdict}`,
    "---",
    "",
    `# tnuk ledger — ${scope.branch}`,
    "",
    `Standing review decisions for branch \`${scope.branch}\` (vs \`${scope.baseRef}\`).`,
    "The pre-push review reads this on every round and must build on these decisions",
    "rather than silently reversing them — a reversal is allowed only with explicit",
    "justification recorded below. Local-only, never committed; wiped automatically",
    "when the branch passes review.",
    "",
    DECISIONS_START,
    neutralizeMarkers(parts.decisions.trim()),
    DECISIONS_END,
    "",
    HISTORY_START,
    parts.history.join("\n"),
    HISTORY_END,
    "",
  ].join("\n");
}

/**
 * Folds a review outcome into the branch ledger, preserving the creation date and
 * accumulating history. Prefers the agent's own consolidated decisions block;
 * falls back to the previous block, then to findings-derived decisions. Never throws.
 */
export function writeLedger(scope: ReviewScope, update: LedgerUpdate): void {
  if (tnukDisabled()) {
    return;
  }
  try {
    const path = ledgerPathForScope(scope);
    const existing = existingForBranch(scope, path);

    const created = (existing && frontmatterValue(existing, "created")) || nowIso();
    const rounds = (existing ? roundsFrom(existing) : 0) + 1;

    const decisions =
      extractDecisionsFromReview(update.rawText) ??
      (existing ? extractBetween(existing, DECISIONS_START, DECISIONS_END) : undefined) ??
      fallbackDecisions(update.body);

    const priorHistory = existing ? historyFrom(existing) : [];
    const line = `- round ${rounds} · ${scope.toSha.slice(0, 7)} · ${update.verdict} · ${oneLine(update.summary)}`;
    const history = [...priorHistory, line].slice(-MAX_HISTORY);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      renderLedgerFile({ scope, created, rounds, verdict: update.verdict, decisions, history }),
      "utf8",
    );
  } catch {
    // The ledger is an aid, never a gate: swallow and let the push proceed.
  }
}

/** Removes the branch ledger after a passing push (convergence → clean slate). Never throws. */
export function clearLedger(scope: ReviewScope): void {
  if (tnukDisabled()) {
    return;
  }
  try {
    const path = ledgerPathForScope(scope);
    if (existsSync(path)) {
      rmSync(path);
    }
  } catch {
    // ignore — a stale ledger is harmless; a thrown error must not break the push.
  }
}

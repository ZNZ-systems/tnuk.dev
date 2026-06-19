import { reviewDiffPathspec } from "../git/push-scope.js";
import type { ReviewScope } from "../types.js";
import { DECISIONS_END, DECISIONS_START, type LedgerContext } from "./tnuk-ledger.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Renders the prior-decisions ledger as BINDING context for this review. This is
 * the anti-circling mechanism: the review must build on earlier decisions or
 * reverse them on the record, never flip direction silently.
 */
function priorDecisionsSection(ledger: LedgerContext): string {
  const history = ledger.history.length
    ? ledger.history.join("\n")
    : "(no prior rounds recorded)";
  return `## Standing decisions from earlier rounds (tnuk ledger)

This branch has already been blocked ${ledger.rounds} time(s) in earlier reviews. The
decisions below were recorded then and are BINDING context for this review:

- Build on them. Do NOT silently contradict or reverse a prior decision — circling between
  opposite suggestions across pushes is exactly what this ledger exists to prevent.
- If you are now convinced a prior decision was wrong, you MAY reverse it, but only by
  recording a reversal with justification in your output ledger block (see the output
  contract). Never flip direction without saying so on the record.
- Keep your guidance consistent with these decisions so the review converges to PASS.

${ledger.decisions || "(no decisions recorded yet)"}

### Push history
${history}`;
}

/**
 * The mandatory machine-parseable decisions block the review must emit. Persisted
 * verbatim into the branch ledger and re-shown on the next push, so the review
 * curates its own standing decisions across pushes.
 */
function decisionsOutputContract(): string {
  return `## Standing decisions ledger (MANDATORY — end of response)

End your response (after the Priority findings) with a tnuk decisions block, delimited EXACTLY:

${DECISIONS_START}
## Standing decisions
### D1 — <short title> · [open|resolved] · since <short-sha or "this push">
<1–2 sentences stating the structural DIRECTION a future reviewer must honour, e.g.
"diff-scope resolution belongs in push-scope.ts; do not re-inline it into the CLI">

### D2 — ...

## Reversals
<empty, or: "- supersedes D1: <new direction> — <why the earlier decision was wrong>">
${DECISIONS_END}

Rules for this block:
- Carry forward EVERY prior decision shown above, keeping its ID. Mark it [resolved] only
  when this push's code fully satisfies it; otherwise keep it [open].
- Do not silently contradict a prior decision; reverse only via the Reversals list with a
  justification, then add the new direction as a fresh Dn.
- Keep directions concrete and stable across rounds so feedback converges instead of
  oscillating between opposite suggestions.
- Emit this block exactly ONCE, and do not reproduce the literal marker strings inside
  your decision prose.
- This block is REQUIRED on PASS too (it may list only resolved decisions, or be empty).`;
}

/**
 * Builds the agent prompt with inlined skill content, a machine-parseable verdict
 * header, and (when present) the branch's standing-decisions ledger so feedback
 * converges across pushes instead of circling.
 */
export function buildReviewPrompt(
  skillContent: string,
  scope: ReviewScope,
  ledger?: LedgerContext,
): string {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const pathspec = reviewDiffPathspec().map(shellQuote).join(" ");
  const diffCommands = [
    `git diff --stat ${range} -- ${pathspec}`,
    `git diff ${range} -- ${pathspec}`,
    `git log --oneline ${range}`,
  ].join("\n");

  const ledgerContext = ledger ? `\n\n${priorDecisionsSection(ledger)}` : "";
  const honourLedgerStep = ledger
    ? "\n0. Honour the standing decisions ledger above: build on prior decisions and do not silently reverse them."
    : "";

  return `# Thermo-Nuclear Code Quality Review (pre-push gate)

You are running as an automated pre-push quality gate. Review ONLY the changes in scope below.

## Scope
- Repository: ${scope.repoRoot}
- Branch: ${scope.branch}
- Base ref: ${scope.baseRef}
- Commit range: ${scope.fromSha}..${scope.toSha}
- Description: ${scope.description}${ledgerContext}

## Your task${honourLedgerStep}
1. Inspect the diff in scope. When shell is available, start with:
\`\`\`
${diffCommands}
\`\`\`
   When only sandboxed review tools are available, use the equivalent git/file tools. Lock/generated pathspecs are excluded from review by the gate.
2. Read changed files as needed for a deep maintainability review.
3. Apply the thermo-nuclear review skill below strictly.
4. Use the skill's Approval Bar: if ANY presumptive blocker applies, verdict is BLOCK.

## Output format (MANDATORY — no text before these two lines)

Your response MUST begin with exactly these two lines and nothing before them:

VERDICT: PASS
SUMMARY: <one sentence, max 120 chars>

OR

VERDICT: BLOCK
SUMMARY: <one sentence, max 120 chars>

Then write the full review body with prioritized findings (structural first).

After the verdict lines, include a section titled "## Priority findings" with a numbered list of the top blockers or notable items (max 8).

${decisionsOutputContract()}

---

## Skill: thermo-nuclear-code-quality-review

${skillContent}
`;
}

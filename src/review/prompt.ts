import type { ReviewScope } from "../types.js";

/**
 * Builds the agent prompt with inlined skill content and machine-parseable verdict header.
 */
export function buildReviewPrompt(skillContent: string, scope: ReviewScope): string {
  const diffCommands = [
    `git diff ${scope.fromSha}..${scope.toSha} --stat`,
    `git diff ${scope.fromSha}..${scope.toSha}`,
    `git log --oneline ${scope.fromSha}..${scope.toSha}`,
  ].join("\n");

  return `# Thermo-Nuclear Code Quality Review (pre-push gate)

You are running as an automated pre-push quality gate. Review ONLY the changes in scope below.

## Scope
- Repository: ${scope.repoRoot}
- Branch: ${scope.branch}
- Base ref: ${scope.baseRef}
- Commit range: ${scope.fromSha}..${scope.toSha}
- Description: ${scope.description}

## Your task
1. Run shell commands to inspect the diff in scope. Start with:
\`\`\`
${diffCommands}
\`\`\`
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

---

## Skill: thermo-nuclear-code-quality-review

${skillContent}
`;
}

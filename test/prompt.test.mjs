import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const distUrl = (p) => pathToFileURL(join(process.cwd(), "dist", p)).href;
const { buildReviewPrompt } = await import(distUrl("review/prompt.js"));

const scope = {
  repoRoot: "/repo",
  gitDir: "/repo/.git",
  branch: "feature/x",
  baseRef: "main",
  fromSha: "a".repeat(40),
  toSha: "b".repeat(40),
  description: "test",
};

test("every base review prompt carries the findings-discipline (precision) clauses", () => {
  const prompt = buildReviewPrompt("SKILL-BODY", scope);
  assert.match(prompt, /Findings discipline \(precision\)/);
  assert.match(prompt, /blocker ONLY if you can tie it to a concrete failure scenario/);
  assert.match(prompt, /prefer not reporting over guessing/);
  assert.match(prompt, /Do not flag formatting, lint, or pure style/);
  assert.match(prompt, /do not block on pre-existing issues/);
});

test("the discipline section sits before the output contract and keeps the approval bar", () => {
  const prompt = buildReviewPrompt("SKILL-BODY", scope);
  const disciplineAt = prompt.indexOf("Findings discipline");
  const contractAt = prompt.indexOf("Output format (MANDATORY");
  assert.ok(disciplineAt !== -1 && contractAt !== -1);
  assert.ok(disciplineAt < contractAt, "discipline conditions the review before the output contract");
  assert.match(prompt, /Approval Bar: if ANY presumptive blocker applies, verdict is BLOCK/);
});

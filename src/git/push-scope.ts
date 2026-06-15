import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ReviewScope } from "../types.js";

const ZERO_SHA = "0".repeat(40);

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}

function gitTry(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = join(dir, "..");
    if (parent === dir) {
      throw new Error("Not inside a git repository.");
    }
    dir = parent;
  }
}

/**
 * Detects the default base branch for review comparisons.
 */
export function detectBaseRef(repoRoot: string, override?: string): string {
  if (override) {
    return override;
  }

  const candidates = ["main", "master", "origin/main", "origin/master"];
  for (const ref of candidates) {
    if (gitTry(repoRoot, ["rev-parse", "--verify", ref])) {
      return ref;
    }
  }

  const originHead = gitTry(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (originHead) {
    const shortRef = originHead.replace("refs/remotes/", "");
    if (gitTry(repoRoot, ["rev-parse", "--verify", shortRef])) {
      return shortRef;
    }
  }

  return "main";
}

function currentBranch(repoRoot: string): string {
  return (
    gitTry(repoRoot, ["symbolic-ref", "--short", "HEAD"]) ??
    gitTry(repoRoot, ["rev-parse", "--short", "HEAD"]) ??
    "HEAD"
  );
}

/**
 * Builds review scope for manual `thermo-review review` runs.
 */
export function scopeForManualReview(
  cwd: string,
  baseOverride?: string,
): ReviewScope {
  const repoRoot = findRepoRoot(cwd);
  const headSha = gitTry(repoRoot, ["rev-parse", "HEAD"]);
  if (!headSha) {
    throw new Error("Repository has no commits yet. Make an initial commit before running thermo-review.");
  }
  const baseRef = detectBaseRef(repoRoot, baseOverride);
  const branch = currentBranch(repoRoot);
  const toSha = headSha;

  const mergeBase = gitTry(repoRoot, ["merge-base", "HEAD", baseRef]);
  const fromSha = mergeBase ?? git(repoRoot, ["rev-parse", baseRef]);

  const description = mergeBase
    ? `branch ${branch} vs merge-base with ${baseRef} (${fromSha.slice(0, 7)}..${toSha.slice(0, 7)})`
    : `branch ${branch} vs ${baseRef} (${fromSha.slice(0, 7)}..${toSha.slice(0, 7)})`;

  return { repoRoot, branch, baseRef, fromSha, toSha, description };
}

export interface PrePushLine {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/**
 * Parses pre-push hook stdin lines.
 */
export function parsePrePushStdin(input: string): PrePushLine[] {
  const lines: PrePushLine[] = [];
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }
    const localRef = parts[0];
    const localSha = parts[1];
    const remoteRef = parts[2];
    const remoteSha = parts[3];
    if (!localRef || !localSha || !remoteRef || !remoteSha) {
      continue;
    }
    lines.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return lines;
}

/**
 * Builds review scope from pre-push hook context.
 */
export function scopeForPrePush(
  cwd: string,
  stdin: string,
  baseOverride?: string,
): ReviewScope {
  const repoRoot = findRepoRoot(cwd);
  const baseRef = detectBaseRef(repoRoot, baseOverride);
  const branch = currentBranch(repoRoot);
  const pushLines = parsePrePushStdin(stdin);

  if (pushLines.length === 0) {
    return scopeForManualReview(cwd, baseOverride);
  }

  const line = pushLines[0];
  if (!line) {
    return scopeForManualReview(cwd, baseOverride);
  }

  const { localSha, remoteSha } = line;
  const toSha = localSha;

  if (remoteSha === ZERO_SHA) {
    const mergeBase = gitTry(repoRoot, ["merge-base", localSha, baseRef]);
    const fromSha = mergeBase ?? git(repoRoot, ["rev-parse", baseRef]);
    return {
      repoRoot,
      branch,
      baseRef,
      fromSha,
      toSha,
      description: `new branch push ${branch} (${fromSha.slice(0, 7)}..${toSha.slice(0, 7)})`,
    };
  }

  return {
    repoRoot,
    branch,
    baseRef,
    fromSha: remoteSha,
    toSha,
    description: `push ${remoteSha.slice(0, 7)}..${localSha.slice(0, 7)} on ${branch}`,
  };
}

// Lock/generated files that bloat a diff without being worth reviewing.
const DIFF_EXCLUDES = [
  ":(exclude)package-lock.json",
  ":(exclude)pnpm-lock.yaml",
  ":(exclude)yarn.lock",
  ":(exclude)*.lock",
  ":(exclude)dist",
  ":(exclude)build",
  ":(exclude)*.min.js",
  ":(exclude)*.map",
  ":(exclude)*.snap",
];

export interface ScopeDiff {
  stat: string;
  patch: string;
  log: string;
  truncated: boolean;
}

/**
 * Collects the review diff (stat + patch + log) with lock/generated files
 * excluded and the patch capped, so a backend can inject it directly instead of
 * making the agent reconstruct it tool-call by tool-call.
 */
export function collectScopeDiff(scope: ReviewScope, maxPatchChars = 120_000): ScopeDiff {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const pathspec = [".", ...DIFF_EXCLUDES];
  const stat = gitTry(scope.repoRoot, ["diff", "--stat", range, "--", ...pathspec]) ?? "";
  const log = gitTry(scope.repoRoot, ["log", "--oneline", range]) ?? "";
  let patch = gitTry(scope.repoRoot, ["diff", range, "--", ...pathspec]) ?? "";
  let truncated = false;
  if (patch.length > maxPatchChars) {
    patch = patch.slice(0, maxPatchChars);
    truncated = true;
  }
  return { stat, patch, log, truncated };
}

/**
 * Returns true if there are file changes in the review range. Used to skip the
 * agent entirely when there is nothing to review (e.g. pushing the base branch
 * with no new commits), which otherwise leaves the agent looping with no diff.
 */
export function scopeHasChanges(scope: ReviewScope): boolean {
  if (scope.fromSha === scope.toSha) {
    return false;
  }
  try {
    // `git diff --quiet` exits 0 when there are no changes; execFileSync throws
    // on the non-zero exit that signals changes (or any error → treat as changes).
    git(scope.repoRoot, ["diff", "--quiet", `${scope.fromSha}..${scope.toSha}`]);
    return false;
  } catch {
    return true;
  }
}

export { findRepoRoot };

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

/**
 * Resolves the real git directory for a repo root. Unlike `<root>/.git`, this is
 * correct in linked worktrees and submodules (where `.git` is a file, not a dir),
 * so local state written under it does not throw ENOTDIR. Falls back to the
 * conventional path on very old gits without `--absolute-git-dir`.
 */
function resolveGitDir(repoRoot: string): string {
  const dir = gitTry(repoRoot, ["rev-parse", "--absolute-git-dir"]);
  return dir && dir.length > 0 ? dir : join(repoRoot, ".git");
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

  return { repoRoot, gitDir: resolveGitDir(repoRoot), branch, baseRef, fromSha, toSha, description };
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
      gitDir: resolveGitDir(repoRoot),
      branch,
      baseRef,
      fromSha,
      toSha,
      description: `new branch push ${branch} (${fromSha.slice(0, 7)}..${toSha.slice(0, 7)})`,
    };
  }

  return {
    repoRoot,
    gitDir: resolveGitDir(repoRoot),
    branch,
    baseRef,
    fromSha: remoteSha,
    toSha,
    description: `push ${remoteSha.slice(0, 7)}..${localSha.slice(0, 7)} on ${branch}`,
  };
}

// Lock/generated files that bloat a diff without being worth reviewing.
export const REVIEW_DIFF_EXCLUDES = [
  ":(exclude)package-lock.json",
  ":(exclude)pnpm-lock.yaml",
  ":(exclude)yarn.lock",
  ":(exclude)*.lock",
  ":(exclude)dist",
  ":(exclude)build",
  ":(exclude)*.min.js",
  ":(exclude)*.map",
  ":(exclude)*.snap",
] as const;

export function reviewDiffPathspec(): string[] {
  return [".", ...REVIEW_DIFF_EXCLUDES];
}

/**
 * Returns true if there are reviewable file changes in the review range (using
 * the same lock/generated exclusions as the review tools). Used to skip the
 * agent entirely when there is nothing to review, which otherwise leaves it looping.
 */
export function scopeHasChanges(scope: ReviewScope): boolean {
  if (scope.fromSha === scope.toSha) {
    return false;
  }
  try {
    // `git diff --quiet` exits 0 when there are no changes; execFileSync throws
    // on the non-zero exit that signals changes (or any error → treat as changes).
    git(scope.repoRoot, [
      "diff",
      "--quiet",
      `${scope.fromSha}..${scope.toSha}`,
      "--",
      ...reviewDiffPathspec(),
    ]);
    return false;
  } catch {
    return true;
  }
}

export { findRepoRoot };

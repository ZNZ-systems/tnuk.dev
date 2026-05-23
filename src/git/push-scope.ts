import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ReviewScope } from "../types.js";

const ZERO_SHA = "0".repeat(40);
/** Git empty tree — used when reviewing the first commit in a repo. */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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
 * Ensures fromSha..toSha is a non-empty range. Uses parent commit or empty tree.
 */
export function normalizeReviewRange(
  repoRoot: string,
  fromSha: string,
  toSha: string,
): { fromSha: string; toSha: string } {
  if (fromSha !== toSha) {
    return { fromSha, toSha };
  }

  const parent = gitTry(repoRoot, ["rev-parse", `${toSha}^`]);
  if (parent) {
    return { fromSha: parent, toSha };
  }

  return { fromSha: EMPTY_TREE_SHA, toSha };
}

function buildScope(
  repoRoot: string,
  branch: string,
  baseRef: string,
  fromSha: string,
  toSha: string,
  descriptionPrefix: string,
): ReviewScope {
  const normalized = normalizeReviewRange(repoRoot, fromSha, toSha);
  const description =
    normalized.fromSha === EMPTY_TREE_SHA
      ? `${descriptionPrefix} (initial commit ${normalized.toSha.slice(0, 7)})`
      : `${descriptionPrefix} (${normalized.fromSha.slice(0, 7)}..${normalized.toSha.slice(0, 7)})`;

  return {
    repoRoot,
    branch,
    baseRef,
    fromSha: normalized.fromSha,
    toSha: normalized.toSha,
    description,
  };
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
    throw new Error(
      "Repository has no commits yet. Make an initial commit before running thermo-review.",
    );
  }
  const baseRef = detectBaseRef(repoRoot, baseOverride);
  const branch = currentBranch(repoRoot);
  const toSha = headSha;

  const mergeBase = gitTry(repoRoot, ["merge-base", "HEAD", baseRef]);
  const fromSha = mergeBase ?? git(repoRoot, ["rev-parse", baseRef]);

  return buildScope(
    repoRoot,
    branch,
    baseRef,
    fromSha,
    toSha,
    `branch ${branch} vs ${mergeBase ? `merge-base with ${baseRef}` : baseRef}`,
  );
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

  const line = pushLines[0];
  if (!line) {
    return scopeForManualReview(cwd, baseOverride);
  }

  const { localSha, remoteSha } = line;
  const toSha = localSha;

  if (remoteSha === ZERO_SHA) {
    const mergeBase = gitTry(repoRoot, ["merge-base", localSha, baseRef]);
    const fromSha = mergeBase ?? gitTry(repoRoot, ["rev-parse", baseRef]) ?? EMPTY_TREE_SHA;
    return buildScope(
      repoRoot,
      branch,
      baseRef,
      fromSha,
      toSha,
      `new branch push ${branch}`,
    );
  }

  return buildScope(
    repoRoot,
    branch,
    baseRef,
    remoteSha,
    toSha,
    `push on ${branch}`,
  );
}

export { findRepoRoot };

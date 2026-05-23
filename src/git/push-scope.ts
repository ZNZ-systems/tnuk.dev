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

export { findRepoRoot };

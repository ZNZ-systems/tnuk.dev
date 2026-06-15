import { isAbsolute, relative, resolve, sep } from "node:path";

import { reviewDiffPathspec } from "../../git/push-scope.js";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/u;

function assertLiteralRepoPathInput(input: string): void {
  if (CONTROL_CHARS.test(input)) {
    throw new Error("path must not contain control characters");
  }
  if (input.startsWith("~") || isAbsolute(input)) {
    throw new Error("path must be repo-relative");
  }
}

function assertSafeNormalizedRepoPath(path: string): void {
  const parts = path.split("/");
  if (parts.includes(".git")) {
    throw new Error("path escapes the repository or targets .git");
  }
  if (path.startsWith(":")) {
    throw new Error("path must be a literal repo-relative path; git pathspec magic is not allowed");
  }
}

export function repoPath(repoRoot: string, input: string | undefined): string | undefined {
  if (!input || input === ".") {
    return undefined;
  }

  assertLiteralRepoPathInput(input);

  const absolute = resolve(repoRoot, input);
  const rel = relative(repoRoot, absolute);
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("path escapes the repository or targets .git");
  }

  const normalized = rel.split(sep).join("/");
  assertSafeNormalizedRepoPath(normalized);
  return normalized;
}

export function requiredRepoPath(repoRoot: string, input: string | undefined): string {
  const path = repoPath(repoRoot, input);
  if (!path) {
    throw new Error("missing path");
  }
  return path;
}

export function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

export function reviewPathspecFor(path: string | undefined): string[] {
  const include = path ? literalPathspec(path) : ".";
  return [include, ...reviewDiffPathspec().slice(1)];
}

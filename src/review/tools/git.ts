import { execFileSync } from "node:child_process";

import { MAX_GIT_BUFFER_BYTES } from "./limits.js";

export function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
}

export function runGitBuffer(repoRoot: string, args: readonly string[]): Buffer {
  return execFileSync("git", [...args], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
}

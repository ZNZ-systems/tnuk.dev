export type Verdict = "PASS" | "BLOCK";

export type ProviderId = "cursor" | "openai" | "claude" | "panel";

export interface ReviewScope {
  repoRoot: string;
  /** Absolute path to the real git dir (handles worktrees/submodules where `.git` is a file). */
  gitDir: string;
  branch: string;
  baseRef: string;
  fromSha: string;
  toSha: string;
  description: string;
}

export interface ParsedVerdict {
  verdict: Verdict;
  summary: string;
  body: string;
  parseFailed: boolean;
}

export interface ReviewResult {
  parsed: ParsedVerdict;
  runId: string | undefined;
  agentId: string | undefined;
  rawText: string;
}

export interface ReviewOutputOptions {
  json: boolean;
  quiet: boolean;
}

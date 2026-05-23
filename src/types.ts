export type Verdict = "PASS" | "BLOCK";

export interface ReviewScope {
  repoRoot: string;
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

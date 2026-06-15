import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

import type { Tool } from "openai/resources/responses/responses";

import { reviewDiffPathspec } from "../git/push-scope.js";
import type { ReviewScope } from "../types.js";

const MAX_GIT_BUFFER_BYTES = 32 * 1024 * 1024;
const DEFAULT_TOOL_OUTPUT_BYTES = 80_000;
const MAX_TOOL_OUTPUT_BYTES = 200_000;
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 2_000;

export type ReviewToolName = "git_diff" | "git_log" | "list_files" | "read_file";

type GitDiffMode = "stat" | "patch" | "name-only" | "name-status";
type GitLogFormat = "oneline" | "medium";
type ListFilesKind = "changed" | "tracked";

interface GitDiffArgs {
  mode: GitDiffMode;
  path?: string;
  unified: number;
  maxBytes: number;
}

interface GitLogArgs {
  format: GitLogFormat;
  maxCount: number;
  path?: string;
}

interface ListFilesArgs {
  kind: ListFilesKind;
  path?: string;
  maxEntries: number;
}

interface ReadFileArgs {
  path: string;
  startLine: number;
  endLine?: number;
  maxBytes: number;
}

type ReviewToolArgs = GitDiffArgs | GitLogArgs | ListFilesArgs | ReadFileArgs;

export type ReviewEvidenceKind = "git_diff_stat" | "git_diff_name_status" | "git_log";

interface ReviewToolEvidence {
  kind: ReviewEvidenceKind | "read_file" | "git_diff_patch" | "list_changed_files";
  path?: string;
}

interface BaseSuccess<Name extends ReviewToolName> {
  ok: true;
  tool: Name;
  evidence?: ReviewToolEvidence;
}

interface GitDiffSuccess extends BaseSuccess<"git_diff"> {
  range: string;
  mode: GitDiffMode;
  pathspec: string[];
  output: string;
}

interface GitLogSuccess extends BaseSuccess<"git_log"> {
  range: string;
  format: GitLogFormat;
  maxCount: number;
  path?: string;
  output: string;
}

interface ListFilesSuccess extends BaseSuccess<"list_files"> {
  kind: ListFilesKind;
  count: number;
  path?: string;
  entries: string[];
}

interface ReadFileSuccess extends BaseSuccess<"read_file"> {
  path: string;
  commit: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export interface ReviewToolFailure {
  ok: false;
  tool: string;
  error: string;
  message?: string;
  advice?: string;
  allowed?: readonly string[];
  bytes?: number;
  maxBytes?: number;
  count?: number;
  maxEntries?: number;
  path?: string;
  commit?: string;
  raw?: unknown;
}

export type ReviewToolResult =
  | GitDiffSuccess
  | GitLogSuccess
  | ListFilesSuccess
  | ReadFileSuccess
  | ReviewToolFailure;

export interface ReviewToolExecution {
  name: string;
  args: ReviewToolArgs | Record<string, never>;
  result: ReviewToolResult;
  output: string;
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "git_diff",
    description:
      "Inspect the review-scope git diff with lock/generated files excluded. Use mode=stat or name-status first; use path for per-file patch review when the full patch is too large.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["stat", "patch", "name-only", "name-status"],
          description: "Diff view to return. Defaults to patch.",
        },
        path: {
          type: "string",
          description: "Optional repo-relative file or directory path to narrow the diff.",
        },
        unified: {
          type: "integer",
          minimum: 0,
          maximum: 80,
          description: "Optional number of context lines for patch mode.",
        },
        maxBytes: {
          type: "integer",
          minimum: 1_000,
          maximum: MAX_TOOL_OUTPUT_BYTES,
          description: "Maximum output bytes. Oversized outputs return output_too_large rather than truncating.",
        },
      },
    },
    strict: false,
  },
  {
    type: "function",
    name: "git_log",
    description: "Inspect commits in the review scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: {
          type: "string",
          enum: ["oneline", "medium"],
          description: "Commit log format. Defaults to oneline.",
        },
        maxCount: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum commits to return. Defaults to 50.",
        },
        path: {
          type: "string",
          description: "Optional repo-relative file or directory path to narrow the log.",
        },
      },
    },
    strict: false,
  },
  {
    type: "function",
    name: "list_files",
    description:
      "List changed files in the review scope, or tracked repository files at the reviewed head commit. Changed-file lists use the same lock/generated exclusions as the review gate.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["changed", "tracked"],
          description: "Which file set to list. Defaults to changed.",
        },
        path: {
          type: "string",
          description: "Optional repo-relative directory or file path to narrow results.",
        },
        maxEntries: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: "Maximum entries to return. Oversized lists return an explicit too_many_entries error rather than truncating.",
        },
      },
    },
    strict: false,
  },
  {
    type: "function",
    name: "read_file",
    description:
      "Read a tracked repo file from the reviewed head commit (not the live worktree) with optional line bounds. Use this after identifying changed files to inspect surrounding implementation context.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Repo-relative tracked file path to read at the reviewed head commit.",
        },
        startLine: {
          type: "integer",
          minimum: 1,
          description: "1-based first line to read.",
        },
        endLine: {
          type: "integer",
          minimum: 1,
          description: "1-based last line to read, inclusive.",
        },
        maxBytes: {
          type: "integer",
          minimum: 1_000,
          maximum: MAX_TOOL_OUTPUT_BYTES,
          description: "Maximum output bytes. Oversized reads return output_too_large rather than truncating.",
        },
      },
      required: ["path"],
    },
    strict: false,
  },
] as const satisfies readonly Tool[];

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
}

function runGitBuffer(repoRoot: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function enumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) {
    return fallback;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`invalid enum value "${value}"; allowed: ${allowed.join(", ")}`);
}

function repoPath(repoRoot: string, input: string | undefined): string | undefined {
  if (!input || input === ".") {
    return undefined;
  }
  if (input.includes("\0") || input.startsWith("~") || resolve(input) === input) {
    throw new Error("path must be repo-relative");
  }
  const absolute = resolve(repoRoot, input);
  const rel = relative(repoRoot, absolute);
  if (!rel || rel.startsWith("..") || rel === "." || rel.split(sep).includes(".git")) {
    throw new Error("path escapes the repository or targets .git");
  }
  return rel.split(sep).join("/");
}

function requiredPath(repoRoot: string, input: string | undefined): string {
  const path = repoPath(repoRoot, input);
  if (!path) {
    throw new Error("missing path");
  }
  return path;
}

function pathspecFor(scope: ReviewScope, inputPath: string | undefined): string[] {
  return [repoPath(scope.repoRoot, inputPath) ?? ".", ...reviewDiffPathspec().slice(1)];
}

function enforceOutputLimit(output: string, maxBytes: number): string | { tooLarge: true; bytes: number } {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= maxBytes) {
    return output;
  }
  return { tooLarge: true, bytes };
}

function toolError(tool: string, error: string, payload: Omit<ReviewToolFailure, "ok" | "tool" | "error"> = {}): ReviewToolFailure {
  return { ok: false, tool, error, ...payload };
}

function outputTooLarge(tool: ReviewToolName, bytes: number, maxBytes: number, advice: string): ReviewToolFailure {
  return toolError(tool, "output_too_large", { bytes, maxBytes, advice });
}

function evidenceForDiff(mode: GitDiffMode, path: string | undefined): ReviewToolEvidence | undefined {
  if (mode === "stat" && !path) {
    return { kind: "git_diff_stat" };
  }
  if (mode === "name-status" && !path) {
    return { kind: "git_diff_name_status" };
  }
  if (mode === "patch") {
    return path ? { kind: "git_diff_patch", path } : { kind: "git_diff_patch" };
  }
  return undefined;
}

function parseGitDiffArgs(scope: ReviewScope, raw: unknown): GitDiffArgs {
  const args = asRecord(raw);
  const mode = enumValue(optionalString(args, "mode"), ["stat", "patch", "name-only", "name-status"] as const, "patch");
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    mode,
    ...(path ? { path } : {}),
    unified: optionalInt(args, "unified", 3, 0, 80),
    maxBytes: optionalInt(args, "maxBytes", DEFAULT_TOOL_OUTPUT_BYTES, 1_000, MAX_TOOL_OUTPUT_BYTES),
  };
}

function parseGitLogArgs(scope: ReviewScope, raw: unknown): GitLogArgs {
  const args = asRecord(raw);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    format: enumValue(optionalString(args, "format"), ["oneline", "medium"] as const, "oneline"),
    maxCount: optionalInt(args, "maxCount", 50, 1, 200),
    ...(path ? { path } : {}),
  };
}

function parseListFilesArgs(scope: ReviewScope, raw: unknown): ListFilesArgs {
  const args = asRecord(raw);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    kind: enumValue(optionalString(args, "kind"), ["changed", "tracked"] as const, "changed"),
    ...(path ? { path } : {}),
    maxEntries: optionalInt(args, "maxEntries", DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
  };
}

function parseReadFileArgs(scope: ReviewScope, raw: unknown): ReadFileArgs {
  const args = asRecord(raw);
  const path = requiredPath(scope.repoRoot, optionalString(args, "path"));
  const startLine = optionalInt(args, "startLine", 1, 1, Number.MAX_SAFE_INTEGER);
  const endLineRaw = args["endLine"];
  const parsed: ReadFileArgs = {
    path,
    startLine,
    maxBytes: optionalInt(args, "maxBytes", DEFAULT_TOOL_OUTPUT_BYTES, 1_000, MAX_TOOL_OUTPUT_BYTES),
  };
  if (typeof endLineRaw === "number" && Number.isFinite(endLineRaw)) {
    parsed.endLine = Math.max(startLine, Math.trunc(endLineRaw));
  }
  return parsed;
}

function gitDiff(scope: ReviewScope, args: GitDiffArgs): GitDiffSuccess | ReviewToolFailure {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const pathspec = pathspecFor(scope, args.path);
  const gitArgs = ["diff"];

  if (args.mode === "stat") {
    gitArgs.push("--stat", range);
  } else if (args.mode === "name-only") {
    gitArgs.push("--name-only", range);
  } else if (args.mode === "name-status") {
    gitArgs.push("--name-status", range);
  } else {
    gitArgs.push(`--unified=${args.unified}`, range);
  }

  gitArgs.push("--", ...pathspec);
  const output = runGit(scope.repoRoot, gitArgs);
  const limited = enforceOutputLimit(output, args.maxBytes);
  if (typeof limited !== "string") {
    return outputTooLarge(
      "git_diff",
      limited.bytes,
      args.maxBytes,
      "Narrow the diff with a repo-relative path, use mode=name-status first, or lower unified context.",
    );
  }
  const result: GitDiffSuccess = {
    ok: true,
    tool: "git_diff",
    range,
    mode: args.mode,
    pathspec,
    output: limited,
  };
  const evidence = evidenceForDiff(args.mode, args.path);
  if (evidence) {
    result.evidence = evidence;
  }
  return result;
}

function gitLog(scope: ReviewScope, args: GitLogArgs): GitLogSuccess {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const gitArgs = ["log", `--max-count=${args.maxCount}`];
  if (args.format === "oneline") {
    gitArgs.push("--oneline");
  } else {
    gitArgs.push("--format=medium");
  }
  gitArgs.push(range);
  if (args.path) {
    gitArgs.push("--", args.path);
  }
  const output = runGit(scope.repoRoot, gitArgs);
  const result: GitLogSuccess = {
    ok: true,
    tool: "git_log",
    range,
    format: args.format,
    maxCount: args.maxCount,
    output,
    ...(args.path ? {} : { evidence: { kind: "git_log" } }),
  };
  if (args.path) {
    result.path = args.path;
  }
  return result;
}

function listFiles(scope: ReviewScope, args: ListFilesArgs): ListFilesSuccess | ReviewToolFailure {
  let output: string;
  if (args.kind === "changed") {
    const pathspec = pathspecFor(scope, args.path);
    output = runGit(scope.repoRoot, [
      "diff",
      "--name-status",
      `${scope.fromSha}..${scope.toSha}`,
      "--",
      ...pathspec,
    ]);
  } else {
    output = runGit(scope.repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      scope.toSha,
      ...(args.path ? ["--", args.path] : []),
    ]);
  }

  const entries = output.split("\n").filter(Boolean);
  if (entries.length > args.maxEntries) {
    return toolError("list_files", "too_many_entries", {
      count: entries.length,
      maxEntries: args.maxEntries,
      advice: "Narrow with path or raise maxEntries.",
    });
  }
  const result: ListFilesSuccess = {
    ok: true,
    tool: "list_files",
    kind: args.kind,
    count: entries.length,
    entries,
  };
  if (args.kind === "changed" && !args.path) {
    result.evidence = { kind: "list_changed_files" };
  }
  if (args.path) {
    result.path = args.path;
  }
  return result;
}

function readBlobAtReviewHead(scope: ReviewScope, path: string): Buffer | undefined {
  try {
    return runGitBuffer(scope.repoRoot, ["show", `${scope.toSha}:${path}`]);
  } catch {
    return undefined;
  }
}

function readFileTool(scope: ReviewScope, args: ReadFileArgs): ReadFileSuccess | ReviewToolFailure {
  const buffer = readBlobAtReviewHead(scope, args.path);
  if (!buffer) {
    return toolError("read_file", "not_found_at_review_head", {
      path: args.path,
      commit: scope.toSha,
      message: "File is not present at the reviewed head commit; deleted files require diff context instead.",
    });
  }
  if (buffer.includes(0)) {
    return toolError("read_file", "binary_file", { path: args.path, commit: scope.toSha, bytes: buffer.length });
  }
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const startLine = Math.min(args.startLine, Math.max(1, lines.length));
  const requestedEnd = args.endLine ?? lines.length;
  const endLine = Math.min(Math.max(requestedEnd, startLine), lines.length);
  const content = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
  const limited = enforceOutputLimit(content, args.maxBytes);
  if (typeof limited !== "string") {
    return outputTooLarge("read_file", limited.bytes, args.maxBytes, "Read a narrower line range with startLine/endLine.");
  }
  return {
    ok: true,
    tool: "read_file",
    path: args.path,
    commit: scope.toSha,
    startLine,
    endLine,
    totalLines: lines.length,
    content: limited,
    evidence: { kind: "read_file", path: args.path },
  };
}

function serializeToolResult(result: ReviewToolResult): string {
  return JSON.stringify(result);
}

function execution(name: string, args: ReviewToolExecution["args"], result: ReviewToolResult): ReviewToolExecution {
  return { name, args, result, output: serializeToolResult(result) };
}

function isReviewToolName(name: string): name is ReviewToolName {
  return name === "git_diff" || name === "git_log" || name === "list_files" || name === "read_file";
}

export class ReviewToolRegistry {
  constructor(private readonly scope: ReviewScope) {}

  openAITools(): Tool[] {
    return [...TOOL_DEFINITIONS];
  }

  invalidArguments(name: string, message: string, raw: unknown): ReviewToolExecution {
    return execution(name, {}, toolError(name, "invalid_arguments_json", { message, raw }));
  }

  execute(name: string, rawArgs: unknown): ReviewToolExecution {
    if (!isReviewToolName(name)) {
      return execution(name, {}, toolError(name, "unknown_tool", { message: `Unknown tool: ${name}` }));
    }

    try {
      switch (name) {
        case "git_diff": {
          const args = parseGitDiffArgs(this.scope, rawArgs);
          return execution(name, args, gitDiff(this.scope, args));
        }
        case "git_log": {
          const args = parseGitLogArgs(this.scope, rawArgs);
          return execution(name, args, gitLog(this.scope, args));
        }
        case "list_files": {
          const args = parseListFilesArgs(this.scope, rawArgs);
          return execution(name, args, listFiles(this.scope, args));
        }
        case "read_file": {
          const args = parseReadFileArgs(this.scope, rawArgs);
          return execution(name, args, readFileTool(this.scope, args));
        }
        default: {
          const exhaustive: never = name;
          return execution(exhaustive, {}, toolError(exhaustive, "unknown_tool"));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return execution(name, {}, toolError(name, "tool_exception", { message }));
    }
  }
}

const REQUIRED_EVIDENCE: readonly ReviewEvidenceKind[] = [
  "git_diff_stat",
  "git_diff_name_status",
  "git_log",
];

const EVIDENCE_LABELS: Record<ReviewEvidenceKind, string> = {
  git_diff_stat: "git_diff(mode=stat)",
  git_diff_name_status: "git_diff(mode=name-status)",
  git_log: "git_log",
};

export class ReviewEvidenceTracker {
  private readonly seen = new Set<ReviewEvidenceKind>();

  record(execution: ReviewToolExecution): void {
    const result = execution.result;
    if (!result.ok) {
      return;
    }
    const kind = result.evidence?.kind;
    if (kind === "git_diff_stat" || kind === "git_diff_name_status" || kind === "git_log") {
      this.seen.add(kind);
    }
  }

  isSatisfied(): boolean {
    return this.missing().length === 0;
  }

  missing(): ReviewEvidenceKind[] {
    return REQUIRED_EVIDENCE.filter((kind) => !this.seen.has(kind));
  }

  missingLabels(): string[] {
    return this.missing().map((kind) => EVIDENCE_LABELS[kind]);
  }
}

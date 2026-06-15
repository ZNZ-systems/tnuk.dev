import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { reviewDiffPathspec } from "../git/push-scope.js";
import type { ReviewScope } from "../types.js";

const MAX_GIT_BUFFER_BYTES = 32 * 1024 * 1024;
const DEFAULT_TOOL_OUTPUT_BYTES = 80_000;
const MAX_TOOL_OUTPUT_BYTES = 200_000;
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 2_000;

export interface ReviewToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export const REVIEW_TOOLS: readonly ReviewToolDefinition[] = [
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
      "List changed files in the review scope, or tracked repository files. Changed-file lists use the same lock/generated exclusions as the review gate.",
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
      "Read a tracked repo file with optional line bounds. Use this after identifying changed files to inspect surrounding implementation context.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Repo-relative tracked file path to read.",
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
] as const;

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
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

function toolOk(payload: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...payload });
}

function toolError(error: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error, ...payload });
}

function outputTooLarge(bytes: number, maxBytes: number, advice: string): string {
  return toolError("output_too_large", { bytes, maxBytes, advice });
}

function gitDiff(scope: ReviewScope, args: Record<string, unknown>): string {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const mode = optionalString(args, "mode") ?? "patch";
  const maxBytes = optionalInt(args, "maxBytes", DEFAULT_TOOL_OUTPUT_BYTES, 1_000, MAX_TOOL_OUTPUT_BYTES);
  const pathspec = pathspecFor(scope, optionalString(args, "path"));
  const gitArgs = ["diff"];

  if (mode === "stat") {
    gitArgs.push("--stat", range);
  } else if (mode === "name-only") {
    gitArgs.push("--name-only", range);
  } else if (mode === "name-status") {
    gitArgs.push("--name-status", range);
  } else if (mode === "patch") {
    const unified = optionalInt(args, "unified", 3, 0, 80);
    gitArgs.push(`--unified=${unified}`, range);
  } else {
    return toolError("invalid_mode", { allowed: ["stat", "patch", "name-only", "name-status"] });
  }

  gitArgs.push("--", ...pathspec);
  const output = runGit(scope.repoRoot, gitArgs);
  const limited = enforceOutputLimit(output, maxBytes);
  if (typeof limited !== "string") {
    return outputTooLarge(
      limited.bytes,
      maxBytes,
      "Narrow the diff with a repo-relative path, use mode=name-status first, or lower unified context.",
    );
  }
  return toolOk({ range, mode, pathspec, output: limited });
}

function gitLog(scope: ReviewScope, args: Record<string, unknown>): string {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const format = optionalString(args, "format") ?? "oneline";
  const maxCount = optionalInt(args, "maxCount", 50, 1, 200);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  const gitArgs = ["log", `--max-count=${maxCount}`];
  if (format === "oneline") {
    gitArgs.push("--oneline");
  } else if (format === "medium") {
    gitArgs.push("--format=medium");
  } else {
    return toolError("invalid_format", { allowed: ["oneline", "medium"] });
  }
  gitArgs.push(range);
  if (path) {
    gitArgs.push("--", path);
  }
  const output = runGit(scope.repoRoot, gitArgs);
  return toolOk({ range, format, maxCount, ...(path ? { path } : {}), output });
}

function listFiles(scope: ReviewScope, args: Record<string, unknown>): string {
  const kind = optionalString(args, "kind") ?? "changed";
  const maxEntries = optionalInt(args, "maxEntries", DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  let output: string;
  if (kind === "changed") {
    const pathspec = pathspecFor(scope, path);
    output = runGit(scope.repoRoot, [
      "diff",
      "--name-status",
      `${scope.fromSha}..${scope.toSha}`,
      "--",
      ...pathspec,
    ]);
  } else if (kind === "tracked") {
    output = runGit(scope.repoRoot, ["ls-files", ...(path ? ["--", path] : [])]);
  } else {
    return toolError("invalid_kind", { allowed: ["changed", "tracked"] });
  }

  const entries = output.split("\n").filter(Boolean);
  if (entries.length > maxEntries) {
    return toolError("too_many_entries", {
      count: entries.length,
      maxEntries,
      advice: "Narrow with path or raise maxEntries.",
    });
  }
  return toolOk({ kind, count: entries.length, ...(path ? { path } : {}), entries });
}

function assertTracked(scope: ReviewScope, path: string): void {
  runGit(scope.repoRoot, ["ls-files", "--error-unmatch", "--", path]);
}

function readFileTool(scope: ReviewScope, args: Record<string, unknown>): string {
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  if (!path) {
    return toolError("missing_path");
  }
  assertTracked(scope, path);
  const absolute = resolve(scope.repoRoot, path);
  const stat = statSync(absolute);
  if (!stat.isFile()) {
    return toolError("not_a_file", { path });
  }
  if (stat.size > MAX_GIT_BUFFER_BYTES) {
    return toolError("file_too_large", { path, bytes: stat.size });
  }

  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) {
    return toolError("binary_file", { path, bytes: buffer.length });
  }
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const startLine = optionalInt(args, "startLine", 1, 1, Math.max(1, lines.length));
  const requestedEnd = optionalInt(args, "endLine", lines.length, startLine, Math.max(startLine, lines.length));
  const endLine = Math.min(requestedEnd, lines.length);
  const maxBytes = optionalInt(args, "maxBytes", DEFAULT_TOOL_OUTPUT_BYTES, 1_000, MAX_TOOL_OUTPUT_BYTES);
  const content = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
  const limited = enforceOutputLimit(content, maxBytes);
  if (typeof limited !== "string") {
    return outputTooLarge(limited.bytes, maxBytes, "Read a narrower line range with startLine/endLine.");
  }
  return toolOk({ path, startLine, endLine, totalLines: lines.length, content: limited });
}

export function executeReviewTool(scope: ReviewScope, name: string, rawArgs: unknown): string {
  const args = asRecord(rawArgs);
  try {
    switch (name) {
      case "git_diff":
        return gitDiff(scope, args);
      case "git_log":
        return gitLog(scope, args);
      case "list_files":
        return listFiles(scope, args);
      case "read_file":
        return readFileTool(scope, args);
      default:
        return toolError("unknown_tool", { name });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError("tool_exception", { message });
  }
}

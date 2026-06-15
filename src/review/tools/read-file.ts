import type { ReviewScope } from "../../types.js";
import { asRecord, optionalInt, optionalString } from "./arg-parsing.js";
import { readBlobAtReviewHead } from "./file-reader.js";
import { DEFAULT_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_BYTES } from "./limits.js";
import { requiredRepoPath } from "./paths.js";
import { enforceOutputLimit, outputTooLarge, toolError } from "./results.js";
import { defineTool, type ReviewToolFailure, type ReviewToolSuccess } from "./tool-types.js";

export interface ReadFileArgs {
  path: string;
  startLine: number;
  endLine?: number;
  maxBytes: number;
}

interface ReadFilePayload {
  path: string;
  commit: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export type ReadFileResult = ReviewToolSuccess<"read_file", ReadFilePayload> | ReviewToolFailure;

function parseReadFileArgs(scope: ReviewScope, raw: unknown): ReadFileArgs {
  const args = asRecord(raw);
  const path = requiredRepoPath(scope.repoRoot, optionalString(args, "path"));
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

function executeReadFile(scope: ReviewScope, args: ReadFileArgs): ReadFileResult {
  const buffer = readBlobAtReviewHead(scope, args.path);
  if (!buffer) {
    return toolError("read_file", "not_found_at_review_head", {
      path: args.path,
      commit: scope.toSha,
      message: "File is not present at the reviewed head commit; deleted files require diff context instead.",
    });
  }
  if (buffer.includes(0)) {
    return toolError("read_file", "binary_file", {
      path: args.path,
      commit: scope.toSha,
      bytes: buffer.length,
    });
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
  };
}

export const readFileDescriptor = defineTool<"read_file", ReadFileArgs, ReadFileResult>({
  schema: {
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
          description: "Literal repo-relative tracked file path to read at the reviewed head commit.",
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
  parse: parseReadFileArgs,
  execute: executeReadFile,
  evidence: (args) => ({ kind: "read_file", path: args.path }),
});

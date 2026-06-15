import type { ReviewScope } from "../../types.js";
import { asRecord, enumValue, optionalInt, optionalString } from "./arg-parsing.js";
import { runGit } from "./git.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "./limits.js";
import { literalPathspec, repoPath, reviewPathspecFor } from "./paths.js";
import { toolError } from "./results.js";
import { defineTool, type ReviewToolFailure, type ReviewToolSuccess } from "./tool-types.js";

export type ListFilesKind = "changed" | "tracked";

export interface ListFilesArgs {
  kind: ListFilesKind;
  path?: string;
  maxEntries: number;
}

interface ListFilesPayload {
  kind: ListFilesKind;
  count: number;
  path?: string;
  entries: string[];
}

export type ListFilesResult = ReviewToolSuccess<"list_files", ListFilesPayload> | ReviewToolFailure;

const KINDS = ["changed", "tracked"] as const;

function parseListFilesArgs(scope: ReviewScope, raw: unknown): ListFilesArgs {
  const args = asRecord(raw);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    kind: enumValue(optionalString(args, "kind"), KINDS, "changed"),
    ...(path ? { path } : {}),
    maxEntries: optionalInt(args, "maxEntries", DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
  };
}

function executeListFiles(scope: ReviewScope, args: ListFilesArgs): ListFilesResult {
  let output: string;
  if (args.kind === "changed") {
    output = runGit(scope.repoRoot, [
      "diff",
      "--name-status",
      `${scope.fromSha}..${scope.toSha}`,
      "--",
      ...reviewPathspecFor(args.path),
    ]);
  } else {
    output = runGit(scope.repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      scope.toSha,
      ...(args.path ? ["--", literalPathspec(args.path)] : []),
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
  return {
    ok: true,
    tool: "list_files",
    kind: args.kind,
    count: entries.length,
    ...(args.path ? { path: args.path } : {}),
    entries,
  };
}

export const listFilesDescriptor = defineTool<"list_files", ListFilesArgs, ListFilesResult>({
  schema: {
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
          enum: KINDS,
          description: "Which file set to list. Defaults to changed.",
        },
        path: {
          type: "string",
          description: "Optional literal repo-relative directory or file path to narrow results.",
        },
        maxEntries: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description:
            "Maximum entries to return. Oversized lists return an explicit too_many_entries error rather than truncating.",
        },
      },
    },
    strict: false,
  },
  parse: parseListFilesArgs,
  execute: executeListFiles,
  evidence: (args) => (args.kind === "changed" && !args.path ? { kind: "list_changed_files" } : undefined),
});

import type { ReviewScope } from "../../types.js";
import { asRecord, enumValue, optionalInt, optionalString } from "./arg-parsing.js";
import { runGit } from "./git.js";
import { DEFAULT_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_BYTES } from "./limits.js";
import { repoPath, reviewPathspecFor } from "./paths.js";
import { enforceOutputLimit, outputTooLarge } from "./results.js";
import { defineTool, type ReviewToolFailure, type ReviewToolSuccess } from "./tool-types.js";

export type GitDiffMode = "stat" | "patch" | "name-only" | "name-status";

export interface GitDiffArgs {
  mode: GitDiffMode;
  path?: string;
  unified: number;
  maxBytes: number;
}

interface GitDiffPayload {
  range: string;
  mode: GitDiffMode;
  pathspec: string[];
  output: string;
}

export type GitDiffResult = ReviewToolSuccess<"git_diff", GitDiffPayload> | ReviewToolFailure;

const MODES = ["stat", "patch", "name-only", "name-status"] as const;

function parseGitDiffArgs(scope: ReviewScope, raw: unknown): GitDiffArgs {
  const args = asRecord(raw);
  const mode = enumValue(optionalString(args, "mode"), MODES, "patch");
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    mode,
    ...(path ? { path } : {}),
    unified: optionalInt(args, "unified", 3, 0, 80),
    maxBytes: optionalInt(args, "maxBytes", DEFAULT_TOOL_OUTPUT_BYTES, 1_000, MAX_TOOL_OUTPUT_BYTES),
  };
}

function executeGitDiff(scope: ReviewScope, args: GitDiffArgs): GitDiffResult {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const pathspec = reviewPathspecFor(args.path);
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
  return {
    ok: true,
    tool: "git_diff",
    range,
    mode: args.mode,
    pathspec,
    output: limited,
  };
}

export const gitDiffDescriptor = defineTool<"git_diff", GitDiffArgs, GitDiffResult>({
  schema: {
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
          enum: MODES,
          description: "Diff view to return. Defaults to patch.",
        },
        path: {
          type: "string",
          description: "Optional literal repo-relative file or directory path to narrow the diff.",
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
  parse: parseGitDiffArgs,
  execute: executeGitDiff,
  evidence: (args) => {
    if (args.mode === "stat" && !args.path) {
      return { kind: "git_diff_stat" };
    }
    if (args.mode === "name-status" && !args.path) {
      return { kind: "git_diff_name_status" };
    }
    if (args.mode === "patch") {
      return args.path ? { kind: "git_diff_patch", path: args.path } : { kind: "git_diff_patch" };
    }
    return undefined;
  },
  requiredEvidence: [
    { kind: "git_diff_stat", label: "git_diff(mode=stat)" },
    { kind: "git_diff_name_status", label: "git_diff(mode=name-status)" },
  ],
});

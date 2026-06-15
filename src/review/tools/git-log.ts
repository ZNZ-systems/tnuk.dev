import type { ReviewScope } from "../../types.js";
import { asRecord, enumValue, optionalInt, optionalString } from "./arg-parsing.js";
import { runGit } from "./git.js";
import { literalPathspec, repoPath } from "./paths.js";
import { defineTool, type ReviewToolFailure, type ReviewToolSuccess } from "./tool-types.js";

export type GitLogFormat = "oneline" | "medium";

export interface GitLogArgs {
  format: GitLogFormat;
  maxCount: number;
  path?: string;
}

interface GitLogPayload {
  range: string;
  format: GitLogFormat;
  maxCount: number;
  path?: string;
  output: string;
}

export type GitLogResult = ReviewToolSuccess<"git_log", GitLogPayload> | ReviewToolFailure;

const FORMATS = ["oneline", "medium"] as const;

function parseGitLogArgs(scope: ReviewScope, raw: unknown): GitLogArgs {
  const args = asRecord(raw);
  const path = repoPath(scope.repoRoot, optionalString(args, "path"));
  return {
    format: enumValue(optionalString(args, "format"), FORMATS, "oneline"),
    maxCount: optionalInt(args, "maxCount", 50, 1, 200),
    ...(path ? { path } : {}),
  };
}

function executeGitLog(scope: ReviewScope, args: GitLogArgs): GitLogResult {
  const range = `${scope.fromSha}..${scope.toSha}`;
  const gitArgs = ["log", `--max-count=${args.maxCount}`];
  if (args.format === "oneline") {
    gitArgs.push("--oneline");
  } else {
    gitArgs.push("--format=medium");
  }
  gitArgs.push(range);
  if (args.path) {
    gitArgs.push("--", literalPathspec(args.path));
  }
  const output = runGit(scope.repoRoot, gitArgs);
  return {
    ok: true,
    tool: "git_log",
    range,
    format: args.format,
    maxCount: args.maxCount,
    ...(args.path ? { path: args.path } : {}),
    output,
  };
}

export const gitLogDescriptor = defineTool<"git_log", GitLogArgs, GitLogResult>({
  schema: {
    type: "function",
    name: "git_log",
    description: "Inspect commits in the review scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: {
          type: "string",
          enum: FORMATS,
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
          description: "Optional literal repo-relative file or directory path to narrow the log.",
        },
      },
    },
    strict: false,
  },
  parse: parseGitLogArgs,
  execute: executeGitLog,
  evidence: (args) => (args.path ? undefined : { kind: "git_log" }),
  requiredEvidence: [{ kind: "git_log", label: "git_log" }],
});

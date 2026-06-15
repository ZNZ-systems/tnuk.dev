import type { Tool } from "openai/resources/responses/responses";

import type { ReviewScope } from "../../types.js";

export type ReviewEvidenceKind = "git_diff_stat" | "git_diff_name_status" | "git_log";
export type ReviewToolEvidenceKind =
  | ReviewEvidenceKind
  | "read_file"
  | "git_diff_patch"
  | "list_changed_files";

export interface ReviewToolEvidence {
  kind: ReviewToolEvidenceKind;
  path?: string;
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

export type ReviewToolSuccess<Name extends string, Payload extends object> = {
  ok: true;
  tool: Name;
  evidence?: ReviewToolEvidence;
} & Payload;

export interface AnyReviewToolSuccess {
  ok: true;
  tool: string;
  evidence?: ReviewToolEvidence;
}

export type AnyReviewToolResult = AnyReviewToolSuccess | ReviewToolFailure;

export interface RequiredReviewEvidence {
  kind: ReviewEvidenceKind;
  label: string;
}

export type OpenAIToolSchema<Name extends string> = Tool & {
  type: "function";
  name: Name;
};

export interface ToolDescriptor<
  Name extends string,
  Args,
  Result extends AnyReviewToolResult,
> {
  readonly schema: OpenAIToolSchema<Name>;
  parse(scope: ReviewScope, raw: unknown): Args;
  execute(scope: ReviewScope, args: Args): Result;
  evidence?(args: Args, result: Extract<Result, { ok: true }>): ReviewToolEvidence | undefined;
  readonly requiredEvidence?: readonly RequiredReviewEvidence[];
}

export interface RuntimeToolDescriptor {
  readonly schema: Tool;
  parse(scope: ReviewScope, raw: unknown): unknown;
  execute(scope: ReviewScope, args: unknown): AnyReviewToolResult;
  evidence?(args: unknown, result: AnyReviewToolSuccess): ReviewToolEvidence | undefined;
  readonly requiredEvidence?: readonly RequiredReviewEvidence[];
}

export type DefinedToolDescriptor<
  Name extends string,
  Args,
  Result extends AnyReviewToolResult,
> = ToolDescriptor<Name, Args, Result> & {
  readonly runtime: RuntimeToolDescriptor;
};

export function runtimeToolDescriptor<
  Name extends string,
  Args,
  Result extends AnyReviewToolResult,
>(descriptor: ToolDescriptor<Name, Args, Result>): RuntimeToolDescriptor {
  const evidence = descriptor.evidence;
  return {
    schema: descriptor.schema,
    parse: (scope, raw) => descriptor.parse(scope, raw),
    execute: (scope, args) => descriptor.execute(scope, args as Args),
    ...(evidence
      ? { evidence: (args, result) => evidence(args as Args, result as Extract<Result, { ok: true }>) }
      : {}),
    ...(descriptor.requiredEvidence ? { requiredEvidence: descriptor.requiredEvidence } : {}),
  };
}

export function defineTool<
  Name extends string,
  Args,
  Result extends AnyReviewToolResult,
>(descriptor: ToolDescriptor<Name, Args, Result>): DefinedToolDescriptor<Name, Args, Result> {
  return Object.freeze({
    ...descriptor,
    runtime: runtimeToolDescriptor(descriptor),
  });
}

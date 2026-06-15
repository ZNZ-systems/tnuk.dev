import type { Tool } from "openai/resources/responses/responses";

import type { ReviewScope } from "../../types.js";
import {
  getToolDescriptor,
  TOOL_DEFINITIONS,
  type ReviewToolArgs,
  type ReviewToolResult,
} from "./descriptors.js";
import { serializeToolResult, toolError } from "./results.js";
import type { AnyReviewToolResult, RuntimeToolDescriptor } from "./tool-types.js";

export interface ReviewToolExecution {
  name: string;
  args: ReviewToolArgs | Record<string, never>;
  result: ReviewToolResult;
  output: string;
}

function execution(
  name: string,
  args: ReviewToolExecution["args"],
  result: ReviewToolResult,
): ReviewToolExecution {
  return { name, args, result, output: serializeToolResult(result) };
}

function attachDescriptorEvidence(
  descriptor: RuntimeToolDescriptor,
  args: unknown,
  result: AnyReviewToolResult,
): AnyReviewToolResult {
  if (!result.ok) {
    return result;
  }
  const evidence = descriptor.evidence?.(args, result);
  return evidence ? { ...result, evidence } : result;
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
    const descriptor = getToolDescriptor(name);
    if (!descriptor) {
      return execution(name, {}, toolError(name, "unknown_tool", { message: `Unknown tool: ${name}` }));
    }

    try {
      const args = descriptor.parse(this.scope, rawArgs);
      const rawResult = descriptor.execute(this.scope, args);
      const result = attachDescriptorEvidence(descriptor, args, rawResult) as ReviewToolResult;
      return execution(name, args as ReviewToolArgs, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return execution(name, {}, toolError(name, "tool_exception", { message }));
    }
  }
}

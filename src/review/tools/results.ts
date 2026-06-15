import type { AnyReviewToolResult, ReviewToolFailure } from "./tool-types.js";

export function enforceOutputLimit(
  output: string,
  maxBytes: number,
): string | { tooLarge: true; bytes: number } {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= maxBytes) {
    return output;
  }
  return { tooLarge: true, bytes };
}

export function toolError(
  tool: string,
  error: string,
  payload: Omit<ReviewToolFailure, "ok" | "tool" | "error"> = {},
): ReviewToolFailure {
  return { ok: false, tool, error, ...payload };
}

export function outputTooLarge(
  tool: string,
  bytes: number,
  maxBytes: number,
  advice: string,
): ReviewToolFailure {
  return toolError(tool, "output_too_large", { bytes, maxBytes, advice });
}

export function serializeToolResult(result: AnyReviewToolResult): string {
  return JSON.stringify(result);
}

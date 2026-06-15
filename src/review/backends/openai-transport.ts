import type { ResponseInput, ResponseInputItem, Tool } from "openai/resources/responses/responses";

import type { BackendError } from "../backend.js";

export interface OpenAIToolRoundRequest {
  model: string;
  instructions: string;
  input: ResponseInput;
  tools: Tool[];
  signal: AbortSignal;
}

export interface OpenAIToolRoundResult {
  rawText: string;
  responseId: string | undefined;
  outputItems: ResponseInputItem[];
  incompleteDetails: unknown;
}

export interface OpenAITransport {
  readonly id: "api" | "chatgpt";
  runToolRound(request: OpenAIToolRoundRequest): Promise<OpenAIToolRoundResult>;
  mapError(err: unknown): BackendError;
}

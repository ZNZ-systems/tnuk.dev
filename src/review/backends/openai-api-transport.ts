import OpenAI from "openai";
import type { Response, ResponseInputItem } from "openai/resources/responses/responses";

import { loadOpenAIApiKey, openaiModel } from "../../config.js";
import { BackendError } from "../backend.js";
import type { OpenAIToolRoundRequest, OpenAIToolRoundResult, OpenAITransport } from "./openai-transport.js";

const REQUEST_TIMEOUT_MS = 600_000;

const MISSING_OPENAI_API_KEY_MESSAGE =
  "OPENAI_API_KEY not set for the OpenAI provider.\n" +
  '  export OPENAI_API_KEY="sk-..."\n' +
  "  or add it to ~/.config/thermo-review/env\n" +
  "  (Experimental ChatGPT OAuth requires THERMO_REVIEW_OPENAI_AUTH=chatgpt.)";

function extractText(response: Response): string {
  if (response.output_text) {
    return response.output_text;
  }
  const chunks: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }
    for (const block of item.content) {
      if (block.type === "output_text") {
        chunks.push(block.text);
      }
    }
  }
  return chunks.join("");
}

function mapOfficialError(err: unknown): BackendError {
  if (err instanceof BackendError) {
    return err;
  }
  const status = (err as { status?: unknown }).status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403 || /invalid_grant|unauthorized/i.test(message)) {
    return new BackendError(
      `OpenAI API key rejected${typeof status === "number" ? ` (${status})` : ""}. Check OPENAI_API_KEY.`,
      "config",
    );
  }
  if (status === 404 || /model.*not found|not supported/i.test(message)) {
    return new BackendError(
      `Model "${openaiModel()}" is not available for the official OpenAI API. Set THERMO_REVIEW_OPENAI_MODEL to one it serves.`,
      "agent",
    );
  }
  return new BackendError(`OpenAI review failed: ${message}`, "agent");
}

export function createOpenAIApiTransport(): OpenAITransport {
  const apiKey = loadOpenAIApiKey();
  if (!apiKey) {
    throw new BackendError(MISSING_OPENAI_API_KEY_MESSAGE, "config");
  }

  const client = new OpenAI({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return {
    id: "api",
    async runToolRound(request: OpenAIToolRoundRequest): Promise<OpenAIToolRoundResult> {
      const response = await client.responses.create(
        {
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          include: ["reasoning.encrypted_content"],
          tools: request.tools,
          tool_choice: "auto",
          parallel_tool_calls: true,
          stream: false,
          store: false,
          reasoning: { effort: "high" },
          truncation: "disabled",
        },
        { signal: request.signal },
      );
      if (response.error) {
        throw new Error(`${response.error.code}: ${response.error.message}`);
      }
      return {
        rawText: extractText(response),
        responseId: response.id,
        outputItems: response.output as ResponseInputItem[],
        incompleteDetails: response.incomplete_details,
      };
    },
    mapError: mapOfficialError,
  };
}

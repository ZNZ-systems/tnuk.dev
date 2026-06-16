import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";

import { CHATGPT_CODEX_BASE_URL, chatGptBackendHeaders } from "../../auth/openai-private-backend.js";
import { getValidCredentials } from "../../auth/token-store.js";
import { DEFAULT_OPENAI_REASONING_EFFORT, openaiModel } from "../../config.js";
import { BackendError } from "../backend.js";
import type { OpenAIToolRoundRequest, OpenAIToolRoundResult, OpenAITransport } from "./openai-transport.js";

const REQUEST_TIMEOUT_MS = 600_000;

function eventResponse(raw: unknown): { id?: unknown; output?: unknown; incomplete_details?: unknown } | undefined {
  const response = (raw as { response?: unknown }).response;
  return typeof response === "object" && response !== null
    ? (response as { id?: unknown; output?: unknown; incomplete_details?: unknown })
    : undefined;
}

async function consumeResponseStream(stream: AsyncIterable<unknown>): Promise<OpenAIToolRoundResult> {
  const chunks: string[] = [];
  const outputItems: ResponseInputItem[] = [];
  let responseId: string | undefined;
  let incompleteDetails: unknown;

  for await (const raw of stream) {
    const event = raw as { type?: unknown; delta?: unknown; item?: unknown };
    const response = eventResponse(raw);
    if (typeof response?.id === "string") {
      responseId = response.id;
    }

    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      chunks.push(event.delta);
    } else if (event.type === "response.output_item.done" && typeof event.item === "object" && event.item) {
      outputItems.push(event.item as ResponseInputItem);
    } else if (event.type === "response.completed" && Array.isArray(response?.output) && outputItems.length === 0) {
      outputItems.push(...(response.output as ResponseInputItem[]));
    } else if (event.type === "response.incomplete") {
      incompleteDetails = response?.incomplete_details ?? raw;
    } else if (event.type === "error" || event.type === "response.failed") {
      throw new Error(`backend stream error: ${JSON.stringify(raw).slice(0, 500)}`);
    }
  }

  return { rawText: chunks.join(""), responseId, outputItems, incompleteDetails };
}

function mapChatGptError(err: unknown): BackendError {
  if (err instanceof BackendError) {
    return err;
  }
  const status = (err as { status?: unknown }).status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403 || /invalid_grant|unauthorized/i.test(message)) {
    return new BackendError(
      `OpenAI ChatGPT auth rejected${typeof status === "number" ? ` (${status})` : ""}. Run \`thermo-review login\` again.`,
      "config",
    );
  }
  if (status === 404 || /model.*not found|not supported/i.test(message)) {
    return new BackendError(
      `Model "${openaiModel()}" is not available on this ChatGPT plan. Set THERMO_REVIEW_OPENAI_MODEL to one it serves.`,
      "agent",
    );
  }
  return new BackendError(`OpenAI ChatGPT review failed: ${message}`, "agent");
}

export async function createChatGptCodexTransport(): Promise<OpenAITransport> {
  const creds = await getValidCredentials();
  const client = new OpenAI({
    baseURL: CHATGPT_CODEX_BASE_URL,
    apiKey: creds.accessToken,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: chatGptBackendHeaders(creds.accountId),
  });

  return {
    id: "chatgpt",
    async runToolRound(request: OpenAIToolRoundRequest): Promise<OpenAIToolRoundResult> {
      // The undocumented ChatGPT/Codex endpoint rejects non-streaming requests and
      // `truncation: "disabled"`, but does support streamed function-tool calls.
      const stream = await client.responses.create(
        {
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          include: ["reasoning.encrypted_content"],
          tools: request.tools,
          tool_choice: "auto",
          parallel_tool_calls: true,
          stream: true,
          store: false,
          reasoning: { effort: DEFAULT_OPENAI_REASONING_EFFORT },
        },
        { signal: request.signal },
      );
      return consumeResponseStream(stream);
    },
    mapError: mapChatGptError,
  };
}

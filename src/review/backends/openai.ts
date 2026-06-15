import OpenAI from "openai";

import { CHATGPT_CODEX_BASE_URL, CODEX_ORIGINATOR } from "../../auth/openai-endpoints.js";
import { getValidCredentials, type OpenAICredentials } from "../../auth/token-store.js";
import { codexUserAgent, openaiModel, openaiTimeoutMs } from "../../config.js";
import { collectScopeDiff, type ScopeDiff } from "../../git/push-scope.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ProgressFn,
  type ReviewBackend,
} from "../backend.js";

const REQUEST_TIMEOUT_MS = 600_000;

// The diff is injected into the prompt and the review is single-shot: the ChatGPT
// backend is reached via the raw Responses API (the OpenAI Agents SDK run-loop
// cannot parse this backend's stream into a final output, so it never converges).
const SYSTEM_INSTRUCTIONS =
  "You are an automated pre-push code-quality review gate. The diff under review is included in the " +
  "user message (lock/generated files excluded). Review it directly and respond with the verdict in " +
  "exactly the format the message specifies. You have no tools and must not ask for more files.";

function buildClient(creds: OpenAICredentials): OpenAI {
  return new OpenAI({
    baseURL: CHATGPT_CODEX_BASE_URL,
    apiKey: creds.accessToken, // -> Authorization: Bearer <access_token>
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: {
      "ChatGPT-Account-Id": creds.accountId,
      originator: CODEX_ORIGINATOR,
      "User-Agent": codexUserAgent(),
    },
  });
}

function buildUserInput(prompt: string, diff: ScopeDiff): string {
  return [
    prompt,
    "",
    "## Changes under review (lock/generated files excluded)",
    "",
    "### Commits",
    diff.log || "(none)",
    "",
    "### Diff stat",
    diff.stat || "(empty)",
    "",
    `### Diff${diff.truncated ? " (truncated — review what is shown)" : ""}`,
    "```diff",
    diff.patch || "(empty)",
    "```",
  ].join("\n");
}

interface StreamResult {
  body: string;
  responseId: string | undefined;
}

/** Drains the Responses stream, mirroring the review to stderr for liveness. */
async function consumeStream(
  stream: AsyncIterable<unknown>,
  onProgress: ProgressFn,
): Promise<StreamResult> {
  const chunks: string[] = [];
  let responseId: string | undefined;
  let sawActivity = false;
  let streamingText = false;

  for await (const raw of stream) {
    const event = raw as { type?: unknown; delta?: unknown; response?: { id?: unknown } };
    if (!sawActivity) {
      sawActivity = true;
      onProgress("model responding…");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      if (!streamingText) {
        streamingText = true;
        process.stderr.write("[thermo-review] review:\n");
      }
      chunks.push(event.delta);
      process.stderr.write(event.delta);
    } else if (
      (event.type === "response.created" || event.type === "response.completed") &&
      typeof event.response?.id === "string"
    ) {
      responseId = event.response.id;
    } else if (event.type === "error" || event.type === "response.failed") {
      throw new Error(`backend stream error: ${JSON.stringify(raw).slice(0, 300)}`);
    }
  }

  if (streamingText) {
    process.stderr.write("\n");
  }
  return { body: chunks.join(""), responseId };
}

function mapError(err: unknown): BackendError {
  if (err instanceof BackendError) {
    return err;
  }
  const status = (err as { status?: unknown }).status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403 || /invalid_grant|unauthorized/i.test(message)) {
    return new BackendError(
      `OpenAI auth rejected${typeof status === "number" ? ` (${status})` : ""}. Run \`thermo-review login\` again.`,
      "config",
    );
  }
  if (status === 404 || /model.*not found|not supported/i.test(message)) {
    return new BackendError(
      `Model "${openaiModel()}" is not available on this ChatGPT plan. Set THERMO_REVIEW_OPENAI_MODEL to one it serves.`,
      "agent",
    );
  }
  return new BackendError(`OpenAI review failed: ${message}`, "agent");
}

/**
 * Reviews via the OpenAI Responses API against the ChatGPT backend, authenticated
 * with "Sign in with ChatGPT" OAuth. Single-shot: the diff is injected into the
 * prompt and the model returns the verdict in one streamed response.
 */
export class OpenAIBackend implements ReviewBackend {
  readonly id = "openai" as const;

  async preflight(): Promise<void> {
    try {
      await getValidCredentials();
    } catch (err) {
      throw new BackendError(err instanceof Error ? err.message : String(err), "config");
    }
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    const creds = await getValidCredentials();
    const client = buildClient(creds);
    const model = openaiModel();
    const input = buildUserInput(prompt, collectScopeDiff(scope));

    onProgress(`contacting OpenAI (model=${model}, high reasoning — first response can take a minute)…`);

    const timeoutMs = openaiTimeoutMs();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const stream = await client.responses.create(
        {
          model,
          instructions: SYSTEM_INSTRUCTIONS,
          input: [{ role: "user", content: input }],
          include: [],
          tools: [],
          stream: true,
          store: false, // ChatGPT backend requires stateless requests
          reasoning: { effort: "high" },
        },
        { signal: controller.signal },
      );

      const { body, responseId } = await consumeStream(stream, onProgress);
      return { rawText: body, runId: responseId, agentId: undefined };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new BackendError(
          `Review timed out after ${Math.round(timeoutMs / 1000)}s with no completion. ` +
            "Try a smaller diff (--base <ref>), a faster THERMO_REVIEW_OPENAI_MODEL, or raise THERMO_REVIEW_OPENAI_TIMEOUT_MS.",
          "agent",
        );
      }
      throw mapError(err);
    } finally {
      clearTimeout(deadline);
    }
  }
}

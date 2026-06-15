import { Agent, OpenAIProvider, Runner, setTracingDisabled, type RunStreamEvent } from "@openai/agents";
import OpenAI from "openai";

import { CHATGPT_CODEX_BASE_URL, CODEX_ORIGINATOR } from "../../auth/openai-endpoints.js";
import { getValidCredentials, type OpenAICredentials } from "../../auth/token-store.js";
import { codexUserAgent, openaiModel } from "../../config.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ProgressFn,
  type ReviewBackend,
} from "../backend.js";
import { makeRepoTools } from "../tools.js";

const MAX_TURNS = 50;
const REQUEST_TIMEOUT_MS = 600_000; // 10 min ceiling so a stalled request surfaces instead of hanging

// The tracing exporter would otherwise warn ("No API key provided for OpenAI
// tracing exporter") and try to export against api.openai.com — we have no API
// key on the OAuth path, so disable it globally once at module load.
setTracingDisabled(true);

// The `openai` package ships dual CJS/ESM type declarations; under NodeNext +
// exactOptionalPropertyTypes the OpenAI class identity our ESM import resolves to
// differs nominally from the one @openai/agents-openai's types reference, though
// it is the same runtime class. Bridge the two with an explicit cast.
type ProviderOpenAIClient = NonNullable<
  NonNullable<ConstructorParameters<typeof OpenAIProvider>[0]>["openAIClient"]
>;

const AGENT_INSTRUCTIONS = [
  "You are an automated pre-push code-quality review gate.",
  "You have no shell. Inspect the change only through the provided tools:",
  "git_diff(from, to) for the diff, git_log(from, to) for the commit list,",
  "read_file(path) to read sources, and list_files() to browse tracked files.",
  "The user message gives the exact commit range and the full review skill.",
  "Inspect efficiently: read only what you need, do not repeat tool calls, and once you",
  "have enough context, STOP using tools and write the verdict.",
  "Follow the skill strictly and emit the verdict in exactly the required format.",
  "If git_diff returns nothing, there is nothing to review — return VERDICT: PASS immediately.",
].join(" ");

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

async function reportProgress(
  stream: AsyncIterable<RunStreamEvent>,
  onProgress: ProgressFn,
): Promise<void> {
  // Consuming the stream drives the run. Tool-level progress is emitted from the
  // tools themselves; here we surface "model is alive" markers so a long reasoning
  // phase never looks like a hang.
  let sawModelActivity = false;
  for await (const event of stream) {
    if (event.type === "raw_model_stream_event") {
      if (!sawModelActivity) {
        sawModelActivity = true;
        onProgress("model responding…");
      }
      continue;
    }
    if (event.type !== "run_item_stream_event") {
      continue;
    }
    if (event.name === "reasoning_item_created") {
      onProgress("thinking…");
    } else if (event.name === "message_output_created") {
      onProgress("writing review…");
    }
  }
}

function mapError(err: unknown): BackendError {
  if (err instanceof BackendError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/\b401\b|\b403\b|invalid_grant|unauthorized/i.test(message)) {
    return new BackendError(
      `OpenAI auth rejected (${message}). Run \`thermo-review login\` again.`,
      "config",
    );
  }
  if (/max turns/i.test(message)) {
    return new BackendError(
      `Review did not converge within ${MAX_TURNS} agent turns. The diff may be unusually large; ` +
        "narrow the scope (e.g. --base <ref>) or split the change.",
      "agent",
    );
  }
  return new BackendError(`OpenAI agent run failed: ${message}`, "agent");
}

/**
 * Runs the review through the OpenAI Agents SDK against the ChatGPT backend,
 * authenticated with "Sign in with ChatGPT" OAuth tokens. The agent explores the
 * repo through sandboxed git/file tools (the backend has no built-in local tools).
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
    const model = openaiModel();
    onProgress(`contacting OpenAI (model=${model}, high reasoning — first response can take a minute)…`);
    const runner = new Runner({
      modelProvider: new OpenAIProvider({
        openAIClient: buildClient(creds) as unknown as ProviderOpenAIClient,
        useResponses: true,
      }),
      tracingDisabled: true,
    });

    const agent = new Agent({
      name: "thermo-review",
      instructions: AGENT_INSTRUCTIONS,
      model,
      modelSettings: {
        store: false, // ChatGPT backend requires stateless requests
        toolChoice: "auto",
        reasoning: { effort: "high" },
      },
      tools: makeRepoTools(scope.repoRoot, onProgress),
    });

    try {
      const result = await runner.run(agent, prompt, { stream: true, maxTurns: MAX_TURNS });
      await reportProgress(result, onProgress);
      await result.completed;
      const rawText = typeof result.finalOutput === "string" ? result.finalOutput : "";
      return { rawText, runId: result.lastResponseId, agentId: undefined };
    } catch (err) {
      throw mapError(err);
    }
  }
}

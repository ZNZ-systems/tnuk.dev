import { Agent, CursorAgentError, type SDKMessage } from "@cursor/sdk";

import { loadApiKey } from "../../config.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ProgressFn,
  type ReviewBackend,
} from "../backend.js";

const CURSOR_MODEL = "composer-2.5";

const MISSING_KEY_MESSAGE =
  'CURSOR_API_KEY not set.\n' +
  '  export CURSOR_API_KEY="cursor_..."\n' +
  "  or add it to ~/.config/thermo-review/env";

async function streamReviewText(
  stream: AsyncGenerator<SDKMessage, void>,
  onProgress: ProgressFn,
): Promise<string> {
  const chunks: string[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case "assistant":
        for (const block of event.message.content) {
          if (block.type === "text") {
            chunks.push(block.text);
          }
        }
        break;
      case "thinking":
        onProgress("thinking…");
        break;
      case "tool_call":
        onProgress(`tool: ${event.name} (${event.status})`);
        break;
      case "status":
        onProgress(`status: ${event.status}`);
        break;
      default:
        break;
    }
  }

  return chunks.join("");
}

/**
 * Default backend: runs the review through a local Cursor SDK agent, which has
 * built-in shell/file access sandboxed to the repo root via `local.cwd`.
 */
export class CursorBackend implements ReviewBackend {
  readonly id = "cursor" as const;
  readonly capabilities = {
    canInspectRepository: true,
    inspection: "local-agent",
    tools: ["shell", "read_file", "list_files"],
  } as const;

  preflight(): Promise<void> {
    if (!loadApiKey()) {
      throw new BackendError(MISSING_KEY_MESSAGE, "config");
    }
    return Promise.resolve();
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    const apiKey = loadApiKey();
    if (!apiKey) {
      throw new BackendError(MISSING_KEY_MESSAGE, "config");
    }

    try {
      await using agent = await Agent.create({
        apiKey,
        model: { id: CURSOR_MODEL },
        local: {
          cwd: scope.repoRoot,
          settingSources: ["project", "plugins", "user"],
        },
      });

      const run = await agent.send(prompt);
      onProgress(`run started: ${run.id}`);

      const textPromise = streamReviewText(run.stream(), onProgress);
      const waitResult = await run.wait();
      const streamedText = await textPromise;
      const rawText = streamedText || waitResult.result || run.result || "";

      if (waitResult.status === "error") {
        throw new BackendError(`agent run failed (${waitResult.id})`, "agent");
      }

      return { rawText, runId: waitResult.id, agentId: run.agentId };
    } catch (err) {
      if (err instanceof BackendError) {
        throw err;
      }
      if (err instanceof CursorAgentError) {
        throw new BackendError(
          `SDK startup failed: ${err.message} (retryable=${String(err.isRetryable)})`,
          "config",
        );
      }
      throw err;
    }
  }
}

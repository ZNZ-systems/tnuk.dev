import { loadProvider } from "../config.js";
import type { ProviderId, ReviewBackend } from "./backend.js";

/**
 * Resolves the review backend, honoring (in order) an explicit CLI flag, the
 * THERMO_REVIEW_PROVIDER env var, the config file, then defaulting to Cursor.
 *
 * Backends are imported lazily so the Cursor/hook path never loads the heavy
 * `@openai/agents` tree (and vice versa).
 */
export async function resolveBackend(explicit?: ProviderId): Promise<ReviewBackend> {
  const provider = loadProvider(explicit);
  switch (provider) {
    case "openai": {
      const { OpenAIBackend } = await import("./backends/openai.js");
      return new OpenAIBackend();
    }
    case "cursor": {
      const { CursorBackend } = await import("./backends/cursor.js");
      return new CursorBackend();
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

import { loadProvider } from "../config.js";
import type { ProviderId, ReviewBackend } from "./backend.js";

/**
 * Resolves the review backend, honoring (in order) an explicit CLI flag, the
 * THERMO_REVIEW_PROVIDER env var, the config file, then defaulting to OpenAI.
 *
 * Backends are imported lazily so each provider only loads its own SDK/client.
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
    case "claude": {
      const { ClaudeBackend } = await import("./backends/claude.js");
      return new ClaudeBackend();
    }
    case "panel": {
      const { PanelBackend } = await import("./backends/panel.js");
      return new PanelBackend();
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

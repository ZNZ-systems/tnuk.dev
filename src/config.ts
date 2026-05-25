import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");

/** Bundled review skill, shipped inside the package (see skill/SKILL.md). */
const BUNDLED_SKILL = join(PACKAGE_ROOT, "skill", "SKILL.md");

const THERMO_ENV_FILE = join(homedir(), ".config", "thermo-review", "env");

export const TNUK_API_BASE_URL =
  process.env["TNUK_API_BASE_URL"]?.trim() || "https://api.tnuk.dev";

const CONFIG_DIR = join(homedir(), ".config", "tnuk");
export const AUTH_FILE = join(CONFIG_DIR, "auth.json");

export const GIT_TEMPLATE_DIR = join(homedir(), ".git-templates");
export const GIT_TEMPLATE_HOOKS_DIR = join(GIT_TEMPLATE_DIR, "hooks");

export interface StoredAuth {
  token: string;
  /** Unix ms expiry of the token, if known. */
  expiresAt?: number;
  /** Human-readable account hint for `tnuk whoami`. */
  account?: string;
}

export type ReviewCredentials =
  | { mode: "seat"; apiKey: string }
  | { mode: "direct"; apiKey: string };

/**
 * Loads the tnuk auth token from env (TNUK_TOKEN) or ~/.config/tnuk/auth.json.
 */
export function loadAuth(): StoredAuth | undefined {
  const fromEnv = process.env["TNUK_TOKEN"]?.trim();
  if (fromEnv) {
    return { token: fromEnv };
  }

  if (!existsSync(AUTH_FILE)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as StoredAuth;
    if (parsed && typeof parsed.token === "string" && parsed.token.length > 0) {
      if (parsed.expiresAt !== undefined && Date.now() >= parsed.expiresAt) {
        return undefined;
      }
      return parsed;
    }
  } catch {
    // fall through to undefined on malformed file
  }
  return undefined;
}

/**
 * Loads CURSOR_API_KEY from env or ~/.config/thermo-review/env.
 */
export function loadCursorApiKey(): string | undefined {
  const fromEnv = process.env["CURSOR_API_KEY"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (!existsSync(THERMO_ENV_FILE)) {
    return undefined;
  }

  const lines = readFileSync(THERMO_ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const exported = /^export\s+CURSOR_API_KEY=(.+)$/.exec(trimmed);
    if (exported?.[1]) {
      return exported[1].replace(/^["']|["']$/g, "");
    }
    const plain = /^CURSOR_API_KEY=(.+)$/.exec(trimmed);
    if (plain?.[1]) {
      return plain[1].replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

/**
 * Resolves review credentials: direct CURSOR_API_KEY first, then tnuk seat token.
 */
export function loadReviewCredentials(): ReviewCredentials | undefined {
  const direct = loadCursorApiKey();
  if (direct) {
    return { mode: "direct", apiKey: direct };
  }

  const seat = loadAuth();
  if (seat) {
    return { mode: "seat", apiKey: seat.token };
  }

  return undefined;
}

/**
 * Resolves the thermo-nuclear skill markdown (bundled in the package by default).
 */
export function loadSkillContent(): string {
  const override = process.env["THERMO_REVIEW_SKILL_PATH"]?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`Review skill not found at ${override} (THERMO_REVIEW_SKILL_PATH).`);
    }
    return readFileSync(override, "utf8");
  }

  if (!existsSync(BUNDLED_SKILL)) {
    throw new Error(
      `Bundled review skill not found at ${BUNDLED_SKILL}. The tnuk package may be corrupted; reinstall it.`,
    );
  }
  return readFileSync(BUNDLED_SKILL, "utf8");
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return explicitSkip || process.env["TNUK_SKIP"] === "1" || process.env["THERMO_REVIEW_SKIP"] === "1";
}

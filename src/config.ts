import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_FILE = join(homedir(), ".config", "thermo-review", "env");
const SKILL_NAME = "thermo-nuclear-code-quality-review";

export const GIT_TEMPLATE_DIR = join(homedir(), ".git-templates");
export const GIT_TEMPLATE_HOOKS_DIR = join(GIT_TEMPLATE_DIR, "hooks");

/**
 * Loads CURSOR_API_KEY from env or ~/.config/thermo-review/env.
 */
export function loadApiKey(): string | undefined {
  const fromEnv = process.env["CURSOR_API_KEY"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (!existsSync(ENV_FILE)) {
    return undefined;
  }

  const lines = readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^export\s+CURSOR_API_KEY=(.+)$/.exec(trimmed);
    if (match?.[1]) {
      return match[1].replace(/^["']|["']$/g, "");
    }
    const plain = /^CURSOR_API_KEY=(.+)$/.exec(trimmed);
    if (plain?.[1]) {
      return plain[1].replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

/**
 * Discovers thermo-nuclear skill under cursor-team-kit plugin cache (any version hash).
 */
export function findSkillPath(): string {
  const override = process.env["THERMO_REVIEW_SKILL_PATH"]?.trim();
  if (override && existsSync(override)) {
    return override;
  }

  const kitRoot = join(homedir(), ".cursor", "plugins", "cache", "cursor-public", "cursor-team-kit");
  if (!existsSync(kitRoot)) {
    throw new Error(
      `cursor-team-kit plugin not found at ${kitRoot}. Install it in Cursor Settings → Plugins.`,
    );
  }

  for (const versionDir of readdirSync(kitRoot)) {
    const candidate = join(kitRoot, versionDir, "skills", SKILL_NAME, "SKILL.md");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Thermo-nuclear skill not found under ${kitRoot}. Install the cursor-team-kit plugin in Cursor.`,
  );
}

/**
 * Resolves the thermo-nuclear skill markdown from the Cursor plugins cache.
 */
export function loadSkillContent(): string {
  const path = findSkillPath();
  return readFileSync(path, "utf8");
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return explicitSkip || process.env["THERMO_REVIEW_SKIP"] === "1";
}

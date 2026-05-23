import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SKILL_RELATIVE =
  "plugins/cache/cursor-public/cursor-team-kit/3347cbab5b54136f6fba0994c3a01a56f7fb7fca/skills/thermo-nuclear-code-quality-review/SKILL.md";

const ENV_FILE = join(homedir(), ".config", "thermo-review", "env");

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
 * Resolves the thermo-nuclear skill markdown from the Cursor plugins cache.
 */
export function loadSkillContent(): string {
  const path = join(homedir(), ".cursor", SKILL_RELATIVE);
  if (!existsSync(path)) {
    throw new Error(
      `Thermo-nuclear skill not found at ${path}. Install the cursor-team-kit plugin in Cursor.`,
    );
  }
  return readFileSync(path, "utf8");
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return explicitSkip || process.env["THERMO_REVIEW_SKIP"] === "1";
}

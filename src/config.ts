import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProviderId } from "./types.js";

const ENV_FILE = join(homedir(), ".config", "thermo-review", "env");
const CONFIG_FILE = join(homedir(), ".config", "thermo-review", "config.json");

export const GIT_TEMPLATE_DIR = join(homedir(), ".git-templates");
export const GIT_TEMPLATE_HOOKS_DIR = join(GIT_TEMPLATE_DIR, "hooks");

const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export type OpenAIAuthMode = "api" | "chatgpt";

// Skill bundled with the package (dist/config.js -> ../templates/...).
const BUNDLED_SKILL = fileURLToPath(
  new URL("../templates/skills/thermo-nuclear/SKILL.md", import.meta.url),
);

// Cursor plugin cache: <hash> dirs rotate, so glob rather than pin one.
const CURSOR_TEAM_KIT_DIR = join(
  homedir(),
  ".cursor",
  "plugins",
  "cache",
  "cursor-public",
  "cursor-team-kit",
);
const SKILL_SUBPATH = join("skills", "thermo-nuclear-code-quality-review", "SKILL.md");

interface ThermoConfig {
  provider?: ProviderId;
  skillPath?: string;
  openaiModel?: string;
  openaiAuth?: OpenAIAuthMode;
}

let configCache: ThermoConfig | undefined;

function readConfigFile(): ThermoConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  const config: ThermoConfig = {};
  const provider = obj["provider"];
  if (provider === "cursor" || provider === "openai") {
    config.provider = provider;
  }
  const skillPath = obj["skillPath"];
  if (typeof skillPath === "string") {
    config.skillPath = skillPath;
  }
  const openaiModel = obj["openaiModel"];
  if (typeof openaiModel === "string") {
    config.openaiModel = openaiModel;
  }
  const openaiAuth = obj["openaiAuth"];
  if (openaiAuth === "api" || openaiAuth === "chatgpt") {
    config.openaiAuth = openaiAuth;
  }
  return config;
}

function loadConfigFile(): ThermoConfig {
  if (!configCache) {
    configCache = readConfigFile();
  }
  return configCache;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvVar(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  if (!existsSync(ENV_FILE)) {
    return undefined;
  }

  const wanted = new Set(names);
  const lines = readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    const name = match?.[1];
    const value = match?.[2];
    if (name && value !== undefined && wanted.has(name)) {
      const unquoted = unquoteEnvValue(value);
      if (unquoted) {
        return unquoted;
      }
    }
  }

  return undefined;
}

/**
 * Loads CURSOR_API_KEY from env or ~/.config/thermo-review/env (Cursor provider only).
 */
export function loadApiKey(): string | undefined {
  return loadEnvVar(["CURSOR_API_KEY"]);
}

/** Loads the official OpenAI API key for the stable OpenAI provider mode. */
export function loadOpenAIApiKey(): string | undefined {
  return loadEnvVar(["THERMO_REVIEW_OPENAI_API_KEY", "OPENAI_API_KEY"]);
}

/** Selects official OpenAI API auth by default; ChatGPT OAuth is explicit opt-in. */
export function loadOpenAIAuthMode(): OpenAIAuthMode {
  const fromEnv = loadEnvVar(["THERMO_REVIEW_OPENAI_AUTH"]);
  if (fromEnv === "api" || fromEnv === "chatgpt") {
    return fromEnv;
  }
  return loadConfigFile().openaiAuth ?? "api";
}

/**
 * Selects the review backend: explicit flag > THERMO_REVIEW_PROVIDER env >
 * config file > default ("openai").
 */
export function loadProvider(explicit?: ProviderId): ProviderId {
  if (explicit) {
    return explicit;
  }
  const fromEnv = process.env["THERMO_REVIEW_PROVIDER"]?.trim();
  if (fromEnv === "cursor" || fromEnv === "openai") {
    return fromEnv;
  }
  const fromConfig = loadConfigFile().provider;
  if (fromConfig) {
    return fromConfig;
  }
  return "openai";
}

/** Locates the thermo-nuclear skill in the (hash-versioned) Cursor plugin cache. */
function findCursorCachedSkill(): string | undefined {
  if (!existsSync(CURSOR_TEAM_KIT_DIR)) {
    return undefined;
  }
  let entries: string[];
  try {
    entries = readdirSync(CURSOR_TEAM_KIT_DIR);
  } catch {
    return undefined;
  }
  for (const hash of entries) {
    const candidate = join(CURSOR_TEAM_KIT_DIR, hash, SKILL_SUBPATH);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolves the skill markdown path: THERMO_REVIEW_SKILL_PATH env > config
 * skillPath > Cursor plugin cache > bundled copy.
 */
export function resolveSkillPath(): string {
  const fromEnv = process.env["THERMO_REVIEW_SKILL_PATH"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = loadConfigFile().skillPath?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  const cursorCached = findCursorCachedSkill();
  if (cursorCached) {
    return cursorCached;
  }
  return BUNDLED_SKILL;
}

/**
 * Loads the thermo-nuclear skill markdown from the resolved path.
 */
export function loadSkillContent(): string {
  const path = resolveSkillPath();
  if (!existsSync(path)) {
    throw new Error(
      `Thermo-nuclear skill not found at ${path}. ` +
        "Set THERMO_REVIEW_SKILL_PATH to a SKILL.md, or reinstall the package.",
    );
  }
  return readFileSync(path, "utf8");
}

/** Model id for the OpenAI provider: env > config > default. Overridable per plan. */
export function openaiModel(): string {
  const fromEnv = process.env["THERMO_REVIEW_OPENAI_MODEL"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = loadConfigFile().openaiModel?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  return DEFAULT_OPENAI_MODEL;
}

/** Wall-clock ceiling for an OpenAI review run, so a stalled stream can't hang. */
export function openaiTimeoutMs(): number {
  const raw = process.env["THERMO_REVIEW_OPENAI_TIMEOUT_MS"];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return explicitSkip || process.env["THERMO_REVIEW_SKIP"] === "1";
}

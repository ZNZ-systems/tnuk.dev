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
export const DEFAULT_OPENAI_REASONING_EFFORT = "medium";
// Claude CLI model alias for the `claude`/`panel` providers. `opus` resolves to the
// latest Opus — the strongest reviewer — at the cost of higher latency/spend per push.
// Override to `sonnet` via THERMO_REVIEW_CLAUDE_MODEL for a faster, cheaper gate.
const DEFAULT_CLAUDE_MODEL = "opus";
// Reasoning effort passed to the Claude CLI (`--effort`). High by default: this is a
// strict gate, so it trades latency/spend for the strongest reasoning.
const DEFAULT_CLAUDE_REASONING_EFFORT = "high";
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CONFIG_KEYS = ["provider", "skillPath", "openaiModel", "openaiAuth", "claudeModel"] as const;
const PROVIDERS = ["cursor", "openai", "claude", "panel"] as const satisfies readonly ProviderId[];
const OPENAI_AUTH_MODES = ["chatgpt", "api"] as const;

export type OpenAIAuthMode = (typeof OPENAI_AUTH_MODES)[number];

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
  claudeModel?: string;
}

let configCache: ThermoConfig | undefined;

function configError(message: string): Error {
  return new Error(`Invalid thermo-review config at ${CONFIG_FILE}: ${message}`);
}

function assertKnownConfigKeys(obj: Record<string, unknown>): void {
  const allowed = new Set<string>(CONFIG_KEYS);
  const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw configError(`unknown key(s): ${unknown.join(", ")}`);
  }
}

function optionalConfigString(
  obj: Record<string, unknown>,
  key: "skillPath" | "openaiModel" | "claudeModel",
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw configError(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalConfigEnum<T extends string>(
  obj: Record<string, unknown>,
  key: "provider" | "openaiAuth",
  allowed: readonly T[],
): T | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw configError(`${key} must be one of: ${allowed.join(", ")}`);
}

function readConfigFile(): ThermoConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw configError(`could not read file (${detail})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw configError(`malformed JSON (${detail})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw configError("top-level value must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  assertKnownConfigKeys(obj);

  const config: ThermoConfig = {};
  const provider = optionalConfigEnum(obj, "provider", PROVIDERS);
  if (provider) {
    config.provider = provider;
  }
  const skillPath = optionalConfigString(obj, "skillPath");
  if (skillPath) {
    config.skillPath = skillPath;
  }
  const openaiModel = optionalConfigString(obj, "openaiModel");
  if (openaiModel) {
    config.openaiModel = openaiModel;
  }
  const openaiAuth = optionalConfigEnum(obj, "openaiAuth", OPENAI_AUTH_MODES);
  if (openaiAuth) {
    config.openaiAuth = openaiAuth;
  }
  const claudeModel = optionalConfigString(obj, "claudeModel");
  if (claudeModel) {
    config.claudeModel = claudeModel;
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

function envEnumValue<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

/**
 * Loads CURSOR_API_KEY from env or ~/.config/thermo-review/env (Cursor provider only).
 */
export function loadApiKey(): string | undefined {
  return loadEnvVar(["CURSOR_API_KEY"]);
}

/** Loads the official OpenAI API key for the api auth mode. */
export function loadOpenAIApiKey(): string | undefined {
  return loadEnvVar(["THERMO_REVIEW_OPENAI_API_KEY", "OPENAI_API_KEY"]);
}

/** Selects ChatGPT OAuth by default; official OpenAI API auth is opt-in. */
export function loadOpenAIAuthMode(): OpenAIAuthMode {
  const fromEnv = envEnumValue(
    "THERMO_REVIEW_OPENAI_AUTH",
    loadEnvVar(["THERMO_REVIEW_OPENAI_AUTH"]),
    OPENAI_AUTH_MODES,
  );
  return fromEnv ?? loadConfigFile().openaiAuth ?? "chatgpt";
}

/**
 * Validates config.json, then selects the review backend: explicit flag >
 * THERMO_REVIEW_PROVIDER env > config file > default ("openai").
 */
export function loadProvider(explicit?: ProviderId): ProviderId {
  const config = loadConfigFile();
  if (explicit) {
    return explicit;
  }
  const fromEnv = envEnumValue(
    "THERMO_REVIEW_PROVIDER",
    process.env["THERMO_REVIEW_PROVIDER"]?.trim() || undefined,
    PROVIDERS,
  );
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = config.provider;
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

/**
 * Model alias/id for the Claude CLI (`claude`/`panel` providers): env > config >
 * default. Accepts an alias (`sonnet`, `opus`, `haiku`) or a full model id.
 */
export function claudeModel(): string {
  const fromEnv = process.env["THERMO_REVIEW_CLAUDE_MODEL"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = loadConfigFile().claudeModel?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  return DEFAULT_CLAUDE_MODEL;
}

/**
 * Wall-clock ceiling for a `claude -p` review run, so a stalled CLI can't hang the push.
 * Generous by default (10 min) because the default `opus` + `high` reasoning is slow on a
 * large diff; lower it (or the model/effort) for a snappier gate.
 */
export function claudeTimeoutMs(): number {
  const raw = process.env["THERMO_REVIEW_CLAUDE_TIMEOUT_MS"];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

/** Reasoning effort for the Claude CLI (`--effort`): env > default ("high"). */
export function claudeReasoningEffort(): string {
  return (
    envEnumValue(
      "THERMO_REVIEW_CLAUDE_EFFORT",
      process.env["THERMO_REVIEW_CLAUDE_EFFORT"]?.trim() || undefined,
      CLAUDE_EFFORTS,
    ) ?? DEFAULT_CLAUDE_REASONING_EFFORT
  );
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return explicitSkip || process.env["THERMO_REVIEW_SKIP"] === "1";
}

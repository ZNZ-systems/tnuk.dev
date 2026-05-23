import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");

export const CONFIG_DIR = join(homedir(), ".config", "tnuk");
export const AUTH_FILE = join(CONFIG_DIR, "auth.json");
export const GIT_TEMPLATE_DIR = join(homedir(), ".git-templates");
export const GIT_TEMPLATE_HOOKS_DIR = join(GIT_TEMPLATE_DIR, "hooks");

/** Bundled rubric version — bump when re-vendoring SKILL.md. */
export const RUBRIC_VERSION = "1.0.0";

const BUNDLED_SKILL = join(PACKAGE_ROOT, "skills", "thermo-nuclear-code-quality-review.md");

/**
 * API base URL for tnuk auth/session. Override with TNUK_API_URL for local dev.
 */
export function apiBaseUrl(): string {
  const override = process.env["TNUK_API_URL"]?.trim();
  if (override) {
    return override.replace(/\/$/, "");
  }
  return "https://tnuk.dev";
}

/**
 * Builds a full API URL from a path segment.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl()}${normalized}`;
}

/**
 * Loads the vendored thermo-nuclear skill markdown.
 */
export function loadSkillContent(): string {
  const override = process.env["TNUK_SKILL_PATH"]?.trim();
  if (override && existsSync(override)) {
    return readFileSync(override, "utf8");
  }
  if (!existsSync(BUNDLED_SKILL)) {
    throw new Error(
      `Bundled skill not found at ${BUNDLED_SKILL}. Reinstall tnuk: npm install -g tnuk`,
    );
  }
  return readFileSync(BUNDLED_SKILL, "utf8");
}

export function shouldSkipReview(explicitSkip: boolean): boolean {
  return (
    explicitSkip ||
    process.env["TNUK_SKIP"] === "1" ||
    process.env["THERMO_REVIEW_SKIP"] === "1"
  );
}

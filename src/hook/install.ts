import { readFileSync, existsSync, mkdirSync, chmodSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { GIT_TEMPLATE_DIR, GIT_TEMPLATE_HOOKS_DIR } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");
const TEMPLATE_HOOK = join(PACKAGE_ROOT, "templates", "hooks", "pre-push");

function bundledPrePushContent(): string {
  if (existsSync(TEMPLATE_HOOK)) {
    return readFileSync(TEMPLATE_HOOK, "utf8");
  }
  return `#!/bin/sh
command -v tnuk >/dev/null 2>&1 || exit 0
[ -n "$TNUK_SKIP" ] && exit 0
[ -n "$THERMO_REVIEW_SKIP" ] && exit 0
exec tnuk hook run
`;
}

function readGlobalGitConfig(key: string): string | undefined {
  try {
    return execFileSync("git", ["config", "--global", "--get", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function setGlobalGitConfigIfAllowed(key: string, value: string, current: string | undefined): boolean {
  if (current !== undefined && current !== value) {
    return false;
  }
  execFileSync("git", ["config", "--global", key, value], { encoding: "utf8" });
  return true;
}

/**
 * Installs user-level git template pre-push hook and configures git globally.
 */
export function installHook(): void {
  mkdirSync(GIT_TEMPLATE_HOOKS_DIR, { recursive: true });

  const hookPath = join(GIT_TEMPLATE_HOOKS_DIR, "pre-push");
  const content = bundledPrePushContent();
  writeFileSync(hookPath, content, { encoding: "utf8", mode: 0o755 });
  chmodSync(hookPath, 0o755);

  process.stdout.write(`Installed pre-push hook: ${hookPath}\n`);

  const templateDir = readGlobalGitConfig("init.templateDir");
  if (setGlobalGitConfigIfAllowed("init.templateDir", GIT_TEMPLATE_DIR, templateDir)) {
    process.stdout.write(`Set git init.templateDir = ${GIT_TEMPLATE_DIR}\n`);
  } else {
    process.stdout.write(
      `Skipped init.templateDir (already set to ${templateDir}). Run tnuk hook install after adjusting git config if needed.\n`,
    );
  }

  const hooksPath = readGlobalGitConfig("core.hooksPath");
  if (setGlobalGitConfigIfAllowed("core.hooksPath", GIT_TEMPLATE_HOOKS_DIR, hooksPath)) {
    process.stdout.write(`Set git core.hooksPath = ${GIT_TEMPLATE_HOOKS_DIR}\n`);
    process.stdout.write(
      "Note: this applies template hooks to all repos on this machine.\n" +
        "Existing repo-specific hooks in .git/hooks/ are bypassed unless chained.\n",
    );
  } else {
    process.stdout.write(
      `Skipped core.hooksPath (already set to ${hooksPath}). ` +
        "New repos still inherit the hook via init.templateDir when configured.\n",
    );
  }
}

/**
 * Removes thermo-review git template configuration.
 */
export function uninstallHook(): void {
  const hookPath = join(GIT_TEMPLATE_HOOKS_DIR, "pre-push");
  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf8");
    if (content.includes("tnuk") || content.includes("thermo-review")) {
      unlinkSync(hookPath);
      process.stdout.write(`Removed ${hookPath}\n`);
    }
  }

  try {
    const templateDir = execFileSync("git", ["config", "--global", "--get", "init.templateDir"], {
      encoding: "utf8",
    }).trim();
    if (templateDir === GIT_TEMPLATE_DIR) {
      execFileSync("git", ["config", "--global", "--unset", "init.templateDir"], {
        encoding: "utf8",
      });
      process.stdout.write("Unset git init.templateDir\n");
    }
  } catch {
    // not set
  }

  try {
    const hooksPath = execFileSync("git", ["config", "--global", "--get", "core.hooksPath"], {
      encoding: "utf8",
    }).trim();
    if (hooksPath === GIT_TEMPLATE_HOOKS_DIR) {
      execFileSync("git", ["config", "--global", "--unset", "core.hooksPath"], {
        encoding: "utf8",
      });
      process.stdout.write("Unset git core.hooksPath\n");
    }
  } catch {
    // not set
  }
}

/**
 * Chains to repo-local pre-push.local if present after review passes.
 */
export function chainLocalHook(repoRoot: string): number {
  const localHook = join(repoRoot, ".git", "hooks", "pre-push.local");
  if (!existsSync(localHook)) {
    return 0;
  }
  try {
    execFileSync(localHook, { stdio: "inherit", cwd: repoRoot });
    return 0;
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 1;
    return Number.isFinite(code) ? code : 1;
  }
}

#!/usr/bin/env node
/**
 * Installs the tnuk pre-push git hook after npm install.
 * Skipped when TNUK_SKIP_HOOK_INSTALL=1 or CI=true.
 *
 * Usage:
 *   node scripts/install-hook.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const installModule = join(root, "dist", "hook", "install.js");

if (process.env.TNUK_SKIP_HOOK_INSTALL === "1" || process.env.CI === "true") {
  process.exit(0);
}

try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  process.exit(0);
}

if (!existsSync(installModule)) {
  process.stderr.write("tnuk: dist/hook/install.js not found; run npm run build first\n");
  process.exit(0);
}

const { installHook } = await import(installModule);
installHook();

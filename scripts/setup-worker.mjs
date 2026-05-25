#!/usr/bin/env node
/**
 * Bootstrap the tnuk Cloudflare Worker:
 * - reads Clerk + Cursor secrets from local env files
 * - pushes wrangler secrets
 * - deploys tnuk-api
 *
 * Clerk webhooks cannot be created via the Backend API — use Dashboard, then:
 *   node scripts/setup-clerk-webhook.mjs
 *
 * Usage:
 *   node scripts/setup-worker.mjs
 *   node scripts/setup-worker.mjs --skip-deploy
 */

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localEnvPath = join(root, ".env.local");
const workerDir = join(root, "worker");
const WORKER_URL = "https://tnuk-api.panos-501.workers.dev";
const WEBHOOK_URL = "https://api.tnuk.dev/webhooks/clerk";
const WEBHOOK_URL_FALLBACK = `${WORKER_URL}/webhooks/clerk`;

const args = new Set(process.argv.slice(2));
const skipDeploy = args.has("--skip-deploy");

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function requireEnv(name, ...sources) {
  for (const source of sources) {
    const value = source[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing ${name}. Add it to .env.local or export it in your shell.`);
}

function persistLocalEnv(name, value) {
  const existing = existsSync(localEnvPath) ? readFileSync(localEnvPath, "utf8") : "";
  const assignment = `${name}=${value}`;
  const pattern = new RegExp(`^(?:export\\s+)?${name}=.*$`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, assignment)
    : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${assignment}\n`;
  writeFileSync(localEnvPath, next, { mode: 0o600 });
  chmodSync(localEnvPath, 0o600);
}

function putSecret(name, value) {
  console.log(`→ wrangler secret put ${name}`);
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "put", name, "--name", "tnuk-api"],
    {
      cwd: workerDir,
      input: value,
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "501550e5639d5031ffcbfc35702ef689" },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `failed to set ${name}`);
  }
}

function deployWorker() {
  console.log("→ wrangler deploy");
  execFileSync("npx", ["wrangler", "deploy"], {
    cwd: workerDir,
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "501550e5639d5031ffcbfc35702ef689" },
  });
}

async function main() {
  const local = parseEnvFile(localEnvPath);
  const thermo = parseEnvFile(join(process.env.HOME ?? "", ".config/thermo-review/env"));

  const clerkSecret = requireEnv("CLERK_SECRET_KEY", local, process.env);
  const cursorKey =
    process.env.CURSOR_MANAGED_API_KEY?.trim() ||
    process.env.CURSOR_API_KEY?.trim() ||
    thermo.CURSOR_API_KEY?.trim() ||
    thermo.CURSOR_MANAGED_API_KEY?.trim();

  if (!cursorKey) {
    throw new Error(
      "Missing CURSOR_MANAGED_API_KEY. Set it in the environment or add CURSOR_API_KEY to ~/.config/thermo-review/env",
    );
  }

  let jwtSecret = process.env.TNUK_JWT_SECRET?.trim() || local.TNUK_JWT_SECRET?.trim();
  if (!jwtSecret) {
    jwtSecret = randomBytes(32).toString("base64url");
    persistLocalEnv("TNUK_JWT_SECRET", jwtSecret);
    console.log("Generated TNUK_JWT_SECRET and saved it to .env.local for future setup runs.");
  }

  putSecret("CLERK_SECRET_KEY", clerkSecret);
  putSecret("CURSOR_MANAGED_API_KEY", cursorKey);
  putSecret("TNUK_JWT_SECRET", jwtSecret);

  if (!skipDeploy) {
    deployWorker();
  }

  console.log("\nWorker live at:");
  console.log(`  ${WORKER_URL}`);
  console.log("\nNext — Clerk billing webhook (Dashboard only):");
  console.log("  1. Clerk Dashboard → Webhooks → Add endpoint");
  console.log(`  2. URL: ${WEBHOOK_URL}`);
  console.log(`     (fallback until DNS: ${WEBHOOK_URL_FALLBACK})`);
  console.log(
    "  3. Events: subscription.created, subscription.updated, subscription.active,",
  );
  console.log(
    "             subscription.pastDue, subscriptionItem.canceled, subscriptionItem.pastDue,",
  );
  console.log("             subscriptionItem.ended");
  console.log("  4. node scripts/setup-clerk-webhook.mjs");
  console.log("\nCustom domain (when tnuk.dev is on Cloudflare):");
  console.log("  Uncomment [[routes]] in worker/wrangler.toml, then npm run setup:worker");
  console.log("\nSmoke test:");
  console.log(`  node -e "fetch('${WORKER_URL}/auth/device/start',{method:'POST'}).then(r=>r.json()).then(console.log)"`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

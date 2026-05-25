#!/usr/bin/env node
/**
 * Push GitHub Actions secrets required for CI deploy (Worker + Pages).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/setup-github-deploy.mjs
 *   CLOUDFLARE_API_TOKEN=... NPM_TOKEN=... node scripts/setup-github-deploy.mjs
 *
 * Reads VITE_* build vars from dashboard/.env when present.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = "ZNZ-systems/tnuk.dev";

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

function setSecret(name, value) {
  if (!value?.trim()) return false;
  console.log(`→ gh secret set ${name}`);
  execFileSync("gh", ["secret", "set", name, "--repo", repo], {
    input: value.trim(),
    stdio: ["pipe", "inherit", "inherit"],
  });
  return true;
}

function main() {
  const dashboardEnv = parseEnvFile(join(root, "dashboard/.env"));

  const vitePublishable =
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    dashboardEnv.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    dashboardEnv.CLERK_PUBLISHABLE_KEY?.trim();

  const vitePlanId =
    process.env.VITE_CLERK_TEAM_PLAN_ID?.trim() ||
    dashboardEnv.VITE_CLERK_TEAM_PLAN_ID?.trim();

  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const npmToken = process.env.NPM_TOKEN?.trim();

  let configured = 0;

  if (setSecret("VITE_CLERK_PUBLISHABLE_KEY", vitePublishable)) configured += 1;
  if (setSecret("VITE_CLERK_TEAM_PLAN_ID", vitePlanId)) configured += 1;
  if (cloudflareToken && setSecret("CLOUDFLARE_API_TOKEN", cloudflareToken)) configured += 1;
  if (npmToken && setSecret("NPM_TOKEN", npmToken)) configured += 1;

  console.log(`\nConfigured ${configured} secret(s) on ${repo}.`);

  if (!cloudflareToken) {
    console.log("\nStill needed for deploy workflow:");
    console.log("  CLOUDFLARE_API_TOKEN — create at https://dash.cloudflare.com/profile/api-tokens");
    console.log("  Template: Edit Cloudflare Workers + Account → Cloudflare Pages → Edit");
    console.log("  Account: Panos@znzsystems.com's Account (501550e5639d5031ffcbfc35702ef689)");
    console.log("\nThen rerun:");
    console.log("  CLOUDFLARE_API_TOKEN=... node scripts/setup-github-deploy.mjs");
  }

  console.log("\nDeploy triggers on push to main:");
  console.log("  .github/workflows/deploy.yml  → Worker (api.tnuk.dev) + Pages (tnuk.pages.dev)");
  console.log("  .github/workflows/ci.yml      → build checks on PRs");
  console.log("\nCustom domain tnuk.dev on Pages:");
  console.log("  Cloudflare Dashboard → Workers & Pages → tnuk → Custom domains → tnuk.dev");
  console.log("  (Requires tnuk.dev nameservers on Cloudflare — see AGENTS.md)");
}

main();

#!/usr/bin/env node
/**
 * Store the Clerk webhook signing secret on the deployed Worker.
 *
 * Create the endpoint in Clerk Dashboard → Webhooks first:
 *   URL: https://api.tnuk.dev/webhooks/clerk
 *        (or https://tnuk-api.panos-501.workers.dev/webhooks/clerk until DNS is live)
 *   Events: subscription.created, subscription.updated, subscription.active,
 *           subscription.pastDue, subscriptionItem.canceled, subscriptionItem.pastDue,
 *           subscriptionItem.ended
 *
 * Usage:
 *   node scripts/setup-clerk-webhook.mjs   # prompts for the secret
 *   # Or set CLERK_WEBHOOK_SECRET through CI/secret-manager environment.
 *
 * To avoid leaking secrets through shell history or process listings, this
 * script never accepts the signing secret as a command-line argument.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "worker");
const WEBHOOK_EVENTS = [
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.pastDue",
  "subscriptionItem.canceled",
  "subscriptionItem.pastDue",
  "subscriptionItem.ended",
];

async function main() {
  if (process.argv.length > 2) {
    throw new Error("Do not pass the webhook secret as an argument; run the script and paste it at the prompt.");
  }

  let secret = process.env.CLERK_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (!process.stdin.isTTY) {
      throw new Error("Missing CLERK_WEBHOOK_SECRET. Set it in the environment or run interactively.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      secret = (await rl.question("Paste Clerk webhook signing secret (whsec_…): ")).trim();
    } finally {
      rl.close();
    }
  }

  if (!secret.startsWith("whsec_")) {
    throw new Error("Expected a Svix signing secret starting with whsec_");
  }

  console.log("→ wrangler secret put CLERK_WEBHOOK_SECRET");
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "put", "CLERK_WEBHOOK_SECRET", "--name", "tnuk-api"],
    {
      cwd: workerDir,
      input: secret,
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "501550e5639d5031ffcbfc35702ef689" },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to set CLERK_WEBHOOK_SECRET");
  }

  console.log("✓ CLERK_WEBHOOK_SECRET stored on tnuk-api");
  console.log("\nWebhook endpoint checklist:");
  console.log("  URL:    https://api.tnuk.dev/webhooks/clerk");
  console.log("  Events: " + WEBHOOK_EVENTS.join(", "));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

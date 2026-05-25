#!/usr/bin/env node
/**
 * Attach tnuk.dev to the Cloudflare Pages project and show DNS status.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/setup-pages-domain.mjs
 */

const ACCOUNT_ID = "501550e5639d5031ffcbfc35702ef689";
const PROJECT = "tnuk";
const DOMAIN = "tnuk.dev";

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!token) {
  console.error("Missing CLOUDFLARE_API_TOKEN.");
  console.error("Use the same token you set in GitHub Actions secrets.");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(msg);
  }
  return body.result;
}

async function main() {
  const zones = await api(`/zones?name=${DOMAIN}`);
  const zone = zones[0];
  if (!zone) {
    throw new Error(`Zone ${DOMAIN} not found on this Cloudflare account.`);
  }

  console.log(`Zone ${DOMAIN} (${zone.id}) — status: ${zone.status}`);

  const records = await api(`/zones/${zone.id}/dns_records?name=${DOMAIN}`);
  for (const record of records) {
    console.log(`  DNS ${record.type} ${record.name} → ${record.content}`);
  }

  try {
    const domain = await api(
      `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/domains`,
      {
        method: "POST",
        body: JSON.stringify({ name: DOMAIN }),
      },
    );
    console.log(`\nPages custom domain added: ${domain.name} (${domain.status})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("already")) {
      console.log(`\nPages custom domain already configured for ${DOMAIN}.`);
    } else {
      throw err;
    }
  }

  const domains = await api(
    `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/domains`,
  );
  console.log("\nPages domains:");
  for (const d of domains) {
    console.log(`  ${d.name} — ${d.status}`);
  }

  console.log("\nAlso add in Clerk Dashboard → Domains:");
  console.log("  https://tnuk.dev");
  console.log("  https://www.tnuk.dev (if you use www)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

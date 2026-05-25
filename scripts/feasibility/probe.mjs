// Feasibility probe: run the Cursor SDK locally with the API base URL pointed at
// our logging proxy, to confirm the override is honored and capture endpoints.
//
// Run the proxy first (scripts/feasibility/proxy.mjs), then:
//   node scripts/feasibility/probe.mjs
//
// Env:
//   PROXY_PORT (default 8787) - must match the proxy
//   TNUK_FAKE_TOKEN           - the "tnuk token" passed as apiKey (any string)

import { Agent } from "@cursor/sdk";

const port = Number(process.env.PROXY_PORT ?? 8787);
const base = `http://127.0.0.1:${port}`;

// This is the crux: point the SDK at our endpoint instead of api2.cursor.sh.
process.env.CURSOR_API_BASE_URL = base;
process.env.CURSOR_BACKEND_URL = base;

const apiKey = process.env.TNUK_FAKE_TOKEN ?? "tnuk_test_token";

console.error(`[probe] CURSOR_API_BASE_URL=${process.env.CURSOR_API_BASE_URL}`);
console.error(`[probe] apiKey=${apiKey.slice(0, 10)}…`);

try {
  const agent = await Agent.create({
    apiKey,
    model: { id: "composer-2.5" },
    local: { cwd: process.cwd() },
  });
  try {
    const run = await agent.send("Reply with the single word OK.");
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") process.stdout.write(block.text);
        }
      }
    }
    const result = await run.wait();
    console.error(`\n[probe] run status: ${result.status}`);
  } finally {
    agent.close();
  }
} catch (err) {
  console.error(`\n[probe] error (expected in observe mode): ${err?.message ?? err}`);
}

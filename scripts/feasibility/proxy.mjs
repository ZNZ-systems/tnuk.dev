// Feasibility logging proxy for the Cursor SDK base-url override.
//
// Goal: prove that setting CURSOR_API_BASE_URL / CURSOR_BACKEND_URL routes the
// local agent's traffic through an endpoint we control (the future tnuk Worker),
// and observe exactly which hosts/paths get hit.
//
// Modes:
//   - No PROXY_UPSTREAM_KEY  -> "observe" mode: log each request and return 401.
//     Enough to confirm the override is honored and capture the first calls.
//   - PROXY_UPSTREAM_KEY set -> "forward" mode: inject the real key and reverse-
//     proxy to the real upstream (api2.cursor.sh by default) so a full review can
//     complete and we capture the entire endpoint set.
//
// Usage:
//   node scripts/feasibility/proxy.mjs                # observe mode, 127.0.0.1:8787
//   PROXY_UPSTREAM_KEY=cursor_... node scripts/feasibility/proxy.mjs  # forward mode

import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const HOST = "127.0.0.1";
const UPSTREAM = process.env.PROXY_UPSTREAM ?? "https://api2.cursor.sh";
const UPSTREAM_KEY = process.env.PROXY_UPSTREAM_KEY;
const seen = new Map(); // `${method} ${path}` -> count
const REQUEST_BASE = "http://tnuk-proxy.local";

function logHit(req) {
  const key = `${req.method} ${req.url}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  const auth = req.headers["authorization"] ?? "(none)";
  const masked = auth === "(none)" ? auth : auth.slice(0, 14) + "…";
  process.stderr.write(
    `[proxy] ${req.method} ${req.url}  host=${req.headers["host"]}  auth=${masked}\n`,
  );
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function upstreamUrl(rawUrl) {
  const parsed = new URL(rawUrl ?? "/", REQUEST_BASE);
  if (parsed.origin !== REQUEST_BASE) {
    throw new Error("absolute request URLs are not accepted");
  }
  const target = new URL(UPSTREAM);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  return target;
}

const server = http.createServer(async (req, res) => {
  logHit(req);

  if (!UPSTREAM_KEY) {
    // observe mode: don't forward, just prove we received it.
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "observe-mode: tnuk proxy received request", path: req.url }));
    return;
  }

  let target;
  try {
    target = upstreamUrl(req.url);
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid proxy target", detail: String(err) }));
    return;
  }

  const body = await readBody(req);

  // forward mode: inject the real key and reverse-proxy to the real upstream.
  const headers = { ...req.headers, host: target.host, authorization: `Bearer ${UPSTREAM_KEY}` };
  delete headers["content-length"];
  try {
    const upstreamRes = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      // @ts-ignore node fetch duplex for streaming bodies
      duplex: "half",
    });
    process.stderr.write(`[proxy]   -> upstream ${upstreamRes.status} ${target.host}${target.pathname}\n`);
    res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers));
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.end(buf);
  } catch (err) {
    process.stderr.write(`[proxy]   -> upstream ERROR ${String(err)}\n`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy upstream failed", detail: String(err) }));
  }
});

function dumpSummary() {
  process.stderr.write("\n[proxy] ==== endpoints observed ====\n");
  for (const [k, n] of [...seen.entries()].sort()) {
    process.stderr.write(`[proxy]   ${n}×  ${k}\n`);
  }
  process.stderr.write("[proxy] =============================\n");
}
process.on("SIGINT", () => { dumpSummary(); process.exit(0); });
process.on("SIGTERM", () => { dumpSummary(); process.exit(0); });

server.listen(PORT, HOST, () => {
  process.stderr.write(
    `[proxy] listening on http://${HOST}:${PORT}  mode=${UPSTREAM_KEY ? "forward→" + UPSTREAM : "observe"}\n`,
  );
});

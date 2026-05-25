import { verifyToken } from "@clerk/backend";
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./env.js";
import { bearer, mintSeatToken } from "./jwt.js";
import { requireActiveSeat } from "./seat-gate.js";
import {
  createDevice,
  getDeviceByUserCode,
  setDevice,
} from "./devices.js";
import { orgHasActiveSubscription } from "./subscriptions.js";
import { handleClerkWebhook } from "./webhooks.js";

const app = new Hono<{ Bindings: Env }>();

// Dashboard (tnuk.dev) calls the auth endpoints cross-origin.
app.use("/auth/*", async (c, next) => {
  const mw = cors({ origin: c.env.DASHBOARD_URL, allowHeaders: ["authorization", "content-type"] });
  return mw(c, next);
});

// Short, unambiguous human code (no 0/O/1/I).
function makeUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

// ---- Device-code login ------------------------------------------------------

app.post("/auth/device/start", async (c) => {
  const deviceCode = crypto.randomUUID();
  const userCode = makeUserCode();
  await createDevice(c.env, deviceCode, userCode);
  return c.json({
    deviceCode,
    userCode,
    verificationUrl: `${c.env.DASHBOARD_URL}/activate`,
    intervalSeconds: 5,
    expiresInSeconds: 600,
  });
});

// Called by the dashboard once the signed-in user enters their code.
// Authorization: Bearer <clerk session token from getToken()>.
app.post("/auth/device/approve", async (c) => {
  const sessionToken = bearer(c.req.raw);
  if (!sessionToken) return c.json({ error: "missing session token" }, 401);

  let claims: Awaited<ReturnType<typeof verifyToken>>;
  try {
    claims = await verifyToken(sessionToken, { secretKey: c.env.CLERK_SECRET_KEY });
  } catch {
    return c.json({ error: "invalid session" }, 401);
  }

  const userId = claims.sub;
  const orgId = typeof claims.org_id === "string" ? claims.org_id : undefined;
  if (!orgId) {
    return c.json({ error: "no active organization — select your team first" }, 400);
  }
  if (!(await orgHasActiveSubscription(c.env, orgId))) {
    return c.json({ error: "organization has no active tnuk subscription" }, 402);
  }

  const body = (await c.req.json().catch(() => ({}))) as { userCode?: string };
  const userCode = body.userCode?.trim().toUpperCase();
  if (!userCode) return c.json({ error: "missing userCode" }, 400);

  const found = await getDeviceByUserCode(c.env, userCode);
  if (!found) return c.json({ error: "unknown or expired code" }, 404);
  if (found.state.status !== "pending") {
    return c.json({ error: "code already used or expired" }, 409);
  }

  const account = typeof claims.email === "string" ? claims.email : userId;
  const { token, expiresAt } = await mintSeatToken(
    { userId, orgId, account },
    c.env.TNUK_JWT_SECRET,
  );
  await setDevice(c.env, found.deviceCode, {
    ...found.state,
    status: "authorized",
    token,
    expiresAt,
    account,
  });
  return c.json({ ok: true });
});

app.post("/auth/device/poll", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: string };
  const deviceCode = body.deviceCode;
  if (!deviceCode) return c.json({ error: "missing deviceCode" }, 400);

  const stub = c.env.DEVICE_HANDOFF.get(c.env.DEVICE_HANDOFF.idFromName(deviceCode));
  return stub.fetch("http://device-handoff/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
});

app.get("/auth/whoami", async (c) => {
  const gate = await requireActiveSeat(c.req.raw, c.env);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const { seat } = gate;
  return c.json({ account: seat.account ?? seat.userId, org: seat.orgId, seat: "active" });
});

// ---- Billing webhooks -------------------------------------------------------

app.post("/webhooks/clerk", (c) => handleClerkWebhook(c.req.raw, c.env));

// ---- Seat-gated proxy to Cursor (catch-all, must be last) -------------------

const HOP_BY_HOP = new Set(["host", "content-length", "connection", "transfer-encoding"]);

app.all("*", async (c) => {
  const gate = await requireActiveSeat(c.req.raw, c.env);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const url = new URL(c.req.url);
  const target = `${c.env.CURSOR_UPSTREAM}${url.pathname}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  // Swap the client's tnuk token for the real managed key, server-side only.
  headers.set("authorization", `Bearer ${c.env.CURSOR_MANAGED_API_KEY}`);

  const method = c.req.method;
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = c.req.raw.body;
    // @ts-expect-error duplex required by the Fetch spec for streaming bodies
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
});

export default app;
export { DeviceHandoff } from "./device-handoff.js";

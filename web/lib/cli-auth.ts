import { randomBytes } from "node:crypto";

import {
  APP_URL,
  CURSOR_KEY_TTL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
} from "./constants";
import { ensureSchema, withClient } from "./db";
import { signCliToken } from "./jwt";
import { userHasProPlan } from "./billing";

function randomUserCode(): string {
  const part = randomBytes(3).toString("hex").toUpperCase();
  return `${part.slice(0, 4)}-${part.slice(4, 8)}`;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

function cursorApiKey(): string | undefined {
  return process.env["CURSOR_API_KEY"]?.trim();
}

export async function handleSessionPost(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ error: "session_expired" }, { status: 401 });
  }

  const { verifyCliToken } = await import("./jwt");
  let userId: string;
  try {
    const payload = await verifyCliToken(token);
    userId = payload.sub;
  } catch {
    return Response.json({ error: "session_expired" }, { status: 401 });
  }

  const hasPro = await userHasProPlan(userId);
  if (!hasPro) {
    return Response.json(
      {
        error: "subscription_inactive",
        billingUrl: `${APP_URL}/billing`,
      },
      { status: 402 },
    );
  }

  const key = cursorApiKey();
  if (!key) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    await ensureSchema();
    await withClient(async (client) => {
      await client.query(`INSERT INTO runs (user_id) VALUES ($1)`, [userId]);
    });
  } catch {
    // Non-fatal — session still works without run logging
  }

  const expiresAt = Math.floor(Date.now() / 1000) + CURSOR_KEY_TTL_SECONDS;
  return Response.json({ cursorApiKey: key, expiresAt });
}

export async function handleDeviceStartPost(): Promise<Response> {
  await ensureSchema();
  const pollToken = randomBytes(24).toString("hex");
  const deviceCode = randomBytes(16).toString("hex");
  const userCode = randomUserCode();
  const expiresAt = Date.now() + DEVICE_CODE_TTL_SECONDS * 1000;

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO device_codes (poll_token, user_code, device_code, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [pollToken, userCode, deviceCode, expiresAt],
    );
  });

  return Response.json({
    deviceCode,
    userCode,
    pollToken,
    verificationUrl: `${APP_URL}/device`,
    expiresAt,
  });
}

export async function handleDevicePollGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pollToken = url.searchParams.get("token");
  if (!pollToken) {
    return Response.json({ status: "expired" }, { status: 400 });
  }

  await ensureSchema();
  const row = await withClient(async (client) => {
    const result = await client.query<{
      status: string;
      cli_token: string | null;
      user_id: string | null;
      email: string | null;
      expires_at: Date;
    }>(
      `SELECT status, cli_token, user_id, email, expires_at FROM device_codes WHERE poll_token = $1`,
      [pollToken],
    );
    return result.rows[0];
  });

  if (!row || row.expires_at.getTime() < Date.now()) {
    return Response.json({ status: "expired" });
  }

  if (row.status === "approved" && row.cli_token) {
    return Response.json({
      status: "approved",
      token: row.cli_token,
      userId: row.user_id ?? undefined,
      email: row.email ?? undefined,
      issuedAt: new Date().toISOString(),
    });
  }

  return Response.json({ status: "pending" });
}

export async function approveDeviceCode(
  userCode: string,
  userId: string,
  email?: string,
): Promise<boolean> {
  await ensureSchema();
  const cliToken = await signCliToken(userId, email);

  const result = await withClient(async (client) => {
    const update = await client.query(
      `UPDATE device_codes
       SET status = 'approved', cli_token = $1, user_id = $2, email = $3
       WHERE user_code = $4 AND status = 'pending' AND expires_at > NOW()
       RETURNING poll_token`,
      [cliToken, userId, email ?? null, userCode.replace(/\s/g, "").toUpperCase()],
    );
    return update.rowCount ?? 0;
  });

  return result > 0;
}

export { signCliToken };

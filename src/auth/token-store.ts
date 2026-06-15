import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { jwtExpEpochMs } from "./jwt.js";
import { OAUTH_CLIENT_ID, OAUTH_TOKEN_URL } from "./openai-endpoints.js";

const AUTH_DIR = join(homedir(), ".config", "thermo-review");
const AUTH_FILE = join(AUTH_DIR, "openai-auth.json");

const DEFAULT_EXPIRY_SECONDS = 3600;
const DEFAULT_SKEW_SECONDS = 300;

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  account_id: string;
}

export interface StoredOpenAIAuth {
  tokens: StoredTokens;
  expires_at: number; // epoch ms
  last_refresh: string; // ISO 8601
  email?: string;
  plan_type?: string;
}

export interface OpenAICredentials {
  accessToken: string;
  accountId: string;
}

/** Raw token-endpoint response (authorization_code exchange and refresh). */
export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface SaveAccount {
  accountId: string;
  email?: string;
  planType?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Runtime validation for token endpoint responses before storing credentials. */
export function validateTokenResponse(
  value: unknown,
  opts: { requireIdToken?: boolean } = {},
): TokenResponse {
  const obj = asObject(value);
  if (!nonEmptyString(obj["access_token"])) {
    throw new Error("Token response missing access_token.");
  }
  const tokenType = obj["token_type"];
  if (tokenType !== undefined && (!nonEmptyString(tokenType) || !/^bearer$/i.test(tokenType))) {
    throw new Error("Token response has unsupported token_type.");
  }
  const idToken = obj["id_token"];
  if (opts.requireIdToken && !nonEmptyString(idToken)) {
    throw new Error("Token response missing id_token.");
  }
  if (idToken !== undefined && !nonEmptyString(idToken)) {
    throw new Error("Token response has malformed id_token.");
  }
  const refreshToken = obj["refresh_token"];
  if (refreshToken !== undefined && !nonEmptyString(refreshToken)) {
    throw new Error("Token response has malformed refresh_token.");
  }
  const expiresIn = obj["expires_in"];
  if (expiresIn !== undefined && (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)) {
    throw new Error("Token response has malformed expires_in.");
  }

  const resp: TokenResponse = { access_token: obj["access_token"] };
  if (nonEmptyString(idToken)) {
    resp.id_token = idToken;
  }
  if (nonEmptyString(refreshToken)) {
    resp.refresh_token = refreshToken;
  }
  if (typeof expiresIn === "number") {
    resp.expires_in = expiresIn;
  }
  if (nonEmptyString(tokenType)) {
    resp.token_type = tokenType;
  }
  return resp;
}

function computeExpiresAt(resp: TokenResponse): number {
  const fromJwt = jwtExpEpochMs(resp.access_token);
  if (fromJwt) {
    return fromJwt;
  }
  const seconds = typeof resp.expires_in === "number" ? resp.expires_in : DEFAULT_EXPIRY_SECONDS;
  return Date.now() + seconds * 1000;
}

async function writeAuth(auth: StoredOpenAIAuth): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  // mode on writeFile only applies on create; chmod unconditionally to be safe.
  await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  await chmod(AUTH_FILE, 0o600);
}

function isValidAuth(value: unknown): value is StoredOpenAIAuth {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const tokens = obj["tokens"];
  if (typeof tokens !== "object" || tokens === null) {
    return false;
  }
  const t = tokens as Record<string, unknown>;
  return (
    nonEmptyString(t["access_token"]) &&
    nonEmptyString(t["account_id"]) &&
    nonEmptyString(t["id_token"]) &&
    typeof obj["expires_at"] === "number" &&
    Number.isFinite(obj["expires_at"])
  );
}

async function loadAuth(): Promise<StoredOpenAIAuth> {
  let raw: string;
  try {
    raw = await readFile(AUTH_FILE, "utf8");
  } catch {
    throw new Error("Not signed in to OpenAI. Run `thermo-review login`.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI credentials file is corrupt. Run `thermo-review login` again.");
  }
  if (!isValidAuth(parsed)) {
    throw new Error("OpenAI credentials incomplete. Run `thermo-review login` again.");
  }
  return parsed;
}

/** Persists tokens from the initial authorization_code exchange. */
export async function saveFromExchange(resp: TokenResponse, account: SaveAccount): Promise<void> {
  resp = validateTokenResponse(resp, { requireIdToken: true });
  const idToken = resp.id_token;
  if (!idToken) {
    throw new Error("Token response missing id_token.");
  }
  const tokens: StoredTokens = {
    access_token: resp.access_token,
    id_token: idToken,
    account_id: account.accountId,
  };
  if (resp.refresh_token) {
    tokens.refresh_token = resp.refresh_token;
  }
  const auth: StoredOpenAIAuth = {
    tokens,
    expires_at: computeExpiresAt(resp),
    last_refresh: new Date().toISOString(),
  };
  if (account.email) {
    auth.email = account.email;
  }
  if (account.planType) {
    auth.plan_type = account.planType;
  }
  await writeAuth(auth);
}

function mergeRefreshed(prev: StoredOpenAIAuth, resp: TokenResponse): StoredOpenAIAuth {
  const tokens: StoredTokens = {
    access_token: resp.access_token,
    id_token: resp.id_token ?? prev.tokens.id_token,
    account_id: prev.tokens.account_id,
  };
  // Refresh tokens may rotate; keep the new one, else retain the previous.
  const refresh = resp.refresh_token ?? prev.tokens.refresh_token;
  if (refresh) {
    tokens.refresh_token = refresh;
  }
  const next: StoredOpenAIAuth = {
    tokens,
    expires_at: computeExpiresAt(resp),
    last_refresh: new Date().toISOString(),
  };
  if (prev.email) {
    next.email = prev.email;
  }
  if (prev.plan_type) {
    next.plan_type = prev.plan_type;
  }
  return next;
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  // NOTE: refresh uses JSON (the authorization_code exchange uses form-encoding)
  // and intentionally omits `scope`, matching the Codex client.
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json: unknown = await res.json();
  return validateTokenResponse(json);
}

/**
 * Returns a valid access token + account id, refreshing first if the token is
 * within `skewSeconds` of expiry. Throws if not signed in or refresh fails.
 */
export async function getValidCredentials(
  skewSeconds = DEFAULT_SKEW_SECONDS,
): Promise<OpenAICredentials> {
  const auth = await loadAuth();
  if (Date.now() < auth.expires_at - skewSeconds * 1000) {
    return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
  }
  const refreshToken = auth.tokens.refresh_token;
  if (!refreshToken) {
    throw new Error("OpenAI session expired and no refresh token is stored. Run `thermo-review login`.");
  }
  const resp = await refreshTokens(refreshToken);
  const next = mergeRefreshed(auth, resp);
  await writeAuth(next);
  return { accessToken: next.tokens.access_token, accountId: next.tokens.account_id };
}

/** Removes stored credentials. Returns false if none were present. */
export async function logout(): Promise<boolean> {
  try {
    await rm(AUTH_FILE);
    return true;
  } catch {
    return false;
  }
}

/** Lightweight signed-in summary for status display; null if not signed in. */
export async function loadAuthSummary(): Promise<{ email?: string; planType?: string } | null> {
  let auth: StoredOpenAIAuth;
  try {
    auth = await loadAuth();
  } catch {
    return null;
  }
  const summary: { email?: string; planType?: string } = {};
  if (auth.email) {
    summary.email = auth.email;
  }
  if (auth.plan_type) {
    summary.planType = auth.plan_type;
  }
  return summary;
}

export interface IdTokenClaims {
  email?: string;
  accountId?: string;
  planType?: string;
  exp?: number;
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function decodePayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  const segment = parts[1];
  if (parts.length !== 3 || !segment) {
    return undefined;
  }
  try {
    return asRecord(JSON.parse(Buffer.from(segment, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

/**
 * Decodes (does not verify) an OpenAI id_token, pulling the ChatGPT account id
 * and profile fields used to call the backend. Signature verification is
 * unnecessary because we never make an authorization decision from these claims.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const payload = decodePayload(idToken);
  if (!payload) {
    throw new Error("Malformed id_token JWT.");
  }

  const auth = asRecord(payload["https://api.openai.com/auth"]);
  const profile = asRecord(payload["https://api.openai.com/profile"]);
  const claims: IdTokenClaims = { raw: payload };

  const accountId = auth["chatgpt_account_id"];
  if (typeof accountId === "string") {
    claims.accountId = accountId;
  }
  const planType = auth["chatgpt_plan_type"];
  if (typeof planType === "string") {
    claims.planType = planType;
  }
  const email = profile["email"] ?? payload["email"];
  if (typeof email === "string") {
    claims.email = email;
  }
  const exp = payload["exp"];
  if (typeof exp === "number") {
    claims.exp = exp;
  }
  return claims;
}

/** Returns a JWT's `exp` as epoch milliseconds, or undefined if unreadable. */
export function jwtExpEpochMs(token: string): number | undefined {
  const payload = decodePayload(token);
  const exp = payload?.["exp"];
  return typeof exp === "number" ? exp * 1000 : undefined;
}

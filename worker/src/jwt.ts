import { SignJWT, jwtVerify } from "jose";

const ISSUER = "tnuk.dev";
const AUDIENCE = "tnuk-cli";

export interface SeatClaims {
  /** Clerk user id. */
  userId: string;
  /** Clerk organization id whose subscription grants the seat. */
  orgId: string;
  /** Display hint for `tnuk whoami`. */
  account?: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Mints a short-lived seat token the CLI sends to the proxy as its API key. */
export async function mintSeatToken(
  claims: SeatClaims,
  secret: string,
  ttlSeconds = 24 * 60 * 60,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ orgId: claims.orgId, account: claims.account })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key(secret));
  return { token, expiresAt: exp * 1000 };
}

export async function verifySeatToken(token: string, secret: string): Promise<SeatClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.orgId !== "string") {
      return null;
    }
    const claims: SeatClaims = { userId: payload.sub, orgId: payload.orgId };
    if (typeof payload.account === "string") claims.account = payload.account;
    return claims;
  } catch {
    return null;
  }
}

/** Pulls the Bearer token out of an Authorization header. */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

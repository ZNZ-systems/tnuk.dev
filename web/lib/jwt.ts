import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import {
  CLI_JWT_AUDIENCE,
  CLI_JWT_ISSUER,
  CLI_TOKEN_TTL_SECONDS,
} from "./constants";

export interface CliTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
}

function secretKey(): Uint8Array {
  const secret = process.env["CLI_JWT_SECRET"];
  if (!secret) {
    throw new Error("CLI_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Issues a long-lived CLI session JWT for an authenticated Clerk user.
 */
export async function signCliToken(userId: string, email?: string): Promise<string> {
  const jwt = new SignJWT({
    ...(email !== undefined ? { email } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(CLI_JWT_ISSUER)
    .setAudience(CLI_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CLI_TOKEN_TTL_SECONDS}s`);

  return jwt.sign(secretKey());
}

/**
 * Verifies a CLI bearer token from Authorization header.
 */
export async function verifyCliToken(token: string): Promise<CliTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: CLI_JWT_ISSUER,
    audience: CLI_JWT_AUDIENCE,
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Invalid token subject");
  }
  return payload as CliTokenPayload;
}

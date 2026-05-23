import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { AUTH_FILE, CONFIG_DIR } from "../config.js";

export interface StoredAuthToken {
  token: string;
  issuedAt: string;
  userId?: string;
  email?: string;
}

/**
 * Reads the CLI auth token from ~/.config/tnuk/auth.json.
 */
export function readAuthToken(): StoredAuthToken | undefined {
  if (!existsSync(AUTH_FILE)) {
    return undefined;
  }
  try {
    const raw = readFileSync(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      const record = parsed as StoredAuthToken;
      return {
        token: record.token,
        issuedAt: typeof record.issuedAt === "string" ? record.issuedAt : new Date().toISOString(),
        ...(record.userId !== undefined ? { userId: record.userId } : {}),
        ...(record.email !== undefined ? { email: record.email } : {}),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Persists the CLI auth token at mode 0600.
 */
export function writeAuthToken(auth: StoredAuthToken): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(AUTH_FILE, 0o600);
}

/**
 * Removes stored CLI auth token.
 */
export function clearAuthToken(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE);
  }
}

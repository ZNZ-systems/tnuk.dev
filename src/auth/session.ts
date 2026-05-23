import { apiUrl } from "../config.js";
import { readAuthToken } from "./token.js";

export type SessionErrorCode =
  | "not_signed_in"
  | "session_expired"
  | "subscription_inactive"
  | "service_unavailable";

export interface SessionSuccess {
  ok: true;
  cursorApiKey: string;
  expiresAt: number;
}

export interface SessionFailure {
  ok: false;
  code: SessionErrorCode;
  billingUrl?: string;
}

export type SessionResult = SessionSuccess | SessionFailure;

interface SessionResponseBody {
  cursorApiKey?: string;
  expiresAt?: number;
  error?: string;
  billingUrl?: string;
}

const SESSION_TIMEOUT_MS = 15_000;

/**
 * Exchanges the stored CLI JWT for a short-lived Cursor API key.
 */
export async function exchangeAuthToken(): Promise<SessionResult> {
  const stored = readAuthToken();
  if (!stored) {
    return { ok: false, code: "not_signed_in" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, SESSION_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl("/api/cli/session"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stored.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ rubricVersion: "1.0.0" }),
      signal: controller.signal,
    });

    let body: SessionResponseBody = {};
    try {
      body = (await response.json()) as SessionResponseBody;
    } catch {
      body = {};
    }

    if (response.status === 401) {
      return { ok: false, code: "session_expired" };
    }
    if (response.status === 402) {
      return {
        ok: false,
        code: "subscription_inactive",
        billingUrl: body.billingUrl ?? "https://tnuk.dev/billing",
      };
    }
    if (response.status >= 500 || response.status === 503) {
      return { ok: false, code: "service_unavailable" };
    }
    if (!response.ok) {
      if (body.error === "session_expired") {
        return { ok: false, code: "session_expired" };
      }
      if (body.error === "subscription_inactive") {
        return {
          ok: false,
          code: "subscription_inactive",
          billingUrl: body.billingUrl ?? "https://tnuk.dev/billing",
        };
      }
      return { ok: false, code: "service_unavailable" };
    }

    const key = body.cursorApiKey?.trim();
    const expiresAt = body.expiresAt;
    if (!key || typeof expiresAt !== "number") {
      return { ok: false, code: "service_unavailable" };
    }

    return { ok: true, cursorApiKey: key, expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isNetwork =
      err instanceof TypeError ||
      message.includes("fetch failed") ||
      message.includes("aborted") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT");
    if (isNetwork) {
      return { ok: false, code: "service_unavailable" };
    }
    return { ok: false, code: "service_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Prints the user-facing message for a session failure and returns exit code.
 */
export function sessionFailureExit(failure: SessionFailure): number {
  switch (failure.code) {
    case "not_signed_in":
      process.stderr.write(
        'tnuk: not signed in. Run "tnuk login" or "git push --no-verify"\n',
      );
      return 1;
    case "session_expired":
      process.stderr.write('tnuk: session expired. Run "tnuk login" to renew\n');
      return 1;
    case "subscription_inactive":
      process.stderr.write(
        `tnuk: subscription inactive. Renew at ${failure.billingUrl ?? "https://tnuk.dev/billing"}\n`,
      );
      return 1;
    case "service_unavailable":
      process.stderr.write("tnuk: skipped (tnuk.dev unreachable)\n");
      return 0;
    default: {
      const _exhaustive: never = failure.code;
      return _exhaustive;
    }
  }
}

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { AUTH_FILE, loadAuth, TNUK_API_BASE_URL, type StoredAuth } from "../config.js";

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

interface DevicePollResponse {
  status: "pending" | "authorized" | "expired" | "denied";
  token?: string;
  expiresAt?: number;
  account?: string;
}

function api(path: string): string {
  return `${TNUK_API_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(`${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
  } catch {
    // best-effort; the URL is also printed for manual opening
  }
}

function persist(auth: StoredAuth): void {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the device-code login flow against the tnuk Worker and stores the seat token.
 */
export async function login(): Promise<number> {
  let start: DeviceStartResponse;
  try {
    start = await postJson<DeviceStartResponse>("/auth/device/start", {});
  } catch (err) {
    process.stderr.write(`Login failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  process.stdout.write(
    `\nTo authorize this machine, visit:\n  ${start.verificationUrl}\n\n` +
      `and enter the code:  ${start.userCode}\n\n`,
  );
  openBrowser(start.verificationUrl);

  const intervalMs = (start.intervalSeconds ?? 5) * 1000;
  const deadline = Date.now() + (start.expiresInSeconds ?? 600) * 1000;

  process.stdout.write("Waiting for authorization");
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    process.stdout.write(".");
    let poll: DevicePollResponse;
    try {
      poll = await postJson<DevicePollResponse>("/auth/device/poll", {
        deviceCode: start.deviceCode,
      });
    } catch {
      continue; // transient; keep polling until the deadline
    }

    if (poll.status === "authorized" && poll.token) {
      const stored: StoredAuth = { token: poll.token };
      if (poll.expiresAt !== undefined) stored.expiresAt = poll.expiresAt;
      if (poll.account !== undefined) stored.account = poll.account;
      persist(stored);
      process.stdout.write(`\n\nLogged in${poll.account ? ` as ${poll.account}` : ""}.\n`);
      return 0;
    }
    if (poll.status === "denied" || poll.status === "expired") {
      process.stdout.write(`\n\nAuthorization ${poll.status}. Run \`tnuk login\` again.\n`);
      return 1;
    }
  }

  process.stdout.write("\n\nLogin timed out. Run `tnuk login` again.\n");
  return 1;
}

export function logout(): number {
  if (existsSync(AUTH_FILE)) {
    rmSync(AUTH_FILE);
    process.stdout.write("Logged out.\n");
  } else {
    process.stdout.write("Not logged in.\n");
  }
  return 0;
}

export async function whoami(): Promise<number> {
  const auth = loadAuth();
  if (!auth) {
    process.stdout.write("Not logged in. Run `tnuk login`.\n");
    return 1;
  }

  try {
    const res = await fetch(api("/auth/whoami"), {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      process.stdout.write("Seat inactive. Ask your org admin to assign a seat, or run `tnuk login`.\n");
      return 1;
    }
    if (!res.ok) {
      process.stdout.write(`Logged in${auth.account ? ` as ${auth.account}` : ""} (status check unavailable).\n`);
      return 0;
    }
    const info = (await res.json()) as { account?: string; org?: string; seat?: string };
    process.stdout.write(
      `Logged in as ${info.account ?? auth.account ?? "unknown"}` +
        `${info.org ? `\nOrganization: ${info.org}` : ""}` +
        `${info.seat ? `\nSeat: ${info.seat}` : ""}\n`,
    );
    return 0;
  } catch {
    process.stdout.write(`Logged in${auth.account ? ` as ${auth.account}` : ""} (offline).\n`);
    return 0;
  }
}

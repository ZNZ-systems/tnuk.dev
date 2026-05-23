import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

import { apiBaseUrl, apiUrl } from "../config.js";
import { writeAuthToken, readAuthToken, type StoredAuthToken } from "./token.js";

const execFileAsync = promisify(execFile);

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEVICE_POLL_INTERVAL_MS = 2_000;

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  pollToken: string;
  verificationUrl: string;
  expiresAt: number;
}

interface DevicePollResponse {
  status: "pending" | "approved" | "expired";
  token?: string;
  userId?: string;
  email?: string;
  issuedAt?: string;
}

function shouldUseDeviceFlow(forceDevice: boolean): boolean {
  if (forceDevice) {
    return true;
  }
  if (process.env["SSH_CONNECTION"] || process.env["SSH_TTY"]) {
    return true;
  }
  if (process.platform === "linux" && !process.env["DISPLAY"]) {
    return true;
  }
  return false;
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execFileAsync("open", [url]);
      return;
    }
    if (platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
      return;
    }
    await execFileAsync("xdg-open", [url]);
  } catch {
    process.stderr.write(`Open this URL in your browser:\n  ${url}\n`);
  }
}

function waitForBrowserCallback(
  port: number,
  expectedState: string,
): Promise<StoredAuthToken> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        if (req.method === "POST" && req.url === "/callback") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              state?: string;
              token?: string;
              userId?: string;
              email?: string;
              issuedAt?: string;
            };
            if (body.state !== expectedState || !body.token) {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end("Invalid callback");
              return;
            }
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Signed in. You can close this tab and return to the terminal.");
            server.close();
            resolve({
              token: body.token,
              issuedAt: body.issuedAt ?? new Date().toISOString(),
              ...(body.userId !== undefined ? { userId: body.userId } : {}),
              ...(body.email !== undefined ? { email: body.email } : {}),
            });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
          return;
        }
        res.writeHead(404);
        res.end();
      })();
    });

    server.listen(port, "127.0.0.1", () => {
      // ready
    });

    server.on("error", reject);

    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 5 minutes"));
    }, LOGIN_TIMEOUT_MS);
  });
}

async function loginBrowserCallback(): Promise<StoredAuthToken> {
  const state = randomBytes(16).toString("hex");
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind localhost server for login");
  }
  const port = address.port;
  server.close();

  const authUrl = `${apiBaseUrl()}/cli-auth?port=${port}&state=${state}`;
  process.stderr.write("Opening browser for sign-in…\n");
  await openBrowser(authUrl);

  const token = await waitForBrowserCallback(port, state);
  return token;
}

async function startDeviceFlow(): Promise<DeviceStartResponse> {
  const response = await fetch(apiUrl("/api/cli/device/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Failed to start device login (${response.status})`);
  }
  return (await response.json()) as DeviceStartResponse;
}

async function pollDeviceFlow(pollToken: string, expiresAt: number): Promise<StoredAuthToken> {
  while (Date.now() < expiresAt) {
    const url = new URL(apiUrl("/api/cli/device/poll"));
    url.searchParams.set("token", pollToken);
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await sleep(DEVICE_POLL_INTERVAL_MS);
      continue;
    }
    const body = (await response.json()) as DevicePollResponse;
    if (body.status === "expired") {
      throw new Error("Device code expired. Run tnuk login again.");
    }
    if (body.status === "approved" && body.token) {
      return {
        token: body.token,
        issuedAt: body.issuedAt ?? new Date().toISOString(),
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
      };
    }
    await sleep(DEVICE_POLL_INTERVAL_MS);
  }
  throw new Error("Device login timed out");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loginDeviceCode(): Promise<StoredAuthToken> {
  const start = await startDeviceFlow();
  process.stderr.write("\n");
  process.stderr.write(`Visit ${start.verificationUrl}\n`);
  process.stderr.write(`Enter code: ${start.userCode}\n\n`);
  await openBrowser(`${start.verificationUrl}?code=${encodeURIComponent(start.userCode)}`);
  return pollDeviceFlow(start.pollToken, start.expiresAt);
}

/**
 * Runs interactive CLI login (browser callback or device code).
 */
export async function runLogin(forceDevice: boolean): Promise<void> {
  const useDevice = shouldUseDeviceFlow(forceDevice);
  if (useDevice && !forceDevice) {
    process.stderr.write("Browser not available — using device code login.\n");
  }

  const auth = useDevice ? await loginDeviceCode() : await loginBrowserCallback();
  writeAuthToken(auth);
  process.stdout.write("Signed in to tnuk.\n");
  if (auth.email) {
    process.stdout.write(`  ${auth.email}\n`);
  }
}

/**
 * Fetches account info for `tnuk whoami`.
 */
export async function fetchWhoami(): Promise<{ email?: string; plan?: string } | undefined> {
  const stored = readAuthToken();
  if (!stored) {
    return undefined;
  }

  try {
    const response = await fetch(apiUrl("/api/cli/whoami"), {
      headers: {
        Authorization: `Bearer ${stored.token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return stored.email !== undefined ? { email: stored.email } : {};
    }
    const body = (await response.json()) as { email?: string; plan?: string };
    return {
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.plan !== undefined ? { plan: body.plan } : {}),
    };
  } catch {
    return stored.email !== undefined ? { email: stored.email } : {};
  }
}

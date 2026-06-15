import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import { decodeIdToken } from "./jwt.js";
import {
  OAUTH_AUTHORIZE_URL,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_PATH,
  OAUTH_REDIRECT_PORTS,
  OAUTH_SCOPE,
  OAUTH_TOKEN_URL,
} from "./openai-endpoints.js";
import { CODEX_ORIGINATOR } from "./openai-private-backend.js";
import { saveFromExchange, validateTokenResponse, type TokenResponse } from "./token-store.js";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_HOST = "127.0.0.1";

export interface LoginResult {
  accountId: string;
  email?: string;
  planType?: string;
}

type ProgressFn = (message: string) => void;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function successHtml(): string {
  return [
    "<!doctype html><meta charset=utf-8><title>thermo-review</title>",
    "<body style='font-family:system-ui;padding:3rem;text-align:center'>",
    "<h2>Signed in to thermo-review</h2>",
    "<p>You can close this tab and return to your terminal.</p>",
  ].join("");
}

function failureHtml(reason: string): string {
  return [
    "<!doctype html><meta charset=utf-8><title>thermo-review</title>",
    "<body style='font-family:system-ui;padding:3rem;text-align:center'>",
    "<h2>Sign-in failed</h2>",
    `<p>${reason.replace(/[<>&]/g, "")}</p>`,
  ].join("");
}

interface CallbackServer {
  port: number;
  waitForCode: Promise<string>;
  close: () => void;
}

function listenOnFirstAvailable(server: Server, ports: readonly number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = (): void => {
      if (idx >= ports.length) {
        reject(new Error(`No free callback port among ${ports.join(", ")}.`));
        return;
      }
      const port = ports[idx]!;
      idx += 1;
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === "EADDRINUSE") {
          tryNext();
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, CALLBACK_HOST, () => {
        server.removeListener("error", onError);
        resolve(port);
      });
    };
    tryNext();
  });
}

async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (err: Error) => void = () => {};
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== OAUTH_REDIRECT_PATH) {
      res.writeHead(404).end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(failureHtml(error));
      rejectCode(new Error(`Authorization failed: ${error}`));
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(failureHtml("state mismatch"));
      rejectCode(new Error("OAuth state mismatch or missing code (possible CSRF)."));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" }).end(successHtml());
    resolveCode(code);
  });

  const port = await listenOnFirstAvailable(server, OAUTH_REDIRECT_PORTS);

  const timer = setTimeout(() => {
    rejectCode(new Error("Timed out waiting for browser sign-in."));
  }, CALLBACK_TIMEOUT_MS);
  timer.unref();

  return {
    port,
    waitForCode,
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}

function openBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* ignore: the URL is printed as a fallback */
    });
    child.unref();
  } catch {
    /* ignore: the URL is printed as a fallback */
  }
}

function buildAuthorizeUrl(params: {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: params.redirectUri,
    scope: OAUTH_SCOPE,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: params.state,
    originator: CODEX_ORIGINATOR,
  });
  return `${OAUTH_AUTHORIZE_URL}?${query.toString()}`;
}

async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: params.codeVerifier,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json: unknown = await res.json();
  return validateTokenResponse(json, { requireIdToken: true });
}

/**
 * Runs the "Sign in with ChatGPT" PKCE flow: starts a loopback callback server,
 * opens the browser, exchanges the returned code for tokens, and persists them.
 */
export async function loginOpenAI(opts: { onProgress?: ProgressFn } = {}): Promise<LoginResult> {
  const onProgress = opts.onProgress ?? ((): void => {});
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = base64url(randomBytes(32));
  const server = await startCallbackServer(state);

  try {
    // redirect_uri must be byte-exact and use "localhost"; build it after binding.
    const redirectUri = `http://localhost:${server.port}${OAUTH_REDIRECT_PATH}`;
    const authorizeUrl = buildAuthorizeUrl({ codeChallenge, state, redirectUri });
    openBrowser(authorizeUrl);
    onProgress(`Opened browser for sign-in. If it didn't open, visit:\n  ${authorizeUrl}`);

    const code = await server.waitForCode;
    onProgress("Exchanging authorization code…");
    const tokens = await exchangeCode({ code, codeVerifier, redirectUri });

    if (!tokens.id_token) {
      throw new Error("Token response missing id_token.");
    }
    const claims = decodeIdToken(tokens.id_token);
    if (!claims.accountId) {
      throw new Error("Signed in, but the id_token has no ChatGPT account id; cannot call the backend.");
    }

    await saveFromExchange(tokens, {
      accountId: claims.accountId,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.planType ? { planType: claims.planType } : {}),
    });

    const result: LoginResult = { accountId: claims.accountId };
    if (claims.email) {
      result.email = claims.email;
    }
    if (claims.planType) {
      result.planType = claims.planType;
    }
    return result;
  } finally {
    server.close();
  }
}

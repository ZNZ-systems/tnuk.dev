// OpenAI "Sign in with ChatGPT" OAuth + ChatGPT backend constants.
//
// These mirror the Codex CLI's public PKCE client. They are reverse-engineered
// from Codex and undocumented by OpenAI; treat them as MUST-VERIFY if sign-in
// or requests start failing (see README "Known risks").

export const OAUTH_ISSUER = "https://auth.openai.com";
export const OAUTH_AUTHORIZE_URL = `${OAUTH_ISSUER}/oauth/authorize`;
export const OAUTH_TOKEN_URL = `${OAUTH_ISSUER}/oauth/token`;

/** Public PKCE client (no secret). */
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const OAUTH_SCOPE = "openid profile email offline_access";

/** Loopback callback ports tried in order; redirect_uri uses whichever binds. */
export const OAUTH_REDIRECT_PORTS = [1455, 1457] as const;
export const OAUTH_REDIRECT_PATH = "/auth/callback";

/** ChatGPT-subscription model endpoint (no /v1; the client appends /responses). */
export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Marks the request as originating from a first-party Codex-style client. */
export const CODEX_ORIGINATOR = "codex_cli_rs";

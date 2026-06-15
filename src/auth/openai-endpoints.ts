// Experimental "Sign in with ChatGPT" OAuth constants.
//
// These mirror the Codex CLI's public PKCE client. They are reverse-engineered
// from Codex and undocumented by OpenAI; the ChatGPT auth mode is explicit
// opt-in and may break without notice (see README "Experimental ChatGPT OAuth").

export const OAUTH_ISSUER = "https://auth.openai.com";
export const OAUTH_AUTHORIZE_URL = `${OAUTH_ISSUER}/oauth/authorize`;
export const OAUTH_TOKEN_URL = `${OAUTH_ISSUER}/oauth/token`;

/** Public PKCE client (no secret). */
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const OAUTH_SCOPE = "openid profile email offline_access";

/** Loopback callback ports tried in order; redirect_uri uses whichever binds. */
export const OAUTH_REDIRECT_PORTS = [1455, 1457] as const;
export const OAUTH_REDIRECT_PATH = "/auth/callback";

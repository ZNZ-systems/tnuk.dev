export const PRO_PLAN_SLUG = "pro";
export const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "https://tnuk.dev";
export const CLI_JWT_ISSUER = "tnuk.dev";
export const CLI_JWT_AUDIENCE = "tnuk-cli";
export const CLI_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const CURSOR_KEY_TTL_SECONDS = 600; // 10 minutes per review session
export const DEVICE_CODE_TTL_SECONDS = 600;

export interface Env {
  TNUK_KV: KVNamespace;

  // vars
  DASHBOARD_URL: string;
  CURSOR_UPSTREAM: string;
  REQUIRED_PLAN: string;

  // secrets
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  CURSOR_MANAGED_API_KEY: string;
  TNUK_JWT_SECRET: string;
}

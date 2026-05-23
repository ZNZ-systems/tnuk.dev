# tnuk web (tnuk.dev)

Next.js app for marketing, Clerk auth, billing, and CLI session API.

## Setup

1. Complete [Stripe Projects setup](../docs/setup/stripe-projects.md).
2. Pull env vars: `stripe projects env --pull` (from repo root).
3. Copy required vars into `web/.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLI_JWT_SECRET=           # openssl rand -base64 32
CURSOR_API_KEY=           # team service account
DATABASE_URL=             # from primary-db resource
NEXT_PUBLIC_APP_URL=https://tnuk.dev
```

4. Enable Clerk Billing and apply plan config:

```bash
cd web
clerk enable billing --for user
clerk config patch --file billing.json
```

5. Install and run:

```bash
npm install
npm run dev
```

## Vercel

- Root directory: `web`
- Domain: `tnuk.dev`
- See [DNS setup](../docs/setup/tnuk-dev-dns.md)

## API routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/cli/session` | CLI JWT | Returns short-lived Cursor key |
| `POST /api/cli/auth/issue` | Clerk session | Issues CLI JWT after browser login |
| `POST /api/cli/device/start` | Public | Starts device code flow |
| `GET /api/cli/device/poll` | Public | CLI polls for approval |
| `POST /api/cli/device/approve` | Clerk session | User approves device code |
| `GET /api/cli/whoami` | CLI JWT | Account + plan for `tnuk whoami` |

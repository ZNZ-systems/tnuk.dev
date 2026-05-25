## Learned User Preferences

- Prefer agents to handle Clerk webhook and Cloudflare Worker setup end-to-end when credentials and Wrangler access are available; only hand off steps that require external dashboards (DNS registrar, Clerk webhook UI).
- Prefer moving `tnuk.dev` nameservers to Cloudflare over split DNS on Vercel when the API runs on a Cloudflare Worker.
- Keep `thermo-review` working locally via direct `CURSOR_API_KEY`, not seat auth only.

## Learned Workspace Facts

- **Product:** tnuk is a pre-push thermo-nuclear code review CLI (`tnuk` and `thermo-review` bin aliases) using the Cursor SDK; review rubric is bundled at `skill/SKILL.md` and inlined in the agent prompt.
- **Repo layout:** soft monorepo — root CLI (`src/`), `dashboard/` (Vite + Clerk React SPA), `worker/` (Cloudflare Worker), `clerk/` (billing config).
- **Review auth:** dual mode — TNUK seat token (`tnuk login` / `TNUK_TOKEN`, proxied through Worker) or direct `CURSOR_API_KEY` (env or `~/.config/thermo-review/env`).
- **Worker API:** deployed as `tnuk-api.panos-501.workers.dev`; `api.tnuk.dev` custom domain registered in `worker/wrangler.toml`; default `TNUK_API_BASE_URL` is `https://api.tnuk.dev`.
- **DNS:** `tnuk.dev` zone still uses Vercel nameservers; Cloudflare account `501550e5639d5031ffcbfc35702ef689` hosts the Worker.
- **Deployment state:** dashboard/landing not deployed yet; Worker API is the only live hosted component; local review works without hosted infra.
- **Billing:** Clerk B2B org billing — Team plan at $40/seat/month; custom dashboard UI uses `CheckoutButton` / `SubscriptionDetailsButton`; Worker KV fed by Clerk billing webhooks (`REQUIRED_PLAN = "org:team"`).
- **Review runtime:** `settingSources` for the local SDK agent excludes `plugins` because the skill rubric is already inlined (avoids double-loading).
- **Build:** `npm run build` runs `tsc && chmod +x dist/cli.js` so the CLI bin stays executable.

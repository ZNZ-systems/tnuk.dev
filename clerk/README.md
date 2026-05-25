# Clerk setup for tnuk

tnuk sells **$40 / developer seat / month** to **organizations**. Auth, org
membership, and billing all live in Clerk; the Worker reads webhook-fed state.
The dashboard uses **custom UI** (not prebuilt `<OrganizationProfile />`) with
Clerk Billing checkout via `CheckoutButton`.

## 1. Enable Billing + Organizations

```bash
clerk auth login
clerk link                 # link this repo to your Clerk app
clerk enable billing --for org
```

Make sure Organizations are enabled (Dashboard → Organizations). For a pure-B2B
product, set Organizations to required.

## 2. Create the seat-based Team plan ($40/seat)

The starter `billing.json` here creates an **organization** plan `team` at
$40 (`amount: 4000`, USD). Apply it:

```bash
clerk config patch --file clerk/billing.json --dry-run
clerk config patch --file clerk/billing.json
```

Then, in [Dashboard → Billing → Plans](https://dashboard.clerk.com/last-active?path=billing/plans)
→ **Organization Plans** → open `team`:

- Toggle **Seat-based** ON so the org is billed $40 × seats (variable), rather
  than a flat price.
- Attach the `thermo_review` feature.
- Copy the **Plan ID** (`cplan_…`) into `dashboard/.env` as `VITE_CLERK_TEAM_PLAN_ID`.

> The Worker's `REQUIRED_PLAN` is `org:team`. Its plan check strips the `org:`
> prefix, so a stored slug of either `team` or `org:team` matches.

## 3. Deploy the Worker

From the repo root:

```bash
npm run setup:worker
```

This reads `CLERK_SECRET_KEY` from `.env.local`, `CURSOR_API_KEY` from
`~/.config/thermo-review/env`, generates `TNUK_JWT_SECRET`, pushes wrangler
secrets, and deploys `tnuk-api`.

**Current deploy URL:** `https://tnuk-api.panos-501.workers.dev`

**Custom domain:** `api.tnuk.dev` is configured in `worker/wrangler.toml`.

## 4. Billing webhook → Worker

Clerk webhooks are created in the Dashboard (not via Backend API).

1. [Dashboard → Webhooks](https://dashboard.clerk.com/last-active?path=webhooks) → **Add endpoint**
2. **URL:** `https://api.tnuk.dev/webhooks/clerk`  
   Until DNS is live, use `https://tnuk-api.panos-501.workers.dev/webhooks/clerk`
3. **Events:**
   - `subscription.created`
   - `subscription.updated`
   - `subscription.active`
   - `subscription.pastDue`
   - `subscriptionItem.canceled`
   - `subscriptionItem.pastDue`
   - `subscriptionItem.ended`
   - `subscriptionItem.expired`
4. Copy the **Signing Secret** (`whsec_…`), then:

```bash
npm run setup:clerk-webhook -- whsec_...
```

## 5. Dashboard env

`dashboard/.env`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_CLERK_TEAM_PLAN_ID=cplan_...   # Team org plan from Clerk Billing
VITE_API_URL=https://api.tnuk.dev   # or workers.dev URL until DNS is live
```

## Flow recap

1. Org admin creates a team on `/billing` and subscribes via the custom Subscribe
   button (opens Clerk checkout drawer for the Team plan).
2. Clerk fires billing webhooks → Worker stores org subscription in KV.
3. Admin invites devs from the custom members panel (Clerk caps invites at the seat limit).
4. Each dev runs `tnuk login` → enters the code at `tnuk.dev/activate`.
5. The dashboard calls `/auth/device/approve` with the dev's Clerk session; the
   Worker confirms the org's subscription is active and mints a seat token.
6. On `git push`, the CLI runs the review locally but routes the SDK through the
   Worker, which validates the seat per request and injects the managed Cursor key.

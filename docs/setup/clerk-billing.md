# Clerk Billing — Pro plan ($40/mo)

Apply after linking Clerk via Stripe Projects and provisioning the auth app.

## Enable billing

```bash
cd web
clerk enable billing --for user
```

## Apply plan config

`web/billing.json` defines:

- slug: `pro`
- $40/mo (`amount`: 4000 cents)
- 7-day trial (`trial_period_days`: 7)

```bash
clerk config patch --file billing.json --dry-run
clerk config patch --file billing.json
```

## Verify

1. Open https://tnuk.dev/pricing — `<PricingTable />` shows Pro plan.
2. Complete test checkout in Clerk development mode.
3. `tnuk whoami` shows `plan: pro` after login.

The CLI session endpoint checks `has({ plan: 'pro' })` via Clerk Billing API.

For local dev without billing, set `SKIP_BILLING_CHECK=1` in Vercel preview only.

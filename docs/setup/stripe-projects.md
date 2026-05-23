# Stripe Projects setup (link existing accounts)

Link **your existing Stripe account** (revenue) and **Clerk account** (premium) before provisioning services.

## Browser hygiene

Before each `stripe projects link` or browser auth step:

1. Sign out of all Clerk and Stripe dashboard sessions.
2. Sign in to **only** the target accounts.

## Phase 0 — Link accounts

```bash
which stripe && stripe --version   # need >= 1.40.0
stripe login                       # pick your existing Stripe account (live, not sandbox)
stripe plugin install projects

cd /path/to/thermo-review-cli
stripe projects status --json
stripe projects init               # omit --json first time; confirm merchant in browser if prompted
stripe projects link clerk         # pick Clerk org with premium subscription
stripe projects open clerk         # verify correct dashboard opens
stripe projects status --json      # stripe + clerk both LINKED
```

**Wrong account?**

```bash
stripe projects link clerk --force
stripe projects remove <resource>  # if a service was provisioned into wrong account
```

## Phase 1 — Discover slugs (never guess)

```bash
stripe projects catalog clerk      --json | jq -r '.services[].slug'
stripe projects catalog stripe     --json | jq -r '.services[].slug'
stripe projects catalog resend     --json | jq -r '.services[].slug'
stripe projects catalog vercel     --json | jq -r '.services[].slug'
stripe projects catalog databaseco --json | jq -r '.services[].slug'
```

## Phase 1 — Provision

```bash
# Clerk auth service slug (from `stripe projects catalog clerk`):
stripe projects add clerk/auth          --name auth        --yes
stripe projects add stripe/<slug>       --name billing     --yes
stripe projects add resend/<slug>       --name email       --yes
stripe projects add databaseco/postgres --name primary-db  --yes
stripe projects add vercel/<slug>       --name web         --yes

stripe projects open clerk
stripe projects open vercel
stripe projects status
stripe projects env    # var names only; values redacted
```

Pull credentials into the web app when ready:

```bash
stripe projects env --pull   # writes .env — do not commit
```

Do not hand-edit `.projects/` or `.env`.

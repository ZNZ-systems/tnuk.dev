# Cursor TOS inquiry (BLOCKING before accepting payments)

Send this to Cursor support or your account rep before charging customers.

**Subject:** Paid SaaS using team service-account API key via `@cursor/sdk`

**Body:**

> We are building **tnuk** (https://tnuk.dev), a pre-push code quality CLI. Paying subscribers ($40/mo) run reviews locally via `@cursor/sdk` (`Agent.create({ local: { cwd } })`). Our backend validates subscription status (Clerk Billing + Stripe) and returns a short-lived team **service-account** API key for each review run. End users never receive or store the key.
>
> Questions:
> 1. Is this resale / proxy use of a team service-account key permitted under Cursor's Terms of Service?
> 2. Are there rate limits or commercial restrictions we should document for subscribers?
> 3. Is programmatic per-customer key minting available, or should we use a single rotating team key?
>
> We will not accept paid customers until we receive written confirmation.

Track the response here and update `docs/ops/launch-checklist.md` when approved.

# Launch checklist

- [ ] Cursor TOS approval received ([cursor-tos-inquiry.md](./cursor-tos-inquiry.md))
- [ ] Stripe Projects linked to existing Stripe + Clerk accounts ([stripe-projects.md](../setup/stripe-projects.md))
- [ ] Clerk Billing enabled; `pro` plan at $40/mo with 7-day trial (`web/billing.json`)
- [ ] `CURSOR_API_KEY` set in Vercel (team service account)
- [ ] `CLI_JWT_SECRET` set in Vercel (`openssl rand -base64 32`)
- [ ] `tnuk.dev` DNS → Vercel ([tnuk-dev-dns.md](../setup/tnuk-dev-dns.md))
- [ ] Clerk allowed origins include `https://tnuk.dev`
- [ ] `npm publish` for package `tnuk` @ 0.2.0
- [ ] Smoke test: `tnuk login` → `tnuk review` → `git push`

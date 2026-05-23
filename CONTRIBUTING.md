# Contributing to tnuk

Thanks for helping improve tnuk.

## Setup

```bash
git clone https://github.com/pzep1/thermo-review-cli.git
cd thermo-review-cli
npm install
npm run build
npm link
```

For paid auth flows against a local web app:

```bash
cd web && npm install && npm run dev
export TNUK_API_URL=http://localhost:3000
tnuk login
```

## Before opening a PR

1. `npm test`
2. Manual smoke (in a git repo with subscription or `SKIP_BILLING_CHECK=1` on web):
   ```bash
   tnuk review --help
   tnuk review
   ```

## Reporting issues

Include:

- `tnuk --version`
- OS and Node version
- Relevant stderr output (redact tokens)

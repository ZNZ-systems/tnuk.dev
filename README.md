# tnuk

**Pre-push code quality gate** at [tnuk.dev](https://tnuk.dev). Runs a thermo-nuclear maintainability review before every `git push`. Subscription includes managed Cursor inference — no API key setup.

```text
git push
  → tnuk runs locally via @cursor/sdk
  → VERDICT: PASS  → push continues
  → VERDICT: BLOCK → push blocked, copy review into your agent
```

## Quick start

```bash
npm install -g tnuk
tnuk login
tnuk hook install --global-hooks-path
git push
```

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 20+** | `node -v` |
| **git** | Any recent version |
| **tnuk subscription** | [tnuk.dev/pricing](https://tnuk.dev/pricing) — $40/mo, 7-day trial |

No Cursor app, no Cursor account, no plugins required on your machine.

## Commands

```bash
tnuk login              # Sign in (browser or device code in SSH)
tnuk login --device     # Force device-code flow
tnuk logout
tnuk whoami
tnuk review
tnuk review --base main --json
tnuk hook install --global-hooks-path
TNUK_SKIP=1 git push    # Skip review once
git push --no-verify    # Skip all pre-push hooks
```

## When push is blocked

1. Read priority findings in the terminal
2. Copy the section under **COPY BELOW INTO CURSOR AGENT**
3. Fix blockers and push again

Last report is saved to `.git/tnuk-last.md`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | PASS — or review skipped (network unavailable) |
| `1` | Not signed in, expired session, inactive subscription, or SDK config error |
| `2` | Agent run error |
| `3` | BLOCK — push blocked |

## Local development

```bash
git clone https://github.com/pzep1/thermo-review-cli.git
cd thermo-review-cli
npm install
npm run build
npm link

# Point CLI at local web app
export TNUK_API_URL=http://localhost:3000
tnuk login
```

Web app: see [web/README.md](web/README.md).

## License

[MIT](LICENSE)

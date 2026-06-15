# thermo-review

**Pre-push code quality gate** that runs the [thermo-nuclear code quality review](https://github.com/cursor/cursor-team-kit) skill before every `git push`. If the review fails, push is blocked and you get a formatted block to paste back into your agent.

It runs through one of two interchangeable backends:

| Provider | SDK | Auth |
|----------|-----|------|
| `openai` (default) | [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) | **Sign in with ChatGPT** (OAuth) |
| `cursor` | [Cursor SDK](https://cursor.com/docs/sdk/typescript) | `CURSOR_API_KEY` |

```text
git push
  → thermo-review runs locally via the selected backend
  → VERDICT: PASS  → push continues
  → VERDICT: BLOCK → push blocked, copy review into your agent
```

Pick the backend with `--provider`, the `THERMO_REVIEW_PROVIDER` env var, or the config file (see [Providers](#providers)). The default is `openai` — run `thermo-review login` once, then `git push` reviews via the OpenAI Agents SDK. Set `--provider cursor` (or `THERMO_REVIEW_PROVIDER=cursor`) to use the Cursor backend instead.

## Why this exists

Most pre-push hooks run linters or tests. This one runs a **strict maintainability review** focused on:

- Structural regressions and missed simplification opportunities ("code judo")
- Files crossing 1,000 lines
- Spaghetti branching and feature logic leaking into shared paths
- Boundary and abstraction quality

It is intentionally harsh. Passing means the change meets the thermo-nuclear approval bar, not just "it compiles."

## How it works

```mermaid
flowchart TD
  gitPush[git push] --> prePushHook["~/.git-templates/hooks/pre-push"]
  prePushHook --> cli["thermo-review hook run"]
  cli --> scope[Resolve commits being pushed]
  scope --> backend{Provider}
  backend -->|cursor| cur[Local Cursor SDK agent]
  backend -->|openai| oai[OpenAI Agents SDK agent + git/file tools]
  cur --> parse[Parse VERDICT + SUMMARY]
  oai --> parse
  parse -->|PASS| allow[exit 0 — push proceeds]
  parse -->|BLOCK| block[Formatted review + exit 3]
```

The agent reviews the git diff in scope, inlines the thermo-nuclear skill instructions, and must respond with a machine-parseable verdict before the full review body. The Cursor backend uses the local agent's built-in shell/file access; the OpenAI backend is given sandboxed `git_diff` / `git_log` / `read_file` / `list_files` tools scoped to the repo root.

---

## Providers

`thermo-review` resolves the backend in this order: `--provider <name>` flag → `THERMO_REVIEW_PROVIDER` env → `~/.config/thermo-review/config.json` (`{"provider": "cursor"}`) → default `openai`.

### OpenAI Agents SDK — Sign in with ChatGPT (default)

Authenticates with **Sign in with ChatGPT** OAuth — no API key. One-time login:

```bash
thermo-review login           # opens a browser, completes OAuth on localhost:1455
thermo-review review --provider openai
thermo-review logout          # remove stored credentials
```

Credentials are cached at `~/.config/thermo-review/openai-auth.json` (mode `0600`) and refreshed automatically before expiry. The model defaults to `gpt-5.5` (run with `high` reasoning effort) and is overridable with `THERMO_REVIEW_OPENAI_MODEL` or the config-file `openaiModel` key.

> ⚠️ **Known risks — read before using the OpenAI provider.**
> This path uses your **ChatGPT subscription** (not OpenAI Platform API credits) by calling the same ChatGPT backend the Codex CLI uses, and it sends a Codex-style `originator` / `User-Agent` so the backend accepts the request. OpenAI's own docs steer programmatic/automation workflows toward API keys. Driving an automated pre-push gate this way is a **gray area**: requests consume your ChatGPT plan allowance (rolling rate limits), and abuse "may result in rate limits, suspension, or termination." Use it for single-user local review only; do not pool or share tokens. The OAuth client id, endpoints, model availability, and backend request shape are reverse-engineered from Codex and **undocumented by OpenAI** — they can change without notice and break sign-in or reviews.

### Cursor

```bash
thermo-review review --provider cursor
# or: THERMO_REVIEW_PROVIDER=cursor / {"provider":"cursor"} in config.json
```

Requires `CURSOR_API_KEY` and the Cursor IDE / local agent bridge. See [setup](#full-setup-guide) below.

---

## Full setup guide

### 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 22+** | `node -v` |
| **git** | Any recent version |
| **Cursor IDE** | _Cursor provider only_ — with CLI / local agent bridge working |
| **Cursor API key** | _Cursor provider only_ — [Dashboard → Integrations](https://cursor.com/dashboard/integrations) |
| **ChatGPT account** | _OpenAI provider only_ — used via `thermo-review login` |

The thermo-nuclear skill is **bundled** with the package, so no plugin install is required. If you have the **cursor-team-kit** plugin installed in Cursor, its copy is used automatically; otherwise the bundled copy is used. Override either with `THERMO_REVIEW_SKILL_PATH=/path/to/SKILL.md`.

### 2. Install thermo-review

**From source (recommended today):**

```bash
git clone https://github.com/pzep1/thermo-review-cli.git
cd thermo-review-cli
npm install
npm run build
npm link
```

Verify:

```bash
thermo-review --version
thermo-review --help
```

You should see the `review` and `hook` subcommands.

### 3. Configure your API key

The pre-push hook needs `CURSOR_API_KEY`. Pick one method.

#### Option A — shell profile (simple)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export CURSOR_API_KEY="cursor_..."
```

Reload your shell: `source ~/.zshrc`

#### Option B — config file (recommended for hooks)

Hooks do not always inherit your shell profile. A dedicated config file is more reliable:

```bash
mkdir -p ~/.config/thermo-review
```

Create `~/.config/thermo-review/env`:

```bash
export CURSOR_API_KEY="cursor_YOUR_KEY_HERE"
```

Lock down permissions:

```bash
chmod 600 ~/.config/thermo-review/env
```

The pre-push hook sources this file automatically when present.

> **Tip:** If your editor says "Parent dirs don't exist", run `mkdir -p ~/.config/thermo-review` first, then create the file.

Test that the key is visible:

```bash
source ~/.config/thermo-review/env
echo "${CURSOR_API_KEY:0:12}..."   # should print cursor_... prefix only
```

### 4. Install the pre-push hook

Choose based on whether you want this on **new repos only** or **all repos**.

#### New repos only

```bash
thermo-review hook install
```

Sets `git config --global init.templateDir ~/.git-templates`. Repos you `git init` after this inherit the hook.

#### All repos on this machine (most common)

```bash
thermo-review hook install --global-hooks-path
```

This also sets `git config --global core.hooksPath ~/.git-templates/hooks`, so **existing clones** use the hook too.

Confirm installation:

```bash
ls -la ~/.git-templates/hooks/pre-push
git config --global --get init.templateDir
git config --global --get core.hooksPath   # if you used --global-hooks-path
```

#### If you already have a custom pre-push hook

Global `core.hooksPath` bypasses `.git/hooks/`. Preserve your old hook by renaming it:

```bash
mv .git/hooks/pre-push .git/hooks/pre-push.local
```

After thermo-review passes, `pre-push.local` runs automatically.

### 5. Smoke test (manual review)

Before relying on the hook, run a manual review in a real repo:

```bash
cd ~/path/to/your-project
git checkout your-feature-branch
thermo-review review
```

Expected outcomes:

- **PASS** — prints `VERDICT: PASS — <summary>`, exit code 0
- **BLOCK** — prints a bordered report with "COPY BELOW INTO CURSOR AGENT", exit code 3
- **Config error** — missing API key, exit code 1 with setup instructions

Try JSON output for scripting:

```bash
thermo-review review --json
```

### 6. Smoke test (pre-push hook)

```bash
cd ~/path/to/your-project
git push
```

You should see `[thermo-review]` progress lines on stderr while the agent runs.

Escape hatches:

```bash
git push --no-verify              # skip all pre-push hooks
THERMO_REVIEW_SKIP=1 git push     # skip thermo-review only
```

---

## Daily usage

### Manual review

```bash
thermo-review review
thermo-review review --base main
thermo-review review --provider openai   # use the OpenAI backend (after `thermo-review login`)
thermo-review review --quiet       # verdict line only
thermo-review review --json        # machine-readable
thermo-review review --skip        # no-op, exit 0
```

### Automatic on push

Every `git push` runs the review on commits being pushed:

- **Update push** — diff from remote tip to local tip
- **New branch** — diff from merge-base with `main`/`master` to HEAD

Override base branch:

```bash
thermo-review review --base develop
```

### When push is blocked

1. Read the summary and priority findings in the terminal
2. Copy the section under **COPY BELOW INTO CURSOR AGENT**
3. Paste into Cursor and fix the blockers
4. Push again: `git push`

The full report is also saved to `.git/thermo-review-last.md` in your repo for re-copy without re-running.

Example agent prompt prefix:

```text
/thermo-nuclear-code-quality-review

Fix these blockers from pre-push review on branch my-feature:
...
```

---

## Verdict contract

The agent must start its response with exactly:

```text
VERDICT: PASS|BLOCK
SUMMARY: <one sentence, max 120 chars>
```

Then the full review. If these lines are missing, the hook **fails closed** (BLOCK).

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | PASS — push allowed |
| `1` | SDK startup / config error (check API key, Cursor CLI) |
| `2` | Agent run error |
| `3` | BLOCK — push blocked |

---

## Troubleshooting

### `CURSOR_API_KEY not set`

Create `~/.config/thermo-review/env` (see step 3) or export the variable in your shell.

### `Thermo-nuclear skill not found`

A copy of the skill ships with the package, so this should be rare. If you set `THERMO_REVIEW_SKILL_PATH` or a config `skillPath`, make sure it points at a readable `SKILL.md`. Resolution order: `THERMO_REVIEW_SKILL_PATH` → config `skillPath` → Cursor plugin cache → bundled copy.

### OpenAI provider: `Not signed in to OpenAI`

Run `thermo-review login` to complete the Sign in with ChatGPT flow. If the browser does not open, copy the printed URL manually. The callback listens on `localhost:1455` (falls back to `1457`) — make sure that port is free and not blocked by a firewall. If reviews start failing with auth errors after working before, run `thermo-review login` again (the OAuth client and backend are undocumented and can change).

### `command not found: thermo-review`

Run `npm link` from the cloned repo, or add the project's `dist/cli.js` to your PATH.

### Hook does not run on push

Check global git config:

```bash
git config --global core.hooksPath
cat ~/.git-templates/hooks/pre-push
```

Ensure `thermo-review` is on PATH in non-interactive shells (npm link usually handles this).

### Hook runs but push is slow

A full agent review takes as long as one agent turn (often 1–5+ minutes), on either backend. This is expected. Use `THERMO_REVIEW_SKIP=1` or `--no-verify` when you need an emergency push.

### `Repository has no commits yet`

Make at least one commit before running review.

### Cursor provider: SDK startup failed

- Confirm Cursor is installed and the local agent bridge works
- Verify API key at [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations)
- Try `thermo-review review` manually and read the full error on stderr

---

## Uninstall

```bash
thermo-review logout              # remove stored OpenAI credentials (if used)
thermo-review hook uninstall
npm unlink -g thermo-review-cli
rm -rf ~/.config/thermo-review    # optional, removes API key + OpenAI auth files
```

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/pzep1/thermo-review-cli.git
cd thermo-review-cli
npm install
npm run dev    # watch mode
```

### Project layout

```text
src/
  cli.ts                       Commander entrypoint (review, login, logout, hook)
  config.ts                    Provider/key/skill resolution + config file
  types.ts                     Shared types (ProviderId, ReviewScope, …)
  review/
    run.ts                     Orchestrator: skill → prompt → backend → parse → format
    backend.ts                 ReviewBackend interface + BackendError
    provider.ts                Backend selection (lazy-imports the chosen backend)
    backends/cursor.ts         Cursor SDK runner
    backends/openai.ts         OpenAI Agents SDK runner (ChatGPT backend)
    tools.ts                   Sandboxed git/file tools for the OpenAI agent
    prompt.ts                  Review prompt builder (shared)
    parse-verdict.ts           VERDICT/SUMMARY parser (shared)
    format-blocked.ts          Terminal output formatter (shared)
  auth/
    openai-oauth.ts            Sign in with ChatGPT PKCE flow
    token-store.ts             Credential storage + refresh
    jwt.ts                     id_token claim decoding
    openai-endpoints.ts        OAuth + ChatGPT backend constants
  git/push-scope.ts            Pre-push diff scope
  hook/install.ts              Hook install/uninstall
templates/hooks/pre-push       Shell hook template
templates/skills/thermo-nuclear/SKILL.md   Bundled review skill
```

---

## License

[MIT](LICENSE)

## Acknowledgments

- Review rubric from [cursor-team-kit](https://github.com/cursor/cursor-team-kit) thermo-nuclear skill
- Built with [@cursor/sdk](https://cursor.com/docs/sdk/typescript) and the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
- "Sign in with ChatGPT" OAuth flow modeled on the [OpenAI Codex CLI](https://developers.openai.com/codex/auth)

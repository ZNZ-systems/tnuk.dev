# Code-review methodologies — research notes & what thermo-review adopts

This doc captures the methodologies and repos surveyed while structuring thermo-review's
review gate, and records which structural ideas the tool adopts (and where). It is
background/reference material, not a usage guide — see the [README](../README.md) for that.

The throughline: a strict, automated, **binary** gate (PASS/BLOCK) that stays high-signal
needs (a) an explicit approval bar, (b) findings disciplined by confidence and severity, and
(c) — when more than one model reviews — an *adversarial* combination, not a consensus that
rubber-stamps. The sources below are primary (official docs / the actual repos / the papers).

---

## 1. Human code-review methodologies

| Source | Lift |
|--------|------|
| **Google Engineering Practices — Code Review Developer Guide** ([guide](https://google.github.io/eng-practices/review/), [standard](https://google.github.io/eng-practices/review/reviewer/standard.html), [what to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html)) | One explicit approval bar: approve when the change *"definitely improves the overall code health of the system… even if it isn't perfect."* "No perfect code, only better code" → don't block on perfectionism. Fixed checklist (Design, Functionality, Complexity, Tests, Naming, Comments, Style, Consistency) as a finding taxonomy. `Nit:` prefix for non-blocking polish. Conflicts resolved by technical fact, not preference. |
| **Conventional Comments** ([conventionalcomments.org](https://conventionalcomments.org/)) | Finding grammar `<label> [decoration]: <subject>`. Labels: praise, nitpick, suggestion, issue, todo, question, thought, chore, note. Decorations: **(blocking) / (non-blocking) / (if-minor)**. Only `issue … (blocking)` items should flip a binary verdict. |
| **Code Review Pyramid** — Gunnar Morling ([morling.dev](https://www.morling.dev/blog/the-code-review-pyramid/)) | Spend the review budget on the upper layers (API semantics → implementation semantics → docs → tests → **style last**). The bottom layer (formatting/style) "could and should be automated" → the LLM gate should *ignore* lint-class issues and leave them to linters. |
| **Netlify Feedback Ladders** ([github.com/netlify/feedback-ladders](https://github.com/netlify/feedback-ladders)) | A named severity scale: mountain (blocking) → boulder (should-fix) → pebble (follow-up) → sand (nit) → dust (optional). Only mountain/boulder ⇒ BLOCK. |
| **Checklists** — Michaela Greiler ([checklist](https://www.michaelagreiler.com/code-review-checklist-2/)), **awesome-code-review** ([github.com/joho/awesome-code-review](https://github.com/joho/awesome-code-review)) | Turn the checklist into the categories each finding must be tagged with → auditable, dedupable findings (important for the ledger). |

## 2. AI / LLM code-review tools

| Tool | Encoded methodology |
|------|---------------------|
| **qodo-ai/pr-agent** ([repo](https://github.com/qodo-ai/pr-agent), [reviewer prompt TOML](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/pr_reviewer_prompts.toml)) | Ships its prompts. Structured output (`relevant_file`, `issue_header`, `issue_content`, `start_line/end_line`, `security_concerns`, `estimated_effort_1-5`). **Anti-noise clauses worth lifting verbatim:** "only on issues introduced by this PR"; "be **certain** before flagging" lower-severity; "don't claim a break unless you can identify the **specific affected code path**"; "**prefer not reporting over guessing**". A separate reflection pass scores 0–10 and filters below a threshold (the real noise gate). |
| **CodeRabbit** ([config](https://docs.coderabbit.ai/reference/configuration)) | Noise dial = `profile: chill\|assertive`. Scoping via `path_filters` / `path_instructions`. `request_changes_workflow` as the gating primitive. |
| **Greptile** ([best practices](https://www.greptile.com/docs/code-review-bot/best-practices)) | Severity threshold low/medium/high (start high to build trust). Disable comment *types* (syntax/logic/style) independently. Confidence scores for triage. |
| **Sourcery** ([overview](https://docs.sourcery.ai/Code-Review/Overview/)) | Specialized reviewers per aspect (quality/security/complexity/docs/testing) + a post-generation validation pass to cut false positives. |
| **Korbit** ([issues](https://docs.korbit.ai/pull-request-experience/issues), [precision](https://www.korbit.ai/post/why-precision-matters-most-in-ai-code-review-tools-2)) | Core-six taxonomy: Functionality, Security, Performance, Readability/Maintainability, Design, Error Handling. Chill/Assertive modes; auto-mutes duplicate warnings. |
| **reviewdog** ([repo](https://github.com/reviewdog/reviewdog)) | `-filter-mode=added` scopes diagnostics to changed lines; `-fail-level` is the severity→exit-code gate. Exactly thermo-review's PASS/BLOCK→exit-3 mapping. |
| **Danger JS** ([danger.systems/js](https://danger.systems/js/)) | `fail()` (blocks) vs `warn()` (advisory) — the canonical two-tier gate. Maps cleanly onto Conventional Comments' (blocking)/(non-blocking). |
| **Anthropic claude-code-action** ([solutions](https://github.com/anthropics/claude-code-action/blob/main/docs/solutions.md)), **claude-code-security-review** ([repo](https://github.com/anthropics/claude-code-security-review)) | 4-bucket rubric (quality / bugs / security / performance); path-scoped focus. The security reviewer's **false-positive exclusion list** (auto-excludes DoS, rate-limiting, resource-exhaustion, "generic validation without proven impact") is a model for never blocking on speculative/low-impact classes. |

## 3. Multi-model / ensemble / LLM-as-judge — the amalgamation core

The hard part of "model B reviews using model A's point of view" is **not** the wiring; it's
stopping B from rubber-stamping A. That is a **sycophancy + anchoring** problem, and the
literature is consistent about the countermeasures.

| Source | What it tells us |
|--------|------------------|
| **Sycophancy** — Sharma et al. 2023 ([arXiv:2310.13548](https://arxiv.org/abs/2310.13548)) | Models alter feedback to match a stated view and reverse a correct answer when challenged. A confident upstream verdict acts like a high-status "user belief." → **Withhold A's verdict; make B reason independently first.** |
| **LLM-as-a-Judge** — Zheng et al. 2023 ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)) | Names the biases: position, verbosity, **self-enhancement** (a model favors answers like its own). Mitigations: position-swap-and-require-consistency, CoT, and **reference-guided** judging (judge forms its own answer *before* seeing the other's). |
| **Panel of LLM evaluators (PoLL)** — Verga et al. 2024 ([arXiv:2404.18796](https://arxiv.org/abs/2404.18796)) | A panel of **diverse model families** beats a single judge on bias and cost; self-preference is largest when a model judges itself. → use **two different families** (Claude + GPT). |
| **Multi-Agent Debate** — Du et al. 2023 ([arXiv:2305.14325](https://arxiv.org/abs/2305.14325)); **ChatEval** ([arXiv:2308.07201](https://arxiv.org/abs/2308.07201)) | Show peer findings as *advice, not authority*; diverse roles are necessary or agents just agree. |
| **Self-Refine** ([arXiv:2303.17651](https://arxiv.org/abs/2303.17651)), **Reflexion** ([arXiv:2303.11366](https://arxiv.org/abs/2303.11366)), **Constitutional AI** ([arXiv:2212.08073](https://arxiv.org/abs/2212.08073)) | Generate → **specific, actionable** critique → refine. Critique against an explicit rubric, not "is this good?". Using a *different* model for the critic beats self-critique. |
| **Self-Consistency** ([arXiv:2203.11171](https://arxiv.org/abs/2203.11171)) | Sample multiple paths, keep what recurs → tier findings by agreement. |
| Engineering write-ups: **Mozilla.ai "Star Chamber"** ([blog](https://blog.mozilla.ai/the-star-chamber-multi-llm-consensus-for-code-quality/)), eugeneyan **"Evaluating LLM-Evaluators"** ([essay](https://eugeneyan.com/writing/llm-evaluators/)) | Production-shaped: structured JSON findings grouped by location+category; **Chatham-House** anonymized debate (strip attribution to kill anchoring); diverse ensembles over single-model; measured self-preference (gpt-4 +10%, claude-v1 +25% self-win-rate). |

### The anti-rubber-stamping recipe (what thermo-review's `panel` implements)

1. **Two different model families**, adversarially combined — never same-family consensus.
2. **Withhold the first reviewer's PASS/BLOCK verdict** — pass only its evidence/findings.
3. **Independent-first**: the second model gathers its own evidence and forms its own findings
   before reading the peer's.
4. **Adversarial, per-item adjudication**: CONFIRM / REFUTE / REFINE, each tied to a concrete
   failure scenario; explicit license to call false positives; "what did they miss?".
5. **Neutral attribution** — "an independent first-pass reviewer", never "the stronger model".
6. **Resolve disagreement on the evidence** (stricter, evidence-backed position wins; drop
   findings neither can tie to a code path) and **record the resolution in the ledger** so the
   next round doesn't relitigate it.

---

## 4. How thermo-review maps to the above

| Idea | Where in the code |
|------|-------------------|
| Explicit approval bar + binary verdict + "no text before the verdict lines" | `src/review/prompt.ts`, `src/review/parse-verdict.ts` |
| Diff-scoped review; lock/generated files excluded | `src/git/push-scope.ts` (`REVIEW_DIFF_EXCLUDES`) |
| Severity→exit-code gate (BLOCK → exit 3), fail-closed on a missing verdict | `src/review/run.ts`, `parse-verdict.ts` |
| Convergent feedback / standing decisions + reversals (Reflexion-style memory) | `src/review/tnuk-ledger.ts` |
| **Two-model amalgamation (Claude → ChatGPT adjudication)** | `src/review/backends/panel.ts` |
| **Anti-rubber-stamping prompt** (withhold verdict, independent-first, CONFIRM/REFUTE/REFINE, neutral attribution, injection guard) | `src/review/amalgamate.ts` |
| Claude-as-reviewer via the local CLI, read-only tools | `src/review/backends/claude.ts` |
| **Confidence/precision discipline on every review** (be certain before flagging; tie blockers to a concrete failure/code path; ignore lint/style; scope-only) | `src/review/prompt.ts` (`findingsDisciplineSection`) |

## 5. Further structure available to adopt (not yet wired in)

These are high-value additions for a future pass — captured here so they aren't lost.

> **Already applied:** the qodo confidence clauses + Code-Review-Pyramid "ignore lint/style" now
> condition every review via `findingsDisciplineSection` in `src/review/prompt.ts`.

- **Conventional-Comments labels + (blocking)/(non-blocking) decoration** on every finding, so
  the verdict *derives* from whether any `(blocking)` issue survives, instead of being a
  separate judgment.
- **A false-positive exclusion list** (à la claude-code-security-review): never BLOCK on
  speculative DoS / rate-limiting / generic-validation classes.
- **Structured (`--json-schema`) output** from the Claude leg for machine-checkable findings
  (Claude Code [structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)).
- **`claude ultrareview`** ([docs](https://code.claude.com/docs/en/ultrareview)) as an opt-in deep
  leg with independently-reproduced findings for the panel to adjudicate against (too slow for an
  inline pre-push hook; good for an on-demand pass).

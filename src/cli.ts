#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { Command } from "commander";

import { shouldSkipReview } from "./config.js";
import { scopeForManualReview, scopeForPrePush } from "./git/push-scope.js";
import { chainLocalHook, installHook, uninstallHook } from "./hook/install.js";
import { runReview } from "./review/run.js";
import type { ProviderId } from "./types.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  return readFileSync(0, "utf8");
}

const PROVIDER_VALUES: readonly ProviderId[] = ["cursor", "openai", "claude", "panel"];

function parseProvider(value: string | undefined): ProviderId | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((PROVIDER_VALUES as readonly string[]).includes(value)) {
    return value as ProviderId;
  }
  process.stderr.write(`Error: --provider must be one of: ${PROVIDER_VALUES.join(", ")}\n`);
  process.exit(1);
}

const program = new Command();

program
  .name("thermo-review")
  .description(
    "Thermo-nuclear code quality review (pre-push gate) via OpenAI, Claude, Cursor, or a multi-model panel",
  )
  .version("0.1.0");

program
  .command("review")
  .description("Run thermo-nuclear review on current branch changes")
  .option("--base <ref>", "Base branch ref (default: auto-detect main/master)")
  .option("--provider <name>", "Review backend: openai (default), claude, cursor, or panel")
  .option("--json", "Output machine-readable JSON")
  .option("--quiet", "Print only verdict line")
  .option("--skip", "Skip review (exit 0)")
  .action(
    async (opts: {
      base?: string;
      provider?: string;
      json?: boolean;
      quiet?: boolean;
      skip?: boolean;
    }) => {
      if (shouldSkipReview(Boolean(opts.skip))) {
        process.exit(0);
      }

      const provider = parseProvider(opts.provider);
      const scope = scopeForManualReview(process.cwd(), opts.base);
      const { exitCode } = await runReview(scope, {
        json: Boolean(opts.json),
        quiet: Boolean(opts.quiet),
        ...(provider ? { provider } : {}),
      });
      process.exit(exitCode);
    },
  );

program
  .command("login")
  .description("Sign in with ChatGPT for default OpenAI auth mode")
  .action(async () => {
    const { loginOpenAI } = await import("./auth/openai-oauth.js");
    try {
      const result = await loginOpenAI({
        onProgress: (message) => process.stderr.write(`[thermo-review] ${message}\n`),
      });
      const who = result.email ? ` as ${result.email}` : "";
      const plan = result.planType ? ` (plan: ${result.planType})` : "";
      process.stdout.write(
        `Signed in${who}${plan}. ChatGPT auth is now the default for the OpenAI provider.\n`,
      );
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Remove stored OpenAI credentials")
  .action(async () => {
    const { logout } = await import("./auth/token-store.js");
    const removed = await logout();
    process.stdout.write(
      removed ? "Logged out (OpenAI credentials removed).\n" : "No OpenAI credentials to remove.\n",
    );
    process.exit(0);
  });

const hookCmd = program.command("hook").description("Manage pre-push git hook");

hookCmd
  .command("install")
  .description("Install user-level git template pre-push hook")
  .option(
    "--global-hooks-path",
    "Set git config core.hooksPath globally (applies to all existing repos)",
  )
  .action((opts: { globalHooksPath?: boolean }) => {
    installHook(Boolean(opts.globalHooksPath));
  });

hookCmd
  .command("uninstall")
  .description("Remove thermo-review hook and git template config")
  .action(() => {
    uninstallHook();
  });

hookCmd
  .command("run")
  .description("Run review from pre-push hook context (internal)")
  .option("--base <ref>", "Base branch ref override")
  .option("--provider <name>", "Review backend: openai (default), claude, cursor, or panel")
  .action(async (opts: { base?: string; provider?: string }) => {
    if (shouldSkipReview(false)) {
      process.exit(0);
    }

    const provider = parseProvider(opts.provider);
    const stdin = await readStdin();
    const scope = scopeForPrePush(process.cwd(), stdin, opts.base);
    const { exitCode } = await runReview(scope, {
      json: false,
      quiet: false,
      failClosed: true,
      lifecycle: "push",
      ...(provider ? { provider } : {}),
    });

    if (exitCode !== 0) {
      process.exit(exitCode);
    }

    const chainCode = chainLocalHook(scope.repoRoot);
    process.exit(chainCode);
  });

program.addHelpText(
  "after",
  `
Examples:
  thermo-review review
  thermo-review review --provider claude     # review via the local claude -p CLI
  thermo-review review --provider panel      # Claude reviews, ChatGPT adjudicates (amalgamated)
  thermo-review login                       # Sign in with ChatGPT (default OpenAI auth mode)
  THERMO_REVIEW_PROVIDER=panel git push
  THERMO_REVIEW_SKIP=1 git push

Environment:
  THERMO_REVIEW_PROVIDER       openai (default) | claude | cursor | panel
  OPENAI_API_KEY               Official OpenAI API key (only with THERMO_REVIEW_OPENAI_AUTH=api)
  THERMO_REVIEW_OPENAI_AUTH    chatgpt (default OAuth transport) | api (official API)
  CURSOR_API_KEY               Cursor API key (required for --provider cursor)
  THERMO_REVIEW_OPENAI_MODEL   Override the OpenAI model (default: gpt-5.5)
  THERMO_REVIEW_CLAUDE_MODEL   Override the Claude CLI model (default: opus)
  THERMO_REVIEW_SKILL_PATH     Path to a thermo-nuclear SKILL.md override
  THERMO_REVIEW_SKIP=1         Skip review, allow push
  THERMO_REVIEW_NO_TNUK=1      Disable the per-branch tnuk decisions ledger

Providers:
  openai   ChatGPT/Codex (or official API) tool loop with sandboxed git/file tools
  claude   local 'claude -p' agent with read-only repo tools
  cursor   local Cursor SDK agent
  panel    amalgamation: Claude reviews first, ChatGPT independently adjudicates
           its findings into one verdict (set THERMO_REVIEW_PANEL_* to tune)
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});

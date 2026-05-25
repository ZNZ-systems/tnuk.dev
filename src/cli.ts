#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { Command } from "commander";

import { login, logout, whoami } from "./auth/device.js";
import { shouldSkipReview } from "./config.js";
import { scopeForManualReview, scopeForPrePush } from "./git/push-scope.js";
import { chainLocalHook, installHook, uninstallHook } from "./hook/install.js";
import { runReview } from "./review/run.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  return readFileSync(0, "utf8");
}

const program = new Command();

program
  .name("tnuk")
  .description("Thermo-nuclear team code review — pre-push quality gate (bundled Cursor SDK)")
  .version("0.1.0");

program
  .command("login")
  .description("Authenticate this machine to your tnuk seat")
  .action(async () => {
    process.exit(await login());
  });

program
  .command("logout")
  .description("Remove the stored tnuk seat token")
  .action(() => {
    process.exit(logout());
  });

program
  .command("whoami")
  .description("Show the current account and seat status")
  .action(async () => {
    process.exit(await whoami());
  });

program
  .command("review")
  .description("Run thermo-nuclear review on current branch changes")
  .option("--base <ref>", "Base branch ref (default: auto-detect main/master)")
  .option("--json", "Output machine-readable JSON")
  .option("--quiet", "Print only verdict line")
  .option("--skip", "Skip review (exit 0)")
  .action(async (opts: { base?: string; json?: boolean; quiet?: boolean; skip?: boolean }) => {
    if (shouldSkipReview(Boolean(opts.skip))) {
      process.exit(0);
    }

    const scope = scopeForManualReview(process.cwd(), opts.base);
    const { exitCode } = await runReview(scope, {
      json: Boolean(opts.json),
      quiet: Boolean(opts.quiet),
    });
    process.exit(exitCode);
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
  .action(async (opts: { base?: string }) => {
    if (shouldSkipReview(false)) {
      process.exit(0);
    }

    const stdin = await readStdin();
    const scope = scopeForPrePush(process.cwd(), stdin, opts.base);
    const { exitCode } = await runReview(scope, {
      json: false,
      quiet: false,
      failClosed: true,
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
  tnuk login
  tnuk review
  tnuk review --base main --json
  tnuk hook install --global-hooks-path
  TNUK_SKIP=1 git push

Environment:
  TNUK_TOKEN              Override the stored seat token (CI use)
  TNUK_API_BASE_URL       Override the tnuk Worker URL
  CURSOR_API_KEY          Direct Cursor API key (local dev, bypasses tnuk seat)
  THERMO_REVIEW_SKILL_PATH  Override bundled review skill markdown
  TNUK_SKIP=1             Skip review, allow push
  THERMO_REVIEW_SKIP=1    Same as TNUK_SKIP (legacy)
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});

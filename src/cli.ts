#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { Command } from "commander";

import { clearAuthToken } from "./auth/token.js";
import { fetchWhoami, runLogin } from "./auth/login.js";
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
  .description("Pre-push thermo-nuclear code quality review (tnuk.dev)")
  .version("0.2.0");

program
  .command("login")
  .description("Sign in to tnuk (opens browser or device code in SSH)")
  .option("--device", "Force device-code login flow")
  .action(async (opts: { device?: boolean }) => {
    await runLogin(Boolean(opts.device));
  });

program
  .command("logout")
  .description("Sign out and remove local credentials")
  .action(() => {
    clearAuthToken();
    process.stdout.write("Signed out of tnuk.\n");
  });

program
  .command("whoami")
  .description("Show signed-in account and subscription status")
  .action(async () => {
    const info = await fetchWhoami();
    if (!info) {
      process.stderr.write('tnuk: not signed in. Run "tnuk login"\n');
      process.exit(1);
    }
    if (info.email) {
      process.stdout.write(`${info.email}\n`);
    }
    if (info.plan) {
      process.stdout.write(`plan: ${info.plan}\n`);
    }
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
  .description("Remove tnuk hook and git template config")
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
  TNUK_SKIP=1             Skip review, allow push
  TNUK_API_URL            Override API base (default: https://tnuk.dev)
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});

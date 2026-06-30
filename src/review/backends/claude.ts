import { spawn } from "node:child_process";

import { claudeModel, claudeTimeoutMs } from "../../config.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ReviewBackend,
} from "../backend.js";

/** Binary to invoke; overridable for hook contexts where `claude` isn't on PATH. */
const CLAUDE_BIN = process.env["THERMO_REVIEW_CLAUDE_BIN"]?.trim() || "claude";

/** Cap agentic turns so a stuck tool loop can't run forever (timeout is the other guard). */
const MAX_TURNS = 60;

/**
 * Read-only repo tools the reviewer may use without a permission prompt. In `-p`
 * mode any tool NOT on this list is auto-denied (never prompts, never hangs), so
 * this list also makes the reviewer read-only by construction — it can inspect the
 * diff, history, and files but cannot mutate the repo. Permission-rule syntax is
 * Claude Code's own (`Bash(<prefix>:*)`).
 */
const READ_ONLY_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git rev-parse:*)",
  "Bash(git cat-file:*)",
  "Bash(git ls-files:*)",
  "Bash(git ls-tree:*)",
  "Bash(git blame:*)",
  "Bash(git diff-tree:*)",
] as const;

const MISSING_CLI_MESSAGE =
  `Claude CLI (${CLAUDE_BIN}) not found on PATH.\n` +
  "  Install Claude Code: https://docs.claude.com/en/docs/claude-code/overview\n" +
  "  then sign in (`claude` once, or `claude setup-token` for hooks/CI),\n" +
  "  or point THERMO_REVIEW_CLAUDE_BIN at its absolute path.";

function snippet(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  // Slice by code point so truncation can't split a surrogate pair.
  return `${[...collapsed].slice(0, max - 1).join("")}…`;
}

export interface ClaudeCliResult {
  /** The model's final answer (the review). Empty when the run did not succeed. */
  text: string;
  /** `session_id` for traceability; undefined if absent. */
  sessionId: string | undefined;
  /** Human-readable failure reason, or undefined on success. */
  error: string | undefined;
}

/**
 * Parses the JSON envelope from `claude -p --output-format json`. Pure and total:
 * never throws, and returns an `error` for any non-success shape so the backend
 * fails closed instead of emitting a verdict from a degraded/aborted run.
 */
export function parseClaudeCliResult(stdout: string): ClaudeCliResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { text: "", sessionId: undefined, error: "claude -p produced no output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text: "", sessionId: undefined, error: `claude -p did not return JSON (${snippet(trimmed)})` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { text: "", sessionId: undefined, error: "claude -p returned a non-object JSON payload" };
  }

  const obj = parsed as Record<string, unknown>;
  const sessionId = typeof obj["session_id"] === "string" ? obj["session_id"] : undefined;
  const result = typeof obj["result"] === "string" ? obj["result"] : "";
  const subtype = typeof obj["subtype"] === "string" ? obj["subtype"] : undefined;

  if (obj["is_error"] === true || (subtype !== undefined && subtype !== "success")) {
    const detail = result.trim() || subtype || "unknown error";
    return { text: "", sessionId, error: `claude -p did not succeed (${subtype ?? "error"}): ${snippet(detail)}` };
  }
  if (!result.trim()) {
    return { text: "", sessionId, error: "claude -p returned success with an empty result" };
  }
  return { text: result, sessionId, error: undefined };
}

interface ClaudeCliRun {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError: NodeJS.ErrnoException | undefined;
}

/**
 * Spawns the Claude CLI, delivers the (large) review prompt over stdin to dodge
 * argv length/quoting limits, and resolves with the captured output. Never
 * rejects — a spawn failure or timeout is reported via the resolved fields so the
 * caller maps it to the right exit code.
 */
function runClaudeCli(
  args: string[],
  promptStdin: string,
  cwd: string,
  timeoutMs: number,
): Promise<ClaudeCliRun> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (run: Omit<ClaudeCliRun, "timedOut"> & { timedOut?: boolean }): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut, ...run });
    };

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish({ stdout, stderr, code: null, spawnError: err });
    });
    child.on("close", (code) => {
      finish({ stdout, stderr, code, spawnError: undefined });
    });

    // Swallow EPIPE if the child exits before the prompt is fully written.
    child.stdin.on("error", () => {});
    child.stdin.end(promptStdin);
  });
}

/** Auth/setup failures are config errors (exit 1); everything else is an agent error (exit 2). */
function classifyFailure(run: ClaudeCliRun, error: string): "config" | "agent" {
  const haystack = `${error} ${run.stderr}`.toLowerCase();
  if (/not logged in|log ?in|authenticat|unauthor|invalid api key|credit balance|setup-token/.test(haystack)) {
    return "config";
  }
  return "agent";
}

function mirrorReview(rawText: string): void {
  if (!rawText.trim()) {
    return;
  }
  process.stderr.write("[thermo-review] claude review:\n");
  process.stderr.write(rawText.endsWith("\n") ? rawText : `${rawText}\n`);
}

/**
 * Claude backend: runs the review through the local `claude -p` CLI, which has
 * built-in file/git tools restricted here to a read-only allowlist and scoped to
 * the repo root via the child's cwd. Mirrors the Cursor backend's "local agent"
 * shape, but talks to the Claude Code CLI over stdin/JSON instead of an SDK.
 */
export class ClaudeBackend implements ReviewBackend {
  readonly id = "claude" as const;
  readonly capabilities = {
    canInspectRepository: true,
    inspection: "local-agent",
    tools: READ_ONLY_TOOLS,
  } as const;

  async preflight(): Promise<void> {
    const probe = await runClaudeCli(["--version"], "", process.cwd(), 15_000);
    if (probe.spawnError?.code === "ENOENT") {
      throw new BackendError(MISSING_CLI_MESSAGE, "config");
    }
    if (probe.timedOut || probe.code !== 0) {
      throw new BackendError(
        `Claude CLI did not respond to --version (exit ${String(probe.code)}). ` +
          "Ensure Claude Code is installed and on PATH, or set THERMO_REVIEW_CLAUDE_BIN.",
        "config",
      );
    }
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    const model = claudeModel();
    const timeoutMs = claudeTimeoutMs();
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
      "--max-turns",
      String(MAX_TURNS),
      // Variadic; keep LAST so it consumes every tool spec and nothing else.
      "--allowedTools",
      ...READ_ONLY_TOOLS,
    ];

    onProgress(`contacting Claude via claude -p (model=${model}, read-only repo tools)…`);

    const run = await runClaudeCli(args, prompt, scope.repoRoot, timeoutMs);

    if (run.spawnError?.code === "ENOENT") {
      throw new BackendError(MISSING_CLI_MESSAGE, "config");
    }
    if (run.spawnError) {
      throw new BackendError(`Failed to launch claude CLI: ${run.spawnError.message}`, "config");
    }
    if (run.timedOut) {
      throw new BackendError(
        `Claude review timed out after ${Math.round(timeoutMs / 1000)}s with no completion. ` +
          "Try a smaller diff (--base <ref>), a faster THERMO_REVIEW_CLAUDE_MODEL, or raise THERMO_REVIEW_CLAUDE_TIMEOUT_MS.",
        "agent",
      );
    }

    const parsed = parseClaudeCliResult(run.stdout);
    if (parsed.error) {
      throw new BackendError(parsed.error, classifyFailure(run, parsed.error));
    }

    mirrorReview(parsed.text);
    return { rawText: parsed.text, runId: parsed.sessionId, agentId: undefined };
  }
}

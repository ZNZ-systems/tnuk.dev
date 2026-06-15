import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import type { ProgressFn } from "./backend.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 200_000;
const DEFAULT_READ_BYTES = 64_000;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

// Conservative shape guard for git revisions. Not a security boundary on its own
// (execFile takes no shell), just a guard against obviously bogus refs.
const REVISION = z.string().regex(/^[A-Za-z0-9._/~^-]{1,200}$/, "invalid git revision");

/**
 * Resolves symlinks for the longest existing prefix of `p`, re-appending any
 * not-yet-existing tail. Lets us enforce the repo boundary against the real
 * filesystem target, not just the lexical path.
 */
function realpathSafe(p: string): string {
  let current = p;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length > 0 ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      const parent = dirname(current);
      if (parent === current) {
        return resolve(p); // nothing along the path exists
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `candidate` against `repoRoot` and asserts the real (symlink-resolved)
 * target stays inside the real repo root. Rejects absolute escapes, `..`
 * traversal, and in-repo symlinks that point outside the repository.
 */
function assertInside(repoRoot: string, candidate: string): string {
  const realRoot = realpathSafe(resolve(repoRoot));
  const realAbs = realpathSafe(resolve(repoRoot, candidate));
  const rel = relative(realRoot, realAbs);
  if (rel === "") {
    return realAbs;
  }
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes repository root: ${candidate}`);
  }
  return realAbs;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…[truncated]` : text;
}

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    return truncate(stdout) || "(no output)";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = String(e.stderr ?? e.message ?? "").slice(0, 2000);
    return `git ${args.join(" ")} failed: ${detail}`;
  }
}

/**
 * Builds the agentic review tools sandboxed to `repoRoot`: git diff/log, file
 * read, and a tracked-file listing. Mirrors how the Cursor local agent explores,
 * but with no shell and explicit path-escape guards.
 */
export function makeRepoTools(repoRoot: string, onProgress: ProgressFn): Tool[] {
  const gitDiff = tool({
    name: "git_diff",
    description:
      "Run `git diff <from>..<to>` in the repository under review. Returns the unified diff, or a --stat summary when `stat` is true.",
    parameters: z.object({
      from: REVISION.describe("Base revision or SHA."),
      to: REVISION.describe("Target revision or SHA."),
      stat: z.boolean().nullable().describe("If true, return a --stat summary instead of the full diff."),
      paths: z
        .array(z.string())
        .nullable()
        .describe("Optional pathspecs (relative to repo root) to limit the diff; pass null for the whole diff."),
    }),
    async execute({ from, to, stat, paths }) {
      onProgress(`tool: git_diff ${from}..${to}${stat ? " --stat" : ""}`);
      const safePaths = (paths ?? []).map((p) => {
        assertInside(repoRoot, p);
        return p;
      });
      const args = [
        "diff",
        `${from}..${to}`,
        ...(stat ? ["--stat"] : []),
        ...(safePaths.length > 0 ? ["--", ...safePaths] : []),
      ];
      return runGit(repoRoot, args);
    },
  });

  const gitLog = tool({
    name: "git_log",
    description: "Run `git log --oneline <from>..<to>` in the repository under review.",
    parameters: z.object({
      from: REVISION.describe("Base revision or SHA."),
      to: REVISION.describe("Target revision or SHA."),
    }),
    async execute({ from, to }) {
      onProgress(`tool: git_log ${from}..${to}`);
      return runGit(repoRoot, ["log", "--oneline", `${from}..${to}`]);
    },
  });

  const readFileTool = tool({
    name: "read_file",
    description: "Read a UTF-8 text file from the repository under review (path relative to the repo root).",
    parameters: z.object({
      path: z.string().describe("Path relative to the repo root."),
      maxBytes: z
        .number()
        .int()
        .positive()
        .max(MAX_OUTPUT)
        .nullable()
        .describe(`Maximum bytes to read (default ${DEFAULT_READ_BYTES}); pass null for the default.`),
    }),
    async execute({ path, maxBytes }) {
      onProgress(`tool: read_file ${path}`);
      const abs = assertInside(repoRoot, path);
      const limit = maxBytes ?? DEFAULT_READ_BYTES;
      try {
        const buf = await readFile(abs);
        return truncate(buf.subarray(0, limit).toString("utf8")) || "(empty file)";
      } catch (err) {
        return `read_file failed: ${(err as Error).message}`;
      }
    },
  });

  const listFiles = tool({
    name: "list_files",
    description: "List git-tracked files (optionally under a sub-path) in the repository under review.",
    parameters: z.object({
      subPath: z
        .string()
        .nullable()
        .describe("Optional sub-path (relative to repo root) to limit the listing; pass null for all files."),
    }),
    async execute({ subPath }) {
      onProgress(`tool: list_files ${subPath ?? "."}`);
      const args = ["ls-files"];
      if (subPath) {
        assertInside(repoRoot, subPath);
        args.push("--", subPath);
      }
      return runGit(repoRoot, args);
    },
  });

  return [gitDiff, gitLog, readFileTool, listFiles];
}

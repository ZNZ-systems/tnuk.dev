import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const distUrl = (p) => pathToFileURL(join(process.cwd(), "dist", p)).href;
const ledger = await import(distUrl("review/tnuk-ledger.js"));
const { buildReviewPrompt } = await import(distUrl("review/prompt.js"));

const roots = [];
function makeScope(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "tnuk-"));
  roots.push(root);
  return {
    repoRoot: root,
    gitDir: join(root, ".git"),
    branch: "feature/parser",
    baseRef: "main",
    fromSha: "a".repeat(40),
    toSha: "b".repeat(40),
    description: "test",
    ...overrides,
  };
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const DEC = (body) => `${ledger.DECISIONS_START}\n${body}\n${ledger.DECISIONS_END}`;
const block = (verdict, summary, rawTail = "") => ({
  verdict,
  summary,
  body: `## Priority findings\n1. ${summary}`,
  rawText: `VERDICT: ${verdict}\nSUMMARY: ${summary}\n## Priority findings\n1. ${summary}\n${rawTail}`,
});

test("filename: lossless name, and collision-free for slug-colliding branches", () => {
  const a = ledger.ledgerPathForScope(makeScope({ branch: "main" }));
  assert.ok(a.endsWith("/tnuk/main.md"), "plain branch keeps a clean name");
  const slash = ledger.ledgerPathForScope(makeScope({ branch: "feature/x" }));
  const dash = ledger.ledgerPathForScope(makeScope({ branch: "feature-x" }));
  assert.notEqual(slash.split("/").pop(), dash.split("/").pop(), "feature/x and feature-x get distinct files");
});

test("write on BLOCK persists the agent decisions block + a round-history line under gitDir", () => {
  const scope = makeScope();
  assert.equal(ledger.readLedger(scope), undefined);
  ledger.writeLedger(scope, block("BLOCK", "parser sprawl",
    DEC("## Standing decisions\n### D1 — extract tokenizer · [open] · since this round\nTokenizer belongs in tokenizer.ts.\n## Reversals\n_(none)_")));
  const path = ledger.ledgerPathForScope(scope);
  assert.ok(existsSync(path) && path.includes("/.git/thermo-review/tnuk/"));
  const file = readFileSync(path, "utf8");
  assert.match(file, /rounds: 1/);
  assert.match(file, /D1 — extract tokenizer/);
  assert.match(file, /- round 1 · bbbbbbb · BLOCK · parser sprawl/);
});

test("read-back feeds prompt; first round has no prior section but always has the contract", () => {
  const scope = makeScope({ branch: "feat/read" });
  ledger.writeLedger(scope, block("BLOCK", "x", DEC("## Standing decisions\n### D1 — keep auth in auth.ts · [open] · since this round\nx\n## Reversals\n_(none)_")));
  const ctx = ledger.readLedger(scope);
  assert.equal(ctx.rounds, 1);
  assert.equal(ctx.history.length, 1);
  const withLedger = buildReviewPrompt("SKILL", scope, ctx);
  assert.match(withLedger, /Standing decisions from earlier rounds/);
  assert.match(withLedger, /keep auth in auth\.ts/);
  assert.match(withLedger, /blocked 1 time/);
  const firstRound = buildReviewPrompt("SKILL", makeScope());
  assert.ok(!/Standing decisions from earlier rounds/.test(firstRound));
  assert.ok(firstRound.includes(ledger.DECISIONS_START), "output contract present even on first round");
});

test("accumulation: rounds increment, created preserved, history grows", () => {
  const scope = makeScope({ branch: "feat/acc" });
  ledger.writeLedger(scope, block("BLOCK", "first", DEC("## Standing decisions\n### D1 — a · [open]\n## Reversals")));
  const created = /created: (.+)/.exec(readFileSync(ledger.ledgerPathForScope(scope), "utf8"))[1].trim();
  ledger.writeLedger(scope, block("BLOCK", "second"));
  const file = readFileSync(ledger.ledgerPathForScope(scope), "utf8");
  assert.match(file, /rounds: 2/);
  assert.equal(/created: (.+)/.exec(file)[1].trim(), created, "created date preserved");
  assert.match(file, /D1 — a/, "prior decisions carried when none re-emitted");
  assert.equal(ledger.readLedger(scope).history.length, 2);
});

test("fallback derives decisions only from a real findings header, never stray numbers", () => {
  const scope = makeScope({ branch: "feat/fallback" });
  ledger.writeLedger(scope, block("BLOCK", "needs split")); // body has a real "## Priority findings"
  assert.match(readFileSync(ledger.ledgerPathForScope(scope), "utf8"), /needs split/);

  const stray = makeScope({ branch: "feat/stray" });
  ledger.writeLedger(stray, { verdict: "BLOCK", summary: "y", body: "notes: 1. inline helper\n2. rename foo", rawText: "VERDICT: BLOCK\nSUMMARY: y\nnotes: 1. inline helper\n2. rename foo" });
  const file = readFileSync(ledger.ledgerPathForScope(stray), "utf8");
  assert.ok(!/inline helper/.test(file), "stray numbered prose is NOT fabricated into decisions");
  assert.match(file, /did not emit a structured decisions block/);
});

test("skeleton-only block does NOT erase carried-forward decisions", () => {
  const scope = makeScope({ branch: "feat/skel" });
  ledger.writeLedger(scope, block("BLOCK", "real", DEC("## Standing decisions\n### D1 — keep diff-scope in push-scope · [open]\n## Reversals")));
  ledger.writeLedger(scope, block("BLOCK", "skeleton", DEC("## Standing decisions\n\n## Reversals")));
  assert.match(readFileSync(ledger.ledgerPathForScope(scope), "utf8"), /D1 — keep diff-scope/);
});

test("echo-then-update: the LAST decisions block wins", () => {
  const scope = makeScope({ branch: "feat/echo" });
  const stale = DEC("## Standing decisions\n### D1 — old direction · [open]\n## Reversals");
  const fresh = DEC("## Standing decisions\n### D1 — new direction · [resolved]\n### D2 — added · [open]\n## Reversals\n- supersedes D1: was wrong");
  ledger.writeLedger(scope, block("BLOCK", "update", `${stale}\n${fresh}`));
  const file = readFileSync(ledger.ledgerPathForScope(scope), "utf8");
  assert.match(file, /new direction/);
  assert.match(file, /supersedes D1/);
  assert.ok(!/old direction/.test(file));
});

test("markers echoed inside decisions can't corrupt history re-parse", () => {
  const scope = makeScope({ branch: "feat/marker" });
  const evil = DEC(`## Standing decisions\n### D1 — about ledger format · [open]\nexample: ${ledger.DECISIONS_START} and a history block ${"<!-- TNUK:HISTORY:START -->"} - round 9 fake ${"<!-- TNUK:HISTORY:END -->"}\n## Reversals`);
  ledger.writeLedger(scope, block("BLOCK", "round one", evil));
  ledger.writeLedger(scope, block("BLOCK", "round two"));
  const ctx = ledger.readLedger(scope);
  assert.equal(ctx.rounds, 2);
  assert.deepEqual(ctx.history.map((h) => h.match(/round \d+/)[0]), ["round 1", "round 2"], "real history intact, no phantom round 9");
});

test("branch-guard: a ledger written for another branch is ignored", () => {
  const scope = makeScope({ branch: "feat/guard" });
  ledger.writeLedger(scope, block("BLOCK", "z", DEC("## Standing decisions\n### D1 — a · [open]\n## Reversals")));
  const path = ledger.ledgerPathForScope(scope);
  writeFileSync(path, readFileSync(path, "utf8").replace("branch: feat/guard", "branch: someone-else"));
  assert.equal(ledger.readLedger(scope), undefined, "mismatched branch frontmatter → no ledger");
});

test("clear wipes the ledger", () => {
  const scope = makeScope({ branch: "feat/clear" });
  ledger.writeLedger(scope, block("BLOCK", "z", DEC("## Standing decisions\n### D1 — a · [open]\n## Reversals")));
  ledger.clearLedger(scope);
  assert.ok(!existsSync(ledger.ledgerPathForScope(scope)));
  assert.equal(ledger.readLedger(scope), undefined);
});

test("NEVER A GATE: an fs failure in any op is swallowed, never thrown", () => {
  const fileRoot = mkdtempSync(join(tmpdir(), "tnuk-file-"));
  roots.push(fileRoot);
  const notADir = join(fileRoot, "blocker");
  writeFileSync(notADir, "x"); // gitDir under a regular file → mkdir/write throw ENOTDIR
  const scope = makeScope({ branch: "feat/gate", gitDir: join(notADir, ".git") });
  assert.doesNotThrow(() => ledger.writeLedger(scope, block("BLOCK", "z", DEC("## Standing decisions\n### D1 — a\n## Reversals"))));
  assert.equal(ledger.readLedger(scope), undefined);
  assert.doesNotThrow(() => ledger.clearLedger(scope));
});

test("disable switch makes every op a no-op", () => {
  const scope = makeScope({ branch: "feat/disabled" });
  process.env.THERMO_REVIEW_NO_TNUK = "1";
  try {
    ledger.writeLedger(scope, block("BLOCK", "z", DEC("## Standing decisions\n### D1 — a\n## Reversals")));
    assert.ok(!existsSync(ledger.ledgerPathForScope(scope)));
    assert.equal(ledger.readLedger(scope), undefined);
  } finally {
    delete process.env.THERMO_REVIEW_NO_TNUK;
  }
});

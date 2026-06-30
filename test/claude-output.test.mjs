import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const distUrl = (p) => pathToFileURL(join(process.cwd(), "dist", p)).href;
const { parseClaudeCliResult } = await import(distUrl("review/backends/claude.js"));

test("parses a successful claude -p JSON envelope into the result text + session id", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "VERDICT: PASS\nSUMMARY: looks good\n## Priority findings\n",
    session_id: "abc-123",
  });
  const out = parseClaudeCliResult(stdout);
  assert.equal(out.error, undefined);
  assert.equal(out.sessionId, "abc-123");
  assert.match(out.text, /VERDICT: PASS/);
});

test("treats an error subtype (e.g. max turns) as a failure, never a verdict", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    result: "",
    session_id: "s1",
  });
  const out = parseClaudeCliResult(stdout);
  assert.ok(out.error, "error is reported");
  assert.match(out.error, /error_max_turns/);
  assert.equal(out.text, "");
});

test("treats is_error:true as a failure even when the envelope says success", () => {
  const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "partial output" });
  const out = parseClaudeCliResult(stdout);
  assert.ok(out.error, "is_error overrides a success envelope");
  assert.equal(out.text, "");
});

test("treats a success envelope with empty result as a failure (fail closed)", () => {
  const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "   " });
  const out = parseClaudeCliResult(stdout);
  assert.ok(out.error, "empty result is not a usable review");
});

test("a payload missing the explicit type:result/subtype:success envelope fails closed", () => {
  // A non-empty result without the explicit success envelope (malformed or future CLI
  // shape) must never slip through as review text.
  assert.ok(parseClaudeCliResult(JSON.stringify({ result: "VERDICT: PASS\nlooks fine" })).error, "no type/subtype");
  assert.ok(parseClaudeCliResult(JSON.stringify({ type: "result", result: "VERDICT: PASS" })).error, "missing subtype");
  assert.ok(parseClaudeCliResult(JSON.stringify({ subtype: "success", result: "VERDICT: PASS" })).error, "missing type");
});

test("non-JSON stdout (e.g. a CLI crash banner) is a failure, not parsed as a review", () => {
  const out = parseClaudeCliResult("error: something exploded before any JSON");
  assert.ok(out.error);
  assert.equal(out.text, "");
});

test("empty stdout is a failure", () => {
  const out = parseClaudeCliResult("   \n  ");
  assert.ok(out.error);
});

test("a non-object JSON payload is a failure", () => {
  const out = parseClaudeCliResult("42");
  assert.ok(out.error);
});

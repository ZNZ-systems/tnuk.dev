import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldSkipReview } from "./config.js";

describe("shouldSkipReview", () => {
  it("respects explicit skip", () => {
    assert.equal(shouldSkipReview(true), true);
    assert.equal(shouldSkipReview(false), false);
  });

  it("respects TNUK_SKIP env", () => {
    const prev = process.env["TNUK_SKIP"];
    process.env["TNUK_SKIP"] = "1";
    assert.equal(shouldSkipReview(false), true);
    if (prev === undefined) {
      delete process.env["TNUK_SKIP"];
    } else {
      process.env["TNUK_SKIP"] = prev;
    }
  });
});

describe("loadSkillContent", () => {
  it("loads bundled skill", async () => {
    const { loadSkillContent } = await import("./config.js");
    const content = loadSkillContent();
    assert.ok(content.includes("Thermo-Nuclear Code Quality Review"));
  });
});

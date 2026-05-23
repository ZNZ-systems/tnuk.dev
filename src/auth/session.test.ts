import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { sessionFailureExit, type SessionFailure } from "./session.js";
import { writeAuthToken, clearAuthToken, readAuthToken } from "./token.js";

describe("sessionFailureExit", () => {
  it("returns exit 1 for not_signed_in", () => {
    const code = sessionFailureExit({ ok: false, code: "not_signed_in" });
    assert.equal(code, 1);
  });

  it("returns exit 0 for service_unavailable", () => {
    const code = sessionFailureExit({ ok: false, code: "service_unavailable" });
    assert.equal(code, 0);
  });

  it("returns exit 1 for subscription_inactive", () => {
    const code = sessionFailureExit({
      ok: false,
      code: "subscription_inactive",
      billingUrl: "https://tnuk.dev/billing",
    });
    assert.equal(code, 1);
  });
});

describe("exchangeAuthToken", () => {
  const originalFetch = globalThis.fetch;

  before(() => {
    writeAuthToken({
      token: "test-jwt",
      issuedAt: new Date().toISOString(),
    });
  });

  after(() => {
    clearAuthToken();
    globalThis.fetch = originalFetch;
  });

  it("returns not_signed_in when no token file", async () => {
    clearAuthToken();
    const { exchangeAuthToken } = await import("./session.js");
    const result = await exchangeAuthToken();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "not_signed_in");
    }
  });

  it("returns session on 200", async () => {
    writeAuthToken({ token: "test-jwt", issuedAt: new Date().toISOString() });
    globalThis.fetch = mock.fn(async () =>
      Response.json({ cursorApiKey: "cursor_test", expiresAt: 9999999999 }),
    ) as typeof fetch;

    const { exchangeAuthToken } = await import("./session.js");
    const result = await exchangeAuthToken();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.cursorApiKey, "cursor_test");
    }
  });

  it("returns service_unavailable on network error", async () => {
    writeAuthToken({ token: "test-jwt", issuedAt: new Date().toISOString() });
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const { exchangeAuthToken } = await import("./session.js");
    const result = await exchangeAuthToken();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "service_unavailable");
    }
  });

  it("returns session_expired on 401", async () => {
    writeAuthToken({ token: "test-jwt", issuedAt: new Date().toISOString() });
    globalThis.fetch = mock.fn(async () =>
      Response.json({ error: "session_expired" }, { status: 401 }),
    ) as typeof fetch;

    const { exchangeAuthToken } = await import("./session.js");
    const result = await exchangeAuthToken();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "session_expired");
    }
  });
});

describe("readAuthToken", () => {
  after(() => {
    clearAuthToken();
  });

  it("round-trips token file", () => {
    writeAuthToken({
      token: "abc",
      issuedAt: "2026-01-01T00:00:00.000Z",
      email: "a@b.c",
    });
    const read = readAuthToken();
    assert.ok(read);
    assert.equal(read?.token, "abc");
    assert.equal(read?.email, "a@b.c");
  });
});

describe("SessionFailure exhaustiveness", () => {
  it("covers all failure codes", () => {
    const cases: SessionFailure[] = [
      { ok: false, code: "not_signed_in" },
      { ok: false, code: "session_expired" },
      { ok: false, code: "subscription_inactive" },
      { ok: false, code: "service_unavailable" },
    ];
    for (const c of cases) {
      assert.ok(typeof sessionFailureExit(c) === "number");
    }
  });
});

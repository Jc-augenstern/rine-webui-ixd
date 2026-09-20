import assert from "node:assert/strict";
import { test } from "node:test";
import { demoAuthService } from "../src/auth/auth-service.ts";

// Public development credentials are part of the requested demo contract.
// Keep these independent of the implementation config so accidental changes fail.
const valid = { account: "ixd-demo", password: "ixd2026" };
const denied = { ok: false, code: "INVALID_IDENTITY" };

test("IXD development authentication contract", { concurrency: true }, async (t) => {
  await Promise.all([
    t.test("the fixed account succeeds and exposes only a demo identity", async () => {
      const result = await demoAuthService.authenticate({ ...valid });
      assert.equal(result.ok, true);
      assert.equal(result.identity.id, "ixd-demo");
      assert.equal(result.identity.kind, "frontend-demo");
      assert.equal(typeof result.identity.displayName, "string");
      assert.ok(result.identity.displayName.length > 0);
      assert.equal("token" in result, false);
      assert.equal("password" in result.identity, false);
      assert.equal(JSON.stringify(result).includes(valid.password), false);
    }),
    t.test("an unknown account cannot use the correct password", async () => {
      assert.deepEqual(await demoAuthService.authenticate({ account: "unknown", password: valid.password }), denied);
    }),
    t.test("a wrong password is rejected", async () => {
      assert.deepEqual(await demoAuthService.authenticate({ account: valid.account, password: "wrong" }), denied);
    }),
    t.test("password whitespace and case remain significant", async () => {
      const passwords = [" ixd2026", "ixd2026 ", "\tixd2026\n", "IXD2026"];
      const results = await Promise.all(passwords.map(password => demoAuthService.authenticate({ account: valid.account, password })));
      for (const result of results) assert.deepEqual(result, denied);
    }),
    t.test("empty and whitespace-only credentials are rejected", async () => {
      const cases = [
        { account: "", password: "" },
        { account: "", password: valid.password },
        { account: "   ", password: valid.password },
        { account: valid.account, password: "" },
        { account: valid.account, password: "   " },
      ];
      const results = await Promise.all(cases.map(credentials => demoAuthService.authenticate(credentials)));
      for (const result of results) assert.deepEqual(result, denied);
    }),
    t.test("an already cancelled request rejects with AbortError", async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(demoAuthService.authenticate({ ...valid }, controller.signal), { name: "AbortError" });
    }),
    t.test("cancelling an in-flight request never returns a successful identity", async () => {
      const controller = new AbortController();
      const pending = demoAuthService.authenticate({ ...valid }, controller.signal);
      const rejection = assert.rejects(pending, { name: "AbortError" });
      await new Promise(resolve => setImmediate(resolve));
      controller.abort();
      await rejection;
    }),
    t.test("a prior success does not turn a later invalid attempt into a session", async () => {
      assert.equal((await demoAuthService.authenticate({ ...valid })).ok, true);
      assert.deepEqual(await demoAuthService.authenticate({ account: valid.account, password: "" }), denied);
    }),
  ]);
});

test("demo authentication does not read or write browser storage, cookies, or network", async () => {
  const descriptors = new Map();
  const unexpected = name => { throw new Error(`Demo authentication accessed ${name}`); };
  const cookieSurface = Object.defineProperty({}, "cookie", {
    get: () => unexpected("cookies"), set: () => unexpected("cookies"),
  });
  try {
    for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, get: () => unexpected(name) });
    }
    for (const [name, value] of [
      ["document", cookieSurface],
      ["fetch", () => unexpected("network")],
    ]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    assert.equal((await demoAuthService.authenticate({ ...valid })).ok, true);
    assert.deepEqual(await demoAuthService.authenticate({ account: "", password: "" }), denied);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

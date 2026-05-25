import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
  resetLoginFailureMemoryForTests
} from "./loginProtection.js";

function createReq(email = "user@example.com", ip = "10.0.0.1") {
  return {
    ip,
    body: { email },
    headers: {},
    get() {
      return null;
    }
  } as any;
}

test("login failure tracking locks after repeated failures and can be cleared", () => {
  resetLoginFailureMemoryForTests();
  const req = createReq();

  for (let index = 0; index < 5; index += 1) {
    recordLoginFailure(req);
  }

  const locked = isLoginLocked(req);
  assert.equal(locked.locked, true);
  assert.equal(locked.retryAfterSec > 0, true);

  clearLoginFailures(req);
  assert.equal(isLoginLocked(req).locked, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildOtpFailureUpdate } from "./routes.js";

test("buildOtpFailureUpdate locks OTP after the configured failed attempt threshold", () => {
  const expiresAt = new Date("2026-05-02T12:00:00.000Z");

  assert.deepEqual(buildOtpFailureUpdate({ attemptCount: 3, expiresAt }, 5), {
    attemptCount: { increment: 1 },
    lockedUntil: null
  });
  assert.deepEqual(buildOtpFailureUpdate({ attemptCount: 4, expiresAt }, 5), {
    attemptCount: { increment: 1 },
    lockedUntil: expiresAt
  });
});

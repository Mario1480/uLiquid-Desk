import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedOutboundIp,
  sanitizeOutboundHeaders,
  validateSafeOutboundUrl
} from "./outboundSecurity.js";

test("isBlockedOutboundIp blocks local and private address ranges", () => {
  assert.equal(isBlockedOutboundIp("127.0.0.1"), true);
  assert.equal(isBlockedOutboundIp("10.2.3.4"), true);
  assert.equal(isBlockedOutboundIp("172.16.0.1"), true);
  assert.equal(isBlockedOutboundIp("192.168.1.1"), true);
  assert.equal(isBlockedOutboundIp("169.254.169.254"), true);
  assert.equal(isBlockedOutboundIp("::1"), true);
  assert.equal(isBlockedOutboundIp("fe80::1"), true);
  assert.equal(isBlockedOutboundIp("8.8.8.8"), false);
});

test("sanitizeOutboundHeaders drops sensitive and hop-by-hop headers", () => {
  assert.deepEqual(
    sanitizeOutboundHeaders({
      Authorization: "Bearer token",
      Host: "internal",
      Cookie: "secret",
      "X-Forwarded-For": "127.0.0.1",
      "X-Custom": "ok"
    }),
    {
      authorization: "Bearer token",
      "x-custom": "ok"
    }
  );
});

test("validateSafeOutboundUrl rejects unsafe production webhook targets", async () => {
  assert.deepEqual(
    await validateSafeOutboundUrl("http://example.com/hook", { production: true }),
    { ok: false, reason: "https_required" }
  );
  assert.deepEqual(
    await validateSafeOutboundUrl("https://localhost/hook", { production: true }),
    { ok: false, reason: "local_hostname_blocked" }
  );
  assert.deepEqual(
    await validateSafeOutboundUrl("https://169.254.169.254/latest", { production: true }),
    { ok: false, reason: "private_network_blocked" }
  );
});

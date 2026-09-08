import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth } from "../auth.js";
import { registerUliqMainnetLockingRoutes } from "./mainnetLocking.routes.js";

test("Mainnet locking routes require authentication, validate payloads and sanitize internal errors", async () => {
  const routes = new Map<string, any[]>();
  const app = { get: (p: string, ...h: any[]) => routes.set(p, h), post: (p: string, ...h: any[]) => routes.set(p, h) };
  let received: any[] = [];
  const service = {
    getForUser: async () => { throw new Error("https://rpc.invalid/private-key"); },
    prepareLock: async (...args: any[]) => { received = args; return { prepared: true }; }
  };
  registerUliqMainnetLockingRoutes(app as any, service as any);
  const response = () => ({ locals: { user: { id: "linked-user" } }, code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(value: any) { this.body = value; return this; } });
  const previous = process.env.ULIQ_MAINNET_LOCKING_ENABLED;
  try {
    for (const handlers of routes.values()) {
      assert.equal(handlers[1], requireAuth);
      const res = response(); await handlers[1]({ cookies: {} }, res, () => assert.fail("anonymous request passed")); assert.equal(res.code, 401);
    }
    process.env.ULIQ_MAINNET_LOCKING_ENABLED = "false";
    const disabled = response(); routes.get("/uliq/mainnet-locking")![0]({}, disabled, () => assert.fail("disabled route passed")); assert.equal(disabled.code, 404);
    process.env.ULIQ_MAINNET_LOCKING_ENABLED = "true";
    const handler = routes.get("/uliq/mainnet-locking/lock/prepare")![2];
    const invalid = response(); await handler({ body: { amountRaw: "1", durationDays: 30 } }, invalid); assert.equal(invalid.code, 400); assert.equal(received.length, 0);
    const valid = response(); await handler({ body: { userId: "attacker-selected", amountRaw: "1", durationDays: 32 } }, valid); assert.deepEqual(received, ["linked-user", "1", 32]);
    const unavailable = response(); await routes.get("/uliq/mainnet-locking")![2]({ query: {} }, unavailable); assert.equal(unavailable.code, 503); assert.deepEqual(unavailable.body, { error: "uliq_mainnet_locking_unavailable" });
  } finally { previous === undefined ? delete process.env.ULIQ_MAINNET_LOCKING_ENABLED : process.env.ULIQ_MAINNET_LOCKING_ENABLED = previous; }
});

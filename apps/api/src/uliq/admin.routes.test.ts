import assert from "node:assert/strict";
import test from "node:test";
import { registerUliqAdminRoutes } from "./admin.routes.js";

type Handler = (...args: any[]) => any;

function fakeApp() {
  const post = new Map<string, Handler[]>();
  return {
    get: () => undefined,
    post(path: string, ...handlers: Handler[]) { post.set(path, handlers); },
    postRoutes: post
  };
}

function mockResponse() {
  return {
    locals: { user: { id: "admin-1" } },
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(value: any) { this.body = value; return this; }
  };
}

async function run(handlers: Handler[], req: any, res: any) {
  let index = 0;
  const next = async (): Promise<void> => {
    const handler = handlers[index++];
    if (handler) await handler(req, res, next);
  };
  await next();
}

test("ULIQ Safe preparation checks superadmin before consuming reauth and never signs", async () => {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousAdmin = process.env.ULIQ_ADMIN_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_ADMIN_ENABLED = "true";
  try {
    const calls: string[] = [];
    let allowSuperadmin = false;
    const app = fakeApp();
    registerUliqAdminRoutes(app as any, {
      db: {},
      presaleService: {
        prepareDexLaunchTimestamp: async (timestamp: string) => {
          calls.push(`prepare:${timestamp}`);
          return {
            safeTransaction: { chainId: 421614, to: "0x1111111111111111111111111111111111111111", data: "0x1234", value: "0", operation: 0 },
            preflight: { state: "DEX_PENDING", pendingPurchaseCount: "0" }
          };
        }
      } as any,
      requireSuperadmin: async (res: any) => {
        calls.push("superadmin");
        if (!allowSuperadmin) res.status(403).json({ error: "forbidden" });
        return allowSuperadmin;
      },
      consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
        calls.push("reauth");
        await next();
      },
      recordAdminAuditEvent: async () => { calls.push("audit"); }
    });
    const handlers = app.postRoutes.get("/admin/uliq/safe/set-dex-launch/prepare");
    assert.ok(handlers);

    const forbidden = mockResponse();
    await run(handlers!.slice(1), { body: { dexLaunchTimestamp: "1787410000" }, ip: "127.0.0.1" }, forbidden);
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(calls, ["superadmin"]);

    calls.length = 0;
    allowSuperadmin = true;
    const allowed = mockResponse();
    await run(handlers!.slice(1), { body: { dexLaunchTimestamp: "1787410000" }, ip: "127.0.0.1" }, allowed);
    assert.deepEqual(calls, ["superadmin", "reauth", "prepare:1787410000", "audit"]);
    assert.equal(allowed.body.safeTransaction.chainId, 421614);
    assert.equal(Object.prototype.hasOwnProperty.call(allowed.body, "signature"), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousAdmin === undefined) delete process.env.ULIQ_ADMIN_ENABLED;
    else process.env.ULIQ_ADMIN_ENABLED = previousAdmin;
  }
});

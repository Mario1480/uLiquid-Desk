import assert from "node:assert/strict";
import test from "node:test";
import { registerUliqAdminRoutes } from "./admin.routes.js";

type Handler = (...args: any[]) => any;

function fakeApp() {
  const post = new Map<string, Handler[]>();
  const put = new Map<string, Handler[]>();
  return {
    get: () => undefined,
    post(path: string, ...handlers: Handler[]) { post.set(path, handlers); },
    put(path: string, ...handlers: Handler[]) { put.set(path, handlers); },
    postRoutes: post,
    putRoutes: put
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
      treasuryService: {} as any,
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

test("ULIQ Treasury changes require superadmin plus reauth and only prepare unsigned Safe transactions", async () => {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousAdmin = process.env.ULIQ_ADMIN_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_ADMIN_ENABLED = "true";
  try {
    const calls: string[] = [];
    const app = fakeApp();
    const treasuryState = {
      desiredTreasury: "0x2222222222222222222222222222222222222222",
      activeTreasury: "0x1111111111111111111111111111111111111111",
      custodyAddress: "0x3333333333333333333333333333333333333333",
      syncStatus: "proposal_required",
      asOfBlock: "123"
    };
    registerUliqAdminRoutes(app as any, {
      db: {},
      presaleService: {} as any,
      treasuryService: {
        setDesiredTreasury: async (address: string) => {
          calls.push(`save:${address}`);
          return treasuryState;
        },
        prepareProposal: async () => {
          calls.push("prepare:propose");
          return {
            safeTransaction: {
              chainId: 421614,
              to: treasuryState.custodyAddress,
              data: "0x1234",
              value: "0",
              operation: 0,
              expectedSender: "0x4444444444444444444444444444444444444444"
            },
            preflight: treasuryState
          };
        },
        prepareAcceptance: async () => { throw new Error("unexpected"); },
        prepareCancellation: async () => { throw new Error("unexpected"); }
      } as any,
      requireSuperadmin: async () => { calls.push("superadmin"); return true; },
      consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
        calls.push("reauth");
        await next();
      },
      recordAdminAuditEvent: async () => { calls.push("audit"); }
    });

    const saveHandlers = app.putRoutes.get("/admin/uliq/treasury");
    assert.ok(saveHandlers);
    const saveResponse = mockResponse();
    await run(saveHandlers!.slice(1), {
      body: { desiredAddress: treasuryState.desiredTreasury },
      ip: "127.0.0.1"
    }, saveResponse);
    assert.equal(saveResponse.statusCode, 200);
    assert.deepEqual(calls, ["superadmin", "reauth", `save:${treasuryState.desiredTreasury}`, "audit"]);

    calls.length = 0;
    const prepareHandlers = app.postRoutes.get("/admin/uliq/treasury/propose/prepare");
    assert.ok(prepareHandlers);
    const prepareResponse = mockResponse();
    await run(prepareHandlers!.slice(1), { body: {}, ip: "127.0.0.1" }, prepareResponse);
    assert.deepEqual(calls, ["superadmin", "reauth", "prepare:propose", "audit"]);
    assert.equal(prepareResponse.body.safeTransaction.expectedSender, "0x4444444444444444444444444444444444444444");
    assert.equal(Object.prototype.hasOwnProperty.call(prepareResponse.body, "signature"), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousAdmin === undefined) delete process.env.ULIQ_ADMIN_ENABLED;
    else process.env.ULIQ_ADMIN_ENABLED = previousAdmin;
  }
});

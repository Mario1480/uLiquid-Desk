import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { registerUliqAdminRoutes } from "./admin.routes.js";

type Handler = (...args: any[]) => any;

function fakeApp() {
  const get = new Map<string, Handler[]>();
  const post = new Map<string, Handler[]>();
  const put = new Map<string, Handler[]>();
  return {
    get(path: string, ...handlers: Handler[]) { get.set(path, handlers); },
    post(path: string, ...handlers: Handler[]) { post.set(path, handlers); },
    put(path: string, ...handlers: Handler[]) { put.set(path, handlers); },
    getRoutes: get,
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
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("ULIQ admin overview serializes Prisma Decimal values as JSON strings", async () => {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousAdmin = process.env.ULIQ_ADMIN_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_ADMIN_ENABLED = "true";
  try {
    const decimal = (value: string) => new Prisma.Decimal(value);
    const app = fakeApp();
    registerUliqAdminRoutes(app as any, {
      db: {
        onchainSyncCursor: { findFirst: async () => null },
        uliqReconciliationRun: { findFirst: async () => ({ asOfBlock: 123n, mismatchCount: 0 }) },
        uliqBenefitReservation: { groupBy: async () => [] },
        uliqPriceSnapshot: {
          findFirst: async () => ({
            priceUsd: decimal("0.001000000000000000"),
            spotPriceUsd: decimal("0.001100000000000000"),
            liquidityUsd: decimal("1234.56")
          })
        },
        uliqPresalePurchase: {
          groupBy: async () => [{
            status: "FINALIZED",
            _count: { _all: 1 },
            _sum: { usdcAmountRaw: decimal("10000000"), uliqAllocationRaw: decimal("10000000000000000000000") }
          }]
        },
        uliqVestingPosition: {
          aggregate: async () => ({ _count: { _all: 1 }, _sum: { allocatedRaw: decimal("7500"), releasedRaw: decimal("0") } })
        },
        uliqLockPosition: {
          aggregate: async () => ({ _count: { _all: 0 }, _sum: { amountRaw: decimal("0") } })
        },
        uliqTierConfig: {
          findMany: async () => [{ id: "tier-1", code: "BASIC", minUsdValue: decimal("0") }]
        },
        platformAlert: { findMany: async () => [] },
        adminAuditEvent: { findMany: async () => [] }
      },
      presaleService: { getOverview: async () => ({ state: "ACTIVE" }) } as any,
      treasuryService: { getState: async () => ({ activeTreasury: "0x1111111111111111111111111111111111111111" }) } as any,
      requireSuperadmin: async () => true,
      consumeRecentReauth: async (_req: any, _res: any, next: () => void) => { await next(); },
      recordAdminAuditEvent: async () => undefined
    });

    const handlers = app.getRoutes.get("/admin/uliq");
    assert.ok(handlers);
    const response = mockResponse();
    await run(handlers!.slice(1), {}, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.price.priceUsd, "0.001");
    assert.equal(response.body.price.spotPriceUsd, "0.0011");
    assert.equal(response.body.price.liquidityUsd, "1234.56");
    assert.equal(response.body.stats.purchases[0]._sum.usdcAmountRaw, "10000000");
    assert.equal(response.body.stats.vesting._sum.allocatedRaw, "7500");
    assert.equal(response.body.tiers[0].minUsdValue, "0");
    assert.deepEqual(response.body.benefitPreset, [
      { code: "BASIC", subscriptionDiscountBps: 0, aiDiscountBps: 0 },
      { code: "BRONZE", subscriptionDiscountBps: 0, aiDiscountBps: 500 },
      { code: "SILVER", subscriptionDiscountBps: 500, aiDiscountBps: 1_000 },
      { code: "GOLD", subscriptionDiscountBps: 1_000, aiDiscountBps: 1_500 },
      { code: "PLATINUM", subscriptionDiscountBps: 1_500, aiDiscountBps: 2_000 }
    ]);
    assert.equal(response.body.reconciliation.asOfBlock, "123");
    assert.equal(JSON.stringify(response.body).includes('"s":'), false);
    assert.equal(JSON.stringify(response.body).includes('"e":'), false);
    assert.equal(JSON.stringify(response.body).includes('"d":'), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousAdmin === undefined) delete process.env.ULIQ_ADMIN_ENABLED;
    else process.env.ULIQ_ADMIN_ENABLED = previousAdmin;
  }
});

test("ULIQ tier benefit changes fail closed when an AI discount has no monthly cap", async () => {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousAdmin = process.env.ULIQ_ADMIN_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_ADMIN_ENABLED = "true";
  try {
    let transactionCalled = false;
    const app = fakeApp();
    registerUliqAdminRoutes(app as any, {
      db: {
        $transaction: async () => {
          transactionCalled = true;
          throw new Error("transaction_must_not_run");
        }
      },
      presaleService: {} as any,
      treasuryService: {} as any,
      requireSuperadmin: async () => true,
      consumeRecentReauth: async (_req: any, _res: any, next: () => void) => { await next(); },
      recordAdminAuditEvent: async () => undefined
    });

    const handlers = app.putRoutes.get("/admin/uliq/tier-benefits");
    assert.ok(handlers);
    const response = mockResponse();
    await run(handlers!.slice(1), {
      body: {
        reason: "Reject missing monthly cap",
        tiers: [{
          code: "BRONZE",
          subscriptionDiscountBps: 0,
          aiDiscountBps: 500,
          aiCreditDiscountMonthlyCents: null
        }]
      }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, "invalid_payload");
    assert.equal(transactionCalled, false);
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousAdmin === undefined) delete process.env.ULIQ_ADMIN_ENABLED;
    else process.env.ULIQ_ADMIN_ENABLED = previousAdmin;
  }
});

test("ULIQ tier benefit changes require reauth and atomically create an audited config version", async () => {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousAdmin = process.env.ULIQ_ADMIN_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_ADMIN_ENABLED = "true";
  try {
    const calls: string[] = [];
    const created: any[] = [];
    const tx = {
      uliqTierConfig: {
        findMany: async () => [
          {
            code: "BASIC",
            version: 3,
            minUsdValue: new Prisma.Decimal("0"),
            featureFlags: { chat: true },
            subscriptionDiscountBps: 0,
            aiDiscountBps: 0,
            monetaryBenefitCaps: null
          },
          {
            code: "GOLD",
            version: 3,
            minUsdValue: new Prisma.Decimal("1500"),
            featureFlags: { predictions: true },
            subscriptionDiscountBps: 1_000,
            aiDiscountBps: 500,
            monetaryBenefitCaps: { aiCreditDiscountMonthlyCents: 500 }
          }
        ],
        updateMany: async () => { calls.push("close-v3"); return { count: 2 }; },
        create: async ({ data }: any) => { calls.push(`create:${data.code}`); created.push(data); return data; }
      }
    };
    const app = fakeApp();
    registerUliqAdminRoutes(app as any, {
      db: {
        $transaction: async (runInTransaction: (client: any) => Promise<any>) => {
          calls.push("transaction");
          return runInTransaction(tx);
        }
      },
      presaleService: {} as any,
      treasuryService: {} as any,
      requireSuperadmin: async () => { calls.push("superadmin"); return true; },
      consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
        calls.push("reauth");
        await next();
      },
      recordAdminAuditEvent: async (input) => {
        assert.equal(input.tx, tx);
        assert.equal(input.action, "uliq_tier_benefits_version_created");
        assert.equal(input.metadata?.reason, "Quarterly benefit review");
        calls.push("audit");
      }
    });

    const handlers = app.putRoutes.get("/admin/uliq/tier-benefits");
    assert.ok(handlers);
    const response = mockResponse();
    await run(handlers!.slice(1), {
      body: {
        reason: "Quarterly benefit review",
        tiers: [
          { code: "BASIC", subscriptionDiscountBps: 0, aiDiscountBps: 0, aiCreditDiscountMonthlyCents: null },
          { code: "GOLD", subscriptionDiscountBps: 1_500, aiDiscountBps: 1_000, aiCreditDiscountMonthlyCents: 750 }
        ]
      },
      ip: "127.0.0.1"
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.version, 4);
    assert.deepEqual(calls, ["superadmin", "reauth", "transaction", "close-v3", "create:BASIC", "create:GOLD", "audit"]);
    assert.equal(created[1].monetaryBenefitCaps.aiCreditDiscountMonthlyCents, 750);
    assert.equal(created[1].minimumLockDurationDays, null);
    assert.equal(created[1].reason, "Quarterly benefit review");
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousAdmin === undefined) delete process.env.ULIQ_ADMIN_ENABLED;
    else process.env.ULIQ_ADMIN_ENABLED = previousAdmin;
  }
});

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
        prepareMarkDexPending: async () => {
          calls.push("prepare:mark-dex-pending");
          return {
            safeTransaction: {
              chainId: 421614,
              to: "0x1111111111111111111111111111111111111111",
              data: "0x5678",
              value: "0",
              operation: 0,
              expectedSender: "0x4444444444444444444444444444444444444444"
            },
            preflight: { state: "ENDED", pendingPurchaseCount: "0", simulation: "success" }
          };
        },
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

    calls.length = 0;
    const markHandlers = app.postRoutes.get("/admin/uliq/safe/mark-dex-pending/prepare");
    assert.ok(markHandlers);
    const markResponse = mockResponse();
    await run(markHandlers!.slice(1), { body: {}, ip: "127.0.0.1" }, markResponse);
    assert.deepEqual(calls, ["superadmin", "reauth", "prepare:mark-dex-pending", "audit"]);
    assert.equal(markResponse.body.preflight.state, "ENDED");
    assert.equal(markResponse.body.preflight.simulation, "success");
    assert.equal(markResponse.body.safeTransaction.expectedSender, "0x4444444444444444444444444444444444444444");
    assert.equal(Object.prototype.hasOwnProperty.call(markResponse.body, "signature"), false);
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

import assert from "node:assert/strict";
import test from "node:test";
import { registerGridInstanceRoutes } from "./routes-instances.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
      put: putRoutes
    }
  };
}

function createMockRes(userId = "user_1") {
  return {
    locals: {
      user: {
        id: userId,
        email: `${userId}@example.com`
      }
    },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "put", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createShared() {
  return {
    async requireGridFeatureEnabledOrRespond() {
      return true;
    },
    async requireGridCapabilityOrRespond() {
      return true;
    },
    isMissingTableError() {
      return false;
    },
    gridWithdrawSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    }
  };
}

test("GET /grid/instances/:id/fills matches decimal and hex cloid refs through shared normalization", async () => {
  const app = createFakeApp();
  const cloidDecimal = "208456784328589790982014142665896995042";
  const cloidHex = `0x${BigInt(cloidDecimal).toString(16).padStart(32, "0")}`;

  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async ({ userId, instanceId }: any) => {
      assert.equal(userId, "user_1");
      assert.equal(instanceId, "grid_1");
      return {
        id: "grid_1",
        botId: "bot_1",
        botVault: { id: "bv_1" }
      };
    },
    db: {
      gridBotFillEvent: {
        async findMany() {
          return [];
        }
      },
      botFill: {
        async findMany() {
          return [{
            id: "fill_1",
            exchangeOrderId: "venue-oid-1",
            price: 66481,
            qty: 0.00069,
            notional: 45.87,
            feeAmount: 0.02,
            side: "SELL",
            fillTs: new Date("2026-03-31T18:00:00.000Z"),
            metadata: {
              raw: {
                cloid: cloidHex
              }
            }
          }];
        }
      },
      gridBotOrderMap: {
        async findMany() {
          return [{
            id: "gom_1",
            clientOrderId: "grid-grid_1-long-7",
            exchangeOrderId: `cloid:0:${cloidDecimal}`,
            gridLeg: "long",
            gridIndex: 7,
            intentType: "rebalance",
            updatedAt: new Date("2026-03-31T17:59:00.000Z")
          }];
        }
      },
      botOrder: {
        async findMany() {
          return [];
        }
      }
    }
  } as any, createShared() as any);

  const handler = getFinalHandler(app, "get", "/grid/instances/:id/fills");
  const res = createMockRes();

  await handler({ params: { id: "grid_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.clientOrderId, "grid-grid_1-long-7");
  assert.equal(res.body?.items?.[0]?.gridLeg, "long");
  assert.equal(res.body?.items?.[0]?.gridIndex, 7);
  assert.equal(res.body?.items?.[0]?.rawJson?.intentType, "rebalance");
});

test("GET /grid/instances/:id/orders dedupes decimal and hex order refs through shared normalization", async () => {
  const app = createFakeApp();
  const cloidDecimal = "208456784328589790982014142665896995042";
  const cloidHex = `0x${BigInt(cloidDecimal).toString(16).padStart(32, "0")}`;

  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      botId: "bot_1",
      botVault: { id: "bv_1" }
    }),
    db: {
      gridBotOrderMap: {
        async findMany() {
          return [{
            id: "gom_1",
            clientOrderId: "grid-grid_1-long-7",
            exchangeOrderId: `cloid:0:${cloidDecimal}`,
            gridLeg: "long",
            gridIndex: 7,
            intentType: "entry",
            side: "buy",
            price: 66481,
            qty: 0.00069,
            reduceOnly: false,
            status: "open",
            updatedAt: new Date("2026-03-31T18:05:00.000Z"),
            createdAt: new Date("2026-03-31T18:00:00.000Z")
          }];
        }
      },
      botOrder: {
        async findMany() {
          return [{
            id: "bo_1",
            clientOrderId: cloidHex,
            exchangeOrderId: `cloid:0:${cloidDecimal}`,
            side: "BUY",
            price: 66481,
            qty: 0.00069,
            reduceOnly: false,
            updatedAt: new Date("2026-03-31T18:06:00.000Z"),
            createdAt: new Date("2026-03-31T18:01:00.000Z"),
            metadata: {
              gridLeg: "long",
              gridIndex: 7,
              intentType: "entry"
            }
          }];
        }
      }
    }
  } as any, createShared() as any);

  const handler = getFinalHandler(app, "get", "/grid/instances/:id/orders");
  const res = createMockRes();

  await handler({ params: { id: "grid_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.clientOrderId, "grid-grid_1-long-7");
});

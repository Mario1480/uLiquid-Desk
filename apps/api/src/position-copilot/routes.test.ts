import assert from "node:assert/strict";
import test from "node:test";
import { registerPositionCopilotRoutes } from "./routes.js";

function createFakeApp() {
  const postHandlers = new Map<string, any[]>();
  return {
    post(path: string, ...handlers: any[]) {
      postHandlers.set(path, handlers);
    },
    get() {},
    put() {},
    handler(path: string) {
      return postHandlers.get(path)?.at(-1);
    }
  };
}

function createRes() {
  return {
    locals: { user: { id: "user_1", email: "user@example.test" } },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    }
  };
}

test("Position Copilot rejects cross-user account access before invoking AI", async () => {
  const app = createFakeApp();
  let accountWhere: any = null;
  let aiCalled = false;
  registerPositionCopilotRoutes(app as any, {
    db: {
      exchangeAccount: {
        findFirst: async ({ where }: any) => {
          accountWhere = where;
          return null;
        }
      }
    },
    callAiChat: async () => {
      aiCalled = true;
      throw new Error("must_not_run");
    },
    dispatchPositionCopilotNotification: async () => undefined
  });

  const handler = app.handler("/api/position-copilot/analyze");
  const res = createRes();
  await handler({
    body: {
      trigger: "manual",
      language: "en",
      snapshot: {
        exchangeAccountId: "account_owned_by_user_2",
        marketType: "perp",
        symbol: "BTCUSDT",
        side: "long",
        size: 0.1,
        entryPrice: 65_000,
        markPrice: 64_000,
        unrealizedPnlUsd: -100,
        leverage: 5,
        marginMode: "isolated",
        marginUsd: 1_280,
        notionalUsd: 6_400,
        liquidationPrice: 61_000,
        liquidationDistancePct: 4.6875,
        roePct: -7.8,
        pnlPct: -1.56,
        stopLossPrice: 62_500,
        takeProfitPrice: 68_000,
        dataDegraded: false,
        observedAt: "2026-08-02T12:00:00.000Z"
      }
    }
  }, res);

  assert.deepEqual(accountWhere, { id: "account_owned_by_user_2", userId: "user_1" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error, "exchange_account_not_found");
  assert.equal(aiCalled, false);
});

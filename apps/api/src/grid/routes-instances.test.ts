import assert from "node:assert/strict";
import test from "node:test";
import { registerGridInstanceRoutes } from "./routes-instances.js";
import { ManualTradingError } from "../trading.js";

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
    mapRiskErrorToHttp() {
      return null;
    },
    toTwoDecimals(value: number) {
      return Math.round(Number(value ?? 0) * 100) / 100;
    },
    buildVisibleGridTemplateWhere(userId: string, extra: Record<string, unknown> = {}) {
      return {
        ...extra,
        isPublished: true,
        isArchived: false,
        OR: [
          { templateVisibility: "PUBLIC" },
          { templateVisibility: "PRIVATE", createdByUserId: userId }
        ]
      };
    },
    gridWithdrawSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    }
  };
}

function buildCreateComputed(constraintSource: "live" | "cache" | "stale_cache" | "fallback") {
  return {
    markPrice: 68203,
    minInvestmentUSDT: 6.5,
    preview: {
      warnings: [],
      validationErrors: [],
      capitalSummary: {
        minimumRequiredBudgetUsd: 6.5,
        currentBudgetShortfallUsd: 0,
      }
    },
    warnings: constraintSource === "live" ? [] : ["constraints_missing_or_fallback_used"],
    minInvestmentBreakdown: {
      long: 2.89,
      short: 0,
      seed: 2.16,
      total: 6.5
    },
    initialSeed: {
      enabled: true,
      seedPct: 30,
      seedSide: "buy",
      seedQty: 0.00016,
      seedNotionalUsd: 10.91,
      seedMarginUsd: 2.18,
      seedMinMarginUsd: 2.16
    },
    allocation: {
      totalBudgetUsd: 7,
      gridInvestUsd: 7,
      extraMarginUsd: 0,
      splitMode: "manual",
      policy: null,
      targetLiqDistancePct: null,
      searchIterationsUsed: 0,
      insufficient: false,
      reasonCodes: []
    },
    venueContext: {
      markPrice: 68203,
      marketDataVenue: "hyperliquid",
      constraintSource,
      venueConstraints: {
        minQty: 0.00001,
        qtyStep: 0.00001,
        priceTick: 0.1,
        minNotional: 10,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: constraintSource === "live" ? [] : ["constraints_missing_or_fallback_used"]
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

test("GET /grid/instances/:id/orders returns real open orders instead of projected ladder rows", async () => {
  const app = createFakeApp();

  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      botId: "bot_1",
      botVault: { id: "bv_1" },
      template: {
        lowerPrice: 60000,
        upperPrice: 80000,
        gridCount: 20,
        gridMode: "arithmetic"
      },
      metricsJson: {
        windowMeta: {
          windowCenterIdx: 12,
          activeBuys: 12,
          activeSells: 8
        },
        positionSnapshot: {
          side: "long"
        }
      }
    }),
    db: {
      gridBotOrderMap: {
        async findMany() {
          return [{
            id: "gom_1",
            clientOrderId: "grid-grid_1-long-13",
            exchangeOrderId: "oid_1",
            gridLeg: "long",
            gridIndex: 13,
            intentType: "rebalance",
            side: "sell",
            price: 73000,
            qty: 0.00015,
            reduceOnly: true,
            status: "open",
            updatedAt: new Date("2026-03-31T18:05:00.000Z"),
            createdAt: new Date("2026-03-31T18:00:00.000Z")
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

  const handler = getFinalHandler(app, "get", "/grid/instances/:id/orders");
  const res = createMockRes();

  await handler({ params: { id: "grid_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.clientOrderId, "grid-grid_1-long-13");
  assert.equal(res.body?.items?.[0]?.price, 73000);
});

test("POST /grid/instances/:id/margin/preview uses live position liquidation before stale estimate", async () => {
  const app = createFakeApp();

  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      exchangeAccountId: "account_1",
      marginMode: "MANUAL",
      autoMarginEnabled: false,
      investUsd: 100,
      extraMarginUsd: 20,
      leverage: 5,
      slippagePct: 0.1,
      tpPct: null,
      tpProfitUsd: null,
      slPrice: null,
      triggerPrice: null,
      metricsJson: {
        liqEstimateLong: 47000,
        positionSnapshot: {
          side: "long",
          qty: 0.01,
          entryPrice: 50000,
          markPrice: 51000,
          liquidationPrice: 45500
        }
      },
      template: {
        id: "template_1",
        symbol: "BTCUSDT",
        tpDefaultPct: null,
        slDefaultPrice: null,
        autoReservePolicy: "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: 70,
        autoReserveTargetLiqDistancePct: null,
        autoReserveMaxPreviewIterations: 8,
        activeOrderWindowSize: 100,
        recenterDriftLevels: 1
      }
    }),
    computeGridPreviewAndAllocation: async () => ({
      markPrice: 51000,
      minInvestmentUSDT: 10,
      minInvestmentBreakdown: {
        long: 10,
        short: 0,
        seed: 0,
        total: 10
      },
      initialSeed: {
        enabled: true,
        seedPct: 30,
        seedSide: "buy",
        seedQty: 0.001,
        seedNotionalUsd: 51,
        seedMarginUsd: 10,
        seedMinMarginUsd: 10
      },
      allocation: {
        totalBudgetUsd: 125,
        gridInvestUsd: 100,
        extraMarginUsd: 25,
        splitMode: "manual",
        policy: null,
        targetLiqDistancePct: null,
        searchIterationsUsed: 0,
        insufficient: false,
        reasonCodes: []
      },
      preview: {
        validationErrors: [],
        liqEstimateLong: 44000,
        liqEstimateShort: null,
        worstCaseLiqPrice: 44000,
        worstCaseLiqDistancePct: 13,
        liqDistanceMinPct: 8,
        capitalSummary: {
          effectiveGridSlots: 10,
          effectiveGridInvestUsd: 100,
          capitalPerGridUsd: 10,
          initialSeedMarginUsd: 10,
          initialSeedPct: 30
        },
        safetySummary: {
          liqDistanceMinPct: 8,
          worstCaseLiqDistancePct: 13
        }
      },
      venueContext: {
        markPrice: 51000,
        marketDataVenue: "hyperliquid",
        constraintSource: "live",
        venueConstraints: {},
        liqDistanceMinPct: 8
      },
      warnings: []
    }),
    resolveVenueContext: async () => null
  } as any, {
    ...createShared(),
    gridMarginAdjustSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/margin/preview");
  const res = createMockRes();

  await handler({
    params: { id: "grid_1" },
    body: { mode: "add", amountUsd: 5 }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.adjustment?.currentLiqEstimate, 45500);
  assert.equal(res.body?.adjustment?.projectedLiqEstimate, 44000);
});

test("POST /grid/instances/:id/margin/preview uses side-specific liquidation estimate when live value is missing", async () => {
  const app = createFakeApp();

  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      exchangeAccountId: "account_1",
      marginMode: "MANUAL",
      autoMarginEnabled: false,
      investUsd: 100,
      extraMarginUsd: 20,
      leverage: 5,
      slippagePct: 0.1,
      tpPct: null,
      tpProfitUsd: null,
      slPrice: null,
      triggerPrice: null,
      metricsJson: {
        liqEstimateLong: 47000,
        liqEstimateShort: 56000,
        positionSnapshot: {
          side: "short",
          qty: 0.01,
          entryPrice: 52000,
          markPrice: 51000
        }
      },
      template: {
        id: "template_1",
        symbol: "BTCUSDT",
        tpDefaultPct: null,
        slDefaultPrice: null,
        autoReservePolicy: "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: 70,
        autoReserveTargetLiqDistancePct: null,
        autoReserveMaxPreviewIterations: 8,
        activeOrderWindowSize: 100,
        recenterDriftLevels: 1
      }
    }),
    computeGridPreviewAndAllocation: async () => ({
      markPrice: 51000,
      minInvestmentUSDT: 10,
      minInvestmentBreakdown: {
        long: 10,
        short: 0,
        seed: 0,
        total: 10
      },
      initialSeed: {
        enabled: true,
        seedPct: 30,
        seedSide: "sell",
        seedQty: 0.001,
        seedNotionalUsd: 51,
        seedMarginUsd: 10,
        seedMinMarginUsd: 10
      },
      allocation: {
        totalBudgetUsd: 125,
        gridInvestUsd: 100,
        extraMarginUsd: 25,
        splitMode: "manual",
        policy: null,
        targetLiqDistancePct: null,
        searchIterationsUsed: 0,
        insufficient: false,
        reasonCodes: []
      },
      preview: {
        validationErrors: [],
        liqEstimateLong: 43000,
        liqEstimateShort: 57000,
        worstCaseLiqPrice: 57000,
        worstCaseLiqDistancePct: 11,
        liqDistanceMinPct: 8,
        capitalSummary: {
          effectiveGridSlots: 10,
          effectiveGridInvestUsd: 100,
          capitalPerGridUsd: 10,
          initialSeedMarginUsd: 10,
          initialSeedPct: 30
        },
        safetySummary: {
          liqDistanceMinPct: 8,
          worstCaseLiqDistancePct: 11
        }
      },
      venueContext: {
        markPrice: 51000,
        marketDataVenue: "hyperliquid",
        constraintSource: "live",
        venueConstraints: {},
        liqDistanceMinPct: 8
      },
      warnings: []
    }),
    resolveVenueContext: async () => null
  } as any, {
    ...createShared(),
    gridMarginAdjustSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/margin/preview");
  const res = createMockRes();

  await handler({
    params: { id: "grid_1" },
    body: { mode: "add", amountUsd: 5 }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.adjustment?.currentLiqEstimate, 56000);
  assert.equal(res.body?.adjustment?.projectedLiqEstimate, 57000);
});

test("POST /grid/instances/:id/start returns vault_reconcile_required when BotVault v3 reconcile failed before start", async () => {
  const app = createFakeApp();

  registerGridInstanceRoutes(app as any, {
    ManualTradingError,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: false }),
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      botId: "bot_1",
      state: "created",
      bot: {
        exchange: "hyperliquid",
        exchangeAccount: {
          exchange: "hyperliquid"
        }
      }
    }),
    gridLifecycle: {
      async startGridInstanceNow() {
        throw new ManualTradingError(
          "grid_instance_vault_reconcile_required",
          409,
          "grid_instance_vault_reconcile_required"
        );
      }
    },
    db: {}
  } as any, {
    ...createShared(),
    allowedGridExchanges: new Set(["paper"]),
    async getGridHyperliquidExecutionContext() {
      return { allowLiveHyperliquid: false };
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/start");
  const res = createMockRes();

  await handler({ params: { id: "grid_1" } }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    error: "grid_instance_vault_reconcile_required",
    reason: "grid_instance_vault_reconcile_required",
    vaultStatus: "vault_reconcile_required",
    statusCategory: "retryable"
  });
});

test("POST /grid/instances/:id/start returns activation blocker metadata when BotVault activation fails", async () => {
  const app = createFakeApp();

  registerGridInstanceRoutes(app as any, {
    ManualTradingError,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: false }),
    loadGridInstanceForUser: async () => ({
      id: "grid_1",
      botId: "bot_1",
      state: "created",
      bot: {
        exchange: "hyperliquid",
        exchangeAccount: {
          exchange: "hyperliquid"
        }
      }
    }),
    gridLifecycle: {
      async startGridInstanceNow() {
        const error = new ManualTradingError(
          "grid_instance_vault_activation_failed",
          409,
          "grid_instance_vault_activation_failed"
        );
        Object.assign(error, {
          reasonCode: "grid_instance_vault_activation_failed",
          recoveryHint: "retry_reconcile",
          detail: "bot vault activation rejected"
        });
        throw error;
      }
    },
    db: {}
  } as any, {
    ...createShared(),
    allowedGridExchanges: new Set(["paper"]),
    async getGridHyperliquidExecutionContext() {
      return { allowLiveHyperliquid: false };
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/start");
  const res = createMockRes();

  await handler({ params: { id: "grid_1" } }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    error: "grid_instance_vault_activation_failed",
    reason: "grid_instance_vault_activation_failed",
    reasonCode: "grid_instance_vault_activation_failed",
    recoveryHint: "retry_reconcile",
    detail: "bot vault activation rejected",
    vaultStatus: "vault_activation_failed",
    statusCategory: "retryable"
  });
});

test("grid-scoped reserve build requires owned instance relationship and exact phase", async () => {
  const app = createFakeApp();
  let reserved: any = null;
  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async ({ userId, instanceId }: any) => ({
      id: instanceId,
      userId,
      botVault: { id: "bot_vault_1" }
    }),
    onchainActionService: {
      async buildReserveForBotVault(input: any) {
        reserved = input;
        return { mode: "onchain_live", action: { id: "action_1" }, txRequest: { to: "0x1" } };
      }
    },
    db: {}
  } as any, {
    ...createShared(),
    mapGridInstanceRow: (row: any) => ({
      ...row,
      provisioningStatus: { phase: "pending_reserve_signature" }
    })
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/onchain/reserve-tx");
  const res = createMockRes();
  await handler({
    params: { id: "grid_1" },
    body: { amountUsd: 12, actionKey: "grid:reserve:1" }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(reserved, {
    userId: "user_1",
    botVaultId: "bot_vault_1",
    amountUsd: 12,
    actionKey: "grid:reserve:1"
  });
});

test("grid-scoped reserve build rejects a non-provisioning phase", async () => {
  const app = createFakeApp();
  let called = false;
  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({ id: "grid_1", botVault: { id: "bot_vault_1" } }),
    onchainActionService: {
      async buildReserveForBotVault() {
        called = true;
      }
    },
    db: {}
  } as any, {
    ...createShared(),
    mapGridInstanceRow: (row: any) => ({
      ...row,
      provisioningStatus: { phase: "running" }
    })
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/onchain/reserve-tx");
  const res = createMockRes();
  await handler({ params: { id: "grid_1" }, body: {} }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "grid_provisioning_action_not_allowed");
  assert.equal(called, false);
});

test("grid-scoped tx submission rejects unrelated vault action types", async () => {
  const app = createFakeApp();
  let submitted = false;
  registerGridInstanceRoutes(app as any, {
    loadGridInstanceForUser: async () => ({ id: "grid_1", botVault: { id: "bot_vault_1" } }),
    onchainActionService: {
      async submitActionTxHash() {
        submitted = true;
      }
    },
    db: {
      onchainAction: {
        async findFirst() {
          return { id: "action_1", actionType: "claim_from_bot_vault" };
        }
      }
    }
  } as any, {
    ...createShared(),
    mapGridInstanceRow: (row: any) => ({
      ...row,
      provisioningStatus: { phase: "pending_reserve_signature" }
    })
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/instances/:id/onchain/actions/:actionId/submit-tx");
  const res = createMockRes();
  await handler({
    params: { id: "grid_1", actionId: "action_1" },
    body: { txHash: `0x${"a".repeat(64)}` }
  }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error, "grid_provisioning_action_not_found");
  assert.equal(submitted, false);
});

test("POST /grid/templates/:id/instances blocks hyperliquid bots below the runner-equivalent venue minimums", async () => {
  const app = createFakeApp();
  let transactionCalled = false;

  registerGridInstanceRoutes(app as any, {
    ManualTradingError,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: true }),
    computeGridPreviewAndAllocation: async () => ({
      markPrice: 68203,
      minInvestmentUSDT: 7.19,
      preview: {
        warnings: ["min_investment_above_current_invest"],
        validationErrors: [],
        capitalSummary: {
          minimumRequiredBudgetUsd: 7.19,
          currentBudgetShortfallUsd: 0.19,
        }
      },
      warnings: ["min_investment_above_current_invest"],
      minInvestmentBreakdown: {
        long: 2.89,
        short: 0,
        seed: 7.19,
        total: 7.19
      },
      initialSeed: {
        enabled: true,
        seedPct: 30,
        seedSide: "buy",
        seedQty: 0.00016,
        seedNotionalUsd: 10.91,
        seedMarginUsd: 2.18,
        seedMinMarginUsd: 2.16
      },
      allocation: {
        totalBudgetUsd: 7,
        gridInvestUsd: 7,
        extraMarginUsd: 0,
        splitMode: "manual",
        policy: null,
        targetLiqDistancePct: null,
        searchIterationsUsed: 0,
        insufficient: false,
        reasonCodes: []
      },
      venueContext: {
        markPrice: 68203,
        marketDataVenue: "hyperliquid",
        constraintSource: "live",
        venueConstraints: {
          minQty: 0.00001,
          qtyStep: 0.00001,
          priceTick: 0.1,
          minNotional: 10,
          feeRate: 0.06
        },
        feeBufferPct: 1,
        mmrPct: 0.75,
        liqDistanceMinPct: 8,
        warnings: []
      }
    }),
    resolveVenueContext: async () => {
      throw new Error("resolveVenueContext_should_not_be_called");
    },
    db: {
      gridBotTemplate: {
        async findFirst() {
          return {
            id: "template_1",
            name: "HL Grid",
            symbol: "BTCUSDT",
            leverageMin: 1,
            leverageMax: 10,
            leverageDefault: 5,
            slippageDefaultPct: 0.1,
            allowAutoMargin: false,
            marginPolicy: "MANUAL_ONLY",
            autoReservePolicy: "LIQ_GUARD_MAX_GRID",
            autoReserveFixedGridPct: 70,
            autoReserveTargetLiqDistancePct: null,
            autoReserveMaxPreviewIterations: 8
          };
        }
      },
      exchangeAccount: {
        async findFirst() {
          return {
            id: "account_1",
            exchange: "hyperliquid"
          };
        }
      },
      workspaceMember: {
        async findFirst() {
          return {
            workspaceId: "workspace_1"
          };
        }
      },
      async $transaction() {
        transactionCalled = true;
        throw new Error("transaction_should_not_be_called");
      }
    }
  } as any, {
    ...createShared(),
    allowedGridExchanges: new Set(["paper"]),
    gridInstanceCreateSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    },
    ensureGridExchangeAllowed() {
      return { ok: true };
    },
    async resolveGridHyperliquidAccountUsage() {
      return {
        usesHyperliquid: true,
        marketDataVenue: "hyperliquid"
      };
    },
    async getGridHyperliquidExecutionContext() {
      return {
        provider: "hyperliquid",
        allowLiveHyperliquid: true
      };
    },
    sendGridHyperliquidPilotRequired() {
      throw new Error("sendGridHyperliquidPilotRequired_should_not_be_called");
    },
    isTemplatePolicyImplemented() {
      return true;
    },
    mapGridTemplateRow(template: any) {
      return template;
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");
  const res = createMockRes();

  await handler({
    params: { id: "template_1" },
    body: {
      exchangeAccountId: "account_1",
      investUsd: 7,
      extraMarginUsd: 0,
      marginMode: "MANUAL",
      autoMarginEnabled: false
    }
  }, res);

  assert.equal(transactionCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "grid_instance_invest_below_minimum");
  assert.equal(res.body?.reason, "grid configuration does not satisfy venue minimum investment or order size requirements");
  assert.equal(res.body?.requiredMinInvestmentUSDT, 7.19);
  assert.equal(res.body?.currentInvestUsd, 7);
  assert.equal(res.body?.marketDataVenue, "hyperliquid");
  assert.equal(res.body?.venueConstraints?.minNotional, 10);
  assert.equal(res.body?.initialSeed?.seedQty, 0.00016);
});

test("POST /grid/templates/:id/instances blocks hyperliquid bots when venue constraints come only from fallback data", async () => {
  const app = createFakeApp();
  let transactionCalled = false;

  registerGridInstanceRoutes(app as any, {
    ManualTradingError,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: true }),
    computeGridPreviewAndAllocation: async () => buildCreateComputed("cache"),
    db: {
      gridBotTemplate: {
        async findFirst() {
          return {
            id: "template_1",
            name: "HL Grid",
            symbol: "BTCUSDT",
            leverageMin: 1,
            leverageMax: 10,
            leverageDefault: 5,
            slippageDefaultPct: 0.1,
            allowAutoMargin: false,
            marginPolicy: "MANUAL_ONLY",
            autoReservePolicy: "LIQ_GUARD_MAX_GRID",
            autoReserveFixedGridPct: 70,
            autoReserveTargetLiqDistancePct: null,
            autoReserveMaxPreviewIterations: 8
          };
        }
      },
      exchangeAccount: {
        async findFirst() {
          return {
            id: "account_1",
            exchange: "hyperliquid"
          };
        }
      },
      workspaceMember: {
        async findFirst() {
          return {
            workspaceId: "workspace_1"
          };
        }
      },
      async $transaction() {
        transactionCalled = true;
        throw new Error("transaction_should_not_be_called");
      }
    }
  } as any, {
    ...createShared(),
    allowedGridExchanges: new Set(["paper"]),
    gridInstanceCreateSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    },
    ensureGridExchangeAllowed() {
      return { ok: true };
    },
    async resolveGridHyperliquidAccountUsage() {
      return {
        usesHyperliquid: true,
        marketDataVenue: "hyperliquid"
      };
    },
    async getGridHyperliquidExecutionContext() {
      return {
        provider: "paper",
        allowLiveHyperliquid: true
      };
    },
    sendGridHyperliquidPilotRequired() {
      throw new Error("sendGridHyperliquidPilotRequired_should_not_be_called");
    },
    isTemplatePolicyImplemented() {
      return true;
    },
    mapGridTemplateRow(template: any) {
      return template;
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");
  const res = createMockRes();

  await handler({
    params: { id: "template_1" },
    body: {
      exchangeAccountId: "account_1",
      investUsd: 7,
      extraMarginUsd: 0,
      marginMode: "MANUAL",
      autoMarginEnabled: false
    }
  }, res);

  assert.equal(transactionCalled, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "grid_live_venue_constraints_required");
  assert.equal(res.body?.marketDataVenue, "hyperliquid");
  assert.equal(res.body?.venueConstraintSource, "cache");
  assert.equal(res.body?.venueConstraints?.minQty, 0.00001);
});

test("POST /grid/templates/:id/instances allows hyperliquid bots when venue constraints are live-confirmed", async () => {
  const app = createFakeApp();
  const createdRows: { botId?: string; instanceId?: string } = {};

  registerGridInstanceRoutes(app as any, {
    ManualTradingError,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: true }),
    computeGridPreviewAndAllocation: async () => buildCreateComputed("live"),
    loadGridInstanceForUser: async ({ instanceId }: any) => ({
      id: instanceId,
      state: "running",
      botId: "bot_1"
    }),
    gridLifecycle: {
      async startGridInstanceNow() {
        return { id: "instance_1", state: "running", botId: "bot_1" };
      }
    },
    vaultService: {
      async ensureBotVaultForGridInstance() {
        return { id: "vault_1" };
      }
    },
    db: {
      gridBotTemplate: {
        async findFirst() {
          return {
            id: "template_1",
            name: "HL Grid",
            symbol: "BTCUSDT",
            leverageMin: 1,
            leverageMax: 10,
            leverageDefault: 5,
            slippageDefaultPct: 0.1,
            allowAutoMargin: false,
            marginPolicy: "MANUAL_ONLY",
            autoReservePolicy: "LIQ_GUARD_MAX_GRID",
            autoReserveFixedGridPct: 70,
            autoReserveTargetLiqDistancePct: null,
            autoReserveMaxPreviewIterations: 8
          };
        }
      },
      exchangeAccount: {
        async findFirst() {
          return {
            id: "account_1",
            exchange: "hyperliquid"
          };
        }
      },
      workspaceMember: {
        async findFirst() {
          return {
            workspaceId: "workspace_1"
          };
        }
      },
      async $transaction(callback: any) {
        return callback({
          bot: {
            async create() {
              createdRows.botId = "bot_1";
              return {
                id: "bot_1",
                futuresConfig: {}
              };
            }
          },
          gridBotInstance: {
            async create({ data }: any) {
              createdRows.instanceId = "instance_1";
              return {
                id: "instance_1",
                investUsd: data.investUsd,
                extraMarginUsd: data.extraMarginUsd
              };
            }
          }
        });
      }
    }
  } as any, {
    ...createShared(),
    allowedGridExchanges: new Set(["paper"]),
    gridInstanceCreateSchema: {
      safeParse(value: any) {
        return { success: true, data: value };
      }
    },
    ensureGridExchangeAllowed() {
      return { ok: true };
    },
    async resolveGridHyperliquidAccountUsage() {
      return {
        usesHyperliquid: true,
        marketDataVenue: "hyperliquid"
      };
    },
    async getGridHyperliquidExecutionContext() {
      return {
        provider: "paper",
        allowLiveHyperliquid: true
      };
    },
    sendGridHyperliquidPilotRequired() {
      throw new Error("sendGridHyperliquidPilotRequired_should_not_be_called");
    },
    isTemplatePolicyImplemented() {
      return true;
    },
    mapGridTemplateRow(template: any) {
      return template;
    },
    mapGridInstanceRow(instance: any) {
      return {
        id: instance.id,
        state: instance.state,
        botId: instance.botId
      };
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");
  const res = createMockRes();

  await handler({
    params: { id: "template_1" },
    body: {
      exchangeAccountId: "account_1",
      investUsd: 7,
      extraMarginUsd: 0,
      marginMode: "MANUAL",
      autoMarginEnabled: false
    }
  }, res);

  assert.deepEqual(createdRows, { botId: "bot_1", instanceId: "instance_1" });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, {
    id: "instance_1",
    state: "running",
    botId: "bot_1"
  });
});

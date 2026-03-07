import assert from "node:assert/strict";
import test from "node:test";
import { registerGridRoutes } from "./grid.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  const getRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();

  return {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes,
      get: getRoutes,
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "post" | "get" | "put", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createDeps(overrides?: Partial<any>) {
  const gridInstance = {
    id: "grid_1",
    workspaceId: "ws_1",
    userId: "user_1",
    exchangeAccountId: "acc_1",
    templateId: "tpl_1",
    botId: "bot_1",
    state: "running",
    investUsd: 100,
    leverage: 3,
    extraMarginUsd: 20,
    triggerPrice: null,
    slippagePct: 0.1,
    tpPct: null,
    slPct: null,
    autoMarginEnabled: false,
    marginMode: "MANUAL",
    allocationMode: "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: "FIXED_50_50",
    longBudgetPct: 50,
    shortBudgetPct: 50,
    stateJson: {},
    metricsJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    template: {
      id: "tpl_1",
      workspaceId: "ws_1",
      name: "Grid",
      symbol: "BTCUSDT",
      marketType: "perp",
      mode: "neutral",
      gridMode: "arithmetic",
      lowerPrice: 40000,
      upperPrice: 50000,
      gridCount: 20,
      investMinUsd: 50,
      investMaxUsd: 10000,
      leverageMin: 1,
      leverageMax: 20,
      leverageDefault: 3,
      slippageMinPct: 0.01,
      slippageMaxPct: 1,
      slippageDefaultPct: 0.1,
      allowAutoMargin: false,
      allowManualMarginAdjust: true,
      allowProfitWithdraw: true,
      isPublished: true,
      isArchived: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    bot: {
      id: "bot_1",
      name: "Grid Bot",
      symbol: "BTCUSDT",
      exchange: "paper",
      status: "running",
      futuresConfig: {},
      exchangeAccount: {
        id: "acc_1",
        exchange: "paper",
        label: "Paper"
      }
    }
  };

  const db = {
    gridBotInstance: {
      async findFirst() {
        return { ...gridInstance };
      },
      async update(args: any) {
        gridInstance.extraMarginUsd = Number(args?.data?.extraMarginUsd ?? gridInstance.extraMarginUsd);
        return { ...gridInstance };
      }
    },
    botVault: {
      async findMany() {
        return [
          {
            id: "bv_1",
            userId: "user_1",
            gridInstanceId: "grid_1",
            allocatedUsd: 100,
            realizedGrossUsd: 0,
            realizedFeesUsd: 0,
            realizedNetUsd: 0,
            profitShareAccruedUsd: 0,
            withdrawnUsd: 0,
            availableUsd: 100,
            status: "ACTIVE",
            updatedAt: new Date()
          }
        ];
      }
    },
    bot: {
      async update() {
        return {};
      }
    },
    botRuntime: {
      async upsert() {
        return {};
      }
    },
    async $transaction(input: any) {
      if (Array.isArray(input)) {
        return Promise.all(input);
      }
      if (typeof input === "function") {
        return input(this);
      }
      return null;
    }
  } as any;

  const lifecycleCalls: Array<{ method: string; payload: any }> = [];

  const deps = {
    db,
    requireSuperadmin: async () => true,
    enqueueBotRun: async () => {},
    cancelBotRun: async () => {},
    resolveVenueContext: async () => ({
      markPrice: 45000,
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: null,
        feeRate: null
      },
      feeBufferPct: 0,
      mmrPct: 0,
      liqDistanceMinPct: 0,
      warnings: []
    }),
    vaultService: {
      ensureBotVaultForGridInstance: async () => ({}),
      activateBotVaultForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "activate", payload });
        return {};
      },
      pauseBotVaultForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "pause", payload });
        return {};
      },
      setBotVaultCloseOnlyForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "setCloseOnly", payload });
        return {};
      },
      closeBotVaultForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "close", payload });
        return {};
      },
      topUpBotVaultForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "topUp", payload });
        return {};
      },
      withdrawFromGridInstance: async () => ({
        botVault: {
          withdrawnUsd: 0,
          availableUsd: 0,
          withdrawableUsd: 0,
          profitShareAccruedUsd: 0,
          realizedNetUsd: 0,
          id: "bv_1",
          userId: "user_1",
          masterVaultId: "mv_1",
          gridInstanceId: "grid_1",
          allocatedUsd: 100,
          realizedGrossUsd: 0,
          realizedFeesUsd: 0,
          status: "ACTIVE",
          lastAccountingAt: null,
          updatedAt: new Date().toISOString()
        },
        settlement: null
      }),
      getMasterVaultSummary: async () => ({}),
      listBotVaults: async () => [],
      getBotVaultByGridInstance: async () => null,
      getExecutionStateForGridInstance: async () => null,
      listBotVaultLedger: async () => [],
      listBotExecutionEvents: async () => [],
      listProfitShareAccruals: async () => [],
      processPendingGridFillEvents: async () => ({ processed: 0, realizedEvents: 0, realizedNetUsd: 0, profitShareFeeUsd: 0 }),
      processGridFillEvent: async () => ({ processed: false, realizedNetUsd: 0, profitShareFeeUsd: 0 }),
      depositToMasterVault: async () => ({}),
      validateMasterVaultWithdraw: async () => ({ ok: true, reason: null, freeBalance: 0, reservedBalance: 0 }),
      withdrawFromMasterVault: async () => ({})
    },
    executionOrchestrator: null
  } as any;

  return {
    deps: {
      ...deps,
      ...(overrides ?? {})
    },
    lifecycleCalls
  };
}

function createDraftTemplatePayload(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "Draft Template",
    description: "preview draft",
    symbol: "BTCUSDT",
    marketType: "perp",
    mode: "long",
    gridMode: "arithmetic",
    allocationMode: "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: "FIXED_50_50",
    longBudgetPct: 50,
    shortBudgetPct: 50,
    marginPolicy: "AUTO_ALLOWED",
    autoMarginMaxUSDT: 100,
    autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW",
    autoMarginTriggerValue: 3,
    autoMarginStepUSDT: 25,
    autoMarginCooldownSec: 300,
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: 70,
    autoReserveTargetLiqDistancePct: 12,
    autoReserveMaxPreviewIterations: 8,
    lowerPrice: 50000,
    upperPrice: 100000,
    gridCount: 250,
    leverageMin: 10,
    leverageMax: 10,
    leverageDefault: 10,
    investMinUsd: 10,
    investMaxUsd: 2000,
    investDefaultUsd: 10,
    slippageDefaultPct: 0.1,
    slippageMinPct: 0.0001,
    slippageMaxPct: 5,
    tpDefaultPct: null,
    slDefaultPct: null,
    allowAutoMargin: true,
    allowManualMarginAdjust: true,
    allowProfitWithdraw: true,
    version: 1,
    ...(overrides ?? {})
  };
}

test("POST /grid/instances/:id/pause stays 200 and triggers vault lifecycle pause", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    cancelBotRun: async () => {}
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/pause");

  const req = { params: { id: "grid_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "pause"), true);
});

test("POST /grid/instances/:id/stop stays 200 and archives instance with close-only + close", async () => {
  const app = createFakeApp();
  const ctx = createDeps();

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/stop");

  const req = { params: { id: "grid_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.state, "archived");
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "setCloseOnly"), true);
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "close"), true);
});

test("POST /grid/instances/:id/margin/add stays 200 and triggers lifecycle topUp", async () => {
  const app = createFakeApp();
  const ctx = createDeps();

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/margin/add");

  const req = {
    params: { id: "grid_1" },
    body: {
      amountUsd: 15
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  const topUpCall = ctx.lifecycleCalls.find((entry) => entry.method === "topUp");
  assert.ok(topUpCall);
  assert.equal(topUpCall?.payload?.amountUsd, 15);
});

test("POST /grid/instances/:id/pause maps risk invalid transition to 409", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    vaultService: {
      ...createDeps().deps.vaultService,
      pauseBotVaultForGridInstance: async () => {
        throw new Error("risk_invalid_status_transition");
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/pause");
  const req = { params: { id: "grid_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "risk_invalid_status_transition");
});

test("POST /grid/instances/:id/margin/add maps risk codes to 400", async () => {
  const app = createFakeApp();
  const base = createDeps();
  const ctx = createDeps({
    vaultService: {
      ...base.deps.vaultService,
      topUpBotVaultForGridInstance: async () => {
        throw new Error("risk_allocation_above_maximum");
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/margin/add");

  const req = {
    params: { id: "grid_1" },
    body: {
      amountUsd: 15
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "risk_allocation_above_maximum");
});

test("POST /admin/grid/templates/draft-preview returns normalized preview shape with mark override", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  const capturedMarkPrices: number[] = [];
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    capturedMarkPrices.push(Number(body?.markPrice));
    return new Response(JSON.stringify({
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 120,
      minInvestmentBreakdown: { long: 120, short: 0, total: 120 },
      qtyModel: { mode: "EQUAL_NOTIONAL_PER_GRID", qtyPerOrder: 0.001 },
      allocationBreakdown: { slotsLong: 250, slotsShort: 0 },
      worstCaseLiqDistancePct: 12,
      liqDistanceMinPct: 8,
      liqEstimateLong: 65000,
      liqEstimateShort: null,
      warnings: []
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const req = {
      body: {
        draftTemplate: createDraftTemplatePayload(),
        previewInput: {
          exchangeAccountId: "acc_1",
          investUsd: 300,
          extraMarginUsd: 0,
          marginMode: "MANUAL",
          markPriceOverride: 70995.25
        }
      }
    };
    const res = createMockRes("user_1");

    await handler(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.status?.ready, true);
    assert.equal(res.body?.allocation?.splitMode, "manual");
    assert.equal(res.body?.markPrice, 70995.25);
    assert.equal(capturedMarkPrices.length >= 1, true);
    assert.equal(capturedMarkPrices.every((value) => Math.abs(value - 70995.25) < 1e-9), true);
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /admin/grid/templates/draft-preview returns 404 when exchange account is missing", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return null;
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");

  const req = {
    body: {
      draftTemplate: createDraftTemplatePayload(),
      previewInput: {
        exchangeAccountId: "missing",
        investUsd: 300,
        marginMode: "MANUAL"
      }
    }
  };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error, "exchange_account_not_found");
});

test("POST /admin/grid/templates/draft-preview rejects not-yet-implemented policies", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");
  const req = {
    body: {
      draftTemplate: createDraftTemplatePayload({ allocationMode: "WEIGHTED_NEAR_PRICE" }),
      previewInput: {
        exchangeAccountId: "acc_1",
        investUsd: 300
      }
    }
  };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "grid_policy_not_implemented");
});

test("POST /admin/grid/templates/draft-preview allows FIXED_CUSTOM mismatch for neutral mode", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    perGridQty: 0.001,
    perGridNotional: 10,
    profitPerGridNetPct: 0.2,
    profitPerGridNetUsd: 0.02,
    minInvestmentUSDT: 50,
    minInvestmentBreakdown: { long: 50, short: 50, total: 50 },
    worstCaseLiqDistancePct: 15,
    liqDistanceMinPct: 8,
    liqEstimateLong: 64000,
    liqEstimateShort: 76000,
    warnings: []
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;

  try {
    const req = {
      body: {
        draftTemplate: createDraftTemplatePayload({
          mode: "neutral",
          budgetSplitPolicy: "FIXED_CUSTOM",
          longBudgetPct: 95,
          shortBudgetPct: 1
        }),
        previewInput: {
          exchangeAccountId: "acc_1",
          investUsd: 300
        }
      }
    };
    const res = createMockRes("user_1");

    await handler(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.status?.ready, true);
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /admin/grid/templates/draft-preview uses AUTO split for FIXED_RATIO templates", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 50,
      minInvestmentBreakdown: { long: 50, short: 0, total: 50 },
      worstCaseLiqDistancePct: 15,
      liqDistanceMinPct: 8,
      liqEstimateLong: 64000,
      liqEstimateShort: null,
      warnings: []
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const req = {
      body: {
        draftTemplate: createDraftTemplatePayload({
          marginPolicy: "AUTO_ALLOWED",
          autoReservePolicy: "FIXED_RATIO",
          autoReserveFixedGridPct: 60
        }),
        previewInput: {
          exchangeAccountId: "acc_1",
          investUsd: 300,
          marginMode: "AUTO"
        }
      }
    };
    const res = createMockRes("user_1");

    await handler(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.marginMode, "AUTO");
    assert.equal(res.body?.allocation?.splitMode, "auto_fixed_ratio");
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

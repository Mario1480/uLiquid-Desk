import assert from "node:assert/strict";
import test from "node:test";
import { registerGridRoutes } from "./grid.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  const getRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();

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
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes,
      get: getRoutes,
      put: putRoutes,
      delete: deleteRoutes
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "post" | "get" | "put" | "delete", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createDeps(overrides?: Partial<any>) {
  const favoriteRows: Array<{ userId: string; templateId: string }> = [];
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
      async findMany() {
        return [{ ...gridInstance }];
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
            masterVaultId: "mv_1",
            gridInstanceId: "grid_1",
            principalAllocated: 100,
            principalReturned: 0,
            allocatedUsd: 100,
            realizedGrossUsd: 0,
            realizedFeesUsd: 0,
            realizedNetUsd: 0,
            profitShareAccruedUsd: 0,
            withdrawnUsd: 0,
            availableUsd: 100,
            executionProvider: "hyperliquid_demo",
            executionUnitId: "exec_unit_1",
            executionStatus: "created",
            executionLastSyncedAt: new Date("2026-03-08T09:00:00.000Z"),
            executionLastError: null,
            executionLastErrorAt: null,
            executionMetadata: {
              providerSelectionReason: "sticky_existing_vault",
              pilotScope: "none",
              providerState: {
                providerMode: "demo",
                chain: "hyperevm",
                marketDataExchange: "hyperliquid",
                vaultAddress: "0x1111111111111111111111111111111111111111",
                subaccountAddress: "0x2222222222222222222222222222222222222222",
                agentWallet: "0x3333333333333333333333333333333333333333",
                lastAction: "assignAgent"
              }
            },
            status: "ACTIVE",
            updatedAt: new Date()
          }
        ];
      }
    },
    globalSetting: {
      async findUnique() {
        return null;
      }
    },
    workspaceMember: {
      async findFirst() {
        return null;
      }
    },
    gridBotTemplate: {
      async findFirst(args: any) {
        const id = String(args?.where?.id ?? "tpl_1");
        return createPublishedTemplateRow({ id });
      },
      async findMany() {
        return [createPublishedTemplateRow()];
      }
    },
    gridTemplateFavorite: {
      async create(args: any) {
        const entry = {
          userId: String(args?.data?.userId ?? ""),
          templateId: String(args?.data?.templateId ?? "")
        };
        if (favoriteRows.some((row) => row.userId === entry.userId && row.templateId === entry.templateId)) {
          const error = new Error("duplicate_favorite");
          (error as any).code = "P2002";
          throw error;
        }
        favoriteRows.push(entry);
        return { id: "fav_1", ...entry, createdAt: new Date() };
      },
      async deleteMany(args: any) {
        const before = favoriteRows.length;
        const userId = String(args?.where?.userId ?? "");
        const templateId = String(args?.where?.templateId ?? "");
        for (let index = favoriteRows.length - 1; index >= 0; index -= 1) {
          if (favoriteRows[index]?.userId === userId && favoriteRows[index]?.templateId === templateId) {
            favoriteRows.splice(index, 1);
          }
        }
        return { count: before - favoriteRows.length };
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
      stopBotVaultForGridInstance: async (payload: any) => {
        lifecycleCalls.push({ method: "stop", payload });
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

function createPublishedTemplateRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "tpl_1",
    workspaceId: "ws_1",
    name: "Catalog Grid",
    description: "Trend-following grid template",
    catalogCategory: "Trend",
    catalogTags: ["swing", "btc"],
    catalogDifficulty: "BEGINNER",
    catalogRiskLevel: "MEDIUM",
    catalogImageUrl: "https://example.com/grid.png",
    catalogShortDescription: "Balanced BTC grid template",
    catalogSortOrder: 10,
    catalogFeatured: false,
    isPublished: true,
    isArchived: false,
    leverageMin: 1,
    leverageMax: 25,
    leverageDefault: 10,
    investMinUsd: 10,
    slippageDefaultPct: 0.1,
    symbol: "BTCUSDT",
    marginPolicy: "AUTO_ALLOWED",
    allowAutoMargin: true,
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: 70,
    autoReserveTargetLiqDistancePct: 30,
    autoReserveMaxPreviewIterations: 12,
    tpDefaultPct: null,
    slDefaultPct: null,
    ...createDraftTemplatePayload(),
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

test("POST /grid/instances/:id/stop stays 200 and only triggers lifecycle stop", async () => {
  const app = createFakeApp();
  const ctx = createDeps();

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/stop");

  const req = { params: { id: "grid_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.state, "stopped");
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "stop"), true);
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "setCloseOnly"), false);
  assert.equal(ctx.lifecycleCalls.some((entry) => entry.method === "close"), false);
});

test("POST /grid/instances/:id/end stays 200 and stops before close-only + close", async () => {
  const app = createFakeApp();
  const ctx = createDeps();

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/end");

  const req = { params: { id: "grid_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.state, "archived");
  assert.deepEqual(
    ctx.lifecycleCalls.map((entry) => entry.method),
    ["stop", "setCloseOnly", "close"]
  );
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

test("GET /grid/instances includes provider metadata summary and hides raw metadata", async () => {
  const app = createFakeApp();
  const ctx = createDeps();

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances");
  const req = { query: {} };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body.items[0]?.botVault?.executionProvider, "hyperliquid_demo");
  assert.equal(res.body.items[0]?.botVault?.providerMetadataSummary?.marketDataExchange, "hyperliquid");
  assert.equal(res.body.items[0]?.botVault?.providerMetadataSummary?.lastAction, "assignAgent");
  assert.equal(res.body.items[0]?.pilotStatus?.allowed, true);
  assert.equal(res.body.items[0]?.pilotStatus?.provider, "hyperliquid_demo");
  assert.equal(res.body.items[0]?.pilotStatus?.providerSelectionReason, "sticky_existing_vault");
  assert.equal(res.body.items[0]?.botVault?.providerMetadataRaw, null);
});

test("GET /grid/instances hides pending-signature provisioning rows until tx is submitted", async () => {
  const app = createFakeApp();
  const pendingRow = {
    id: "grid_pending",
    workspaceId: "ws_1",
    userId: "user_1",
    exchangeAccountId: "acc_hl_1",
    templateId: "tpl_1",
    botId: "bot_pending",
    state: "created",
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
    stateJson: {
      provisioning: {
        phase: "pending_signature",
        reason: "awaiting_wallet_signature",
        pendingActionId: "act_pending"
      }
    },
    metricsJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    template: createPublishedTemplateRow(),
    bot: {
      id: "bot_pending",
      name: "Pending Grid Bot",
      symbol: "BTCUSDT",
      exchange: "hyperliquid",
      status: "stopped",
      futuresConfig: {},
      exchangeAccount: {
        id: "acc_hl_1",
        exchange: "hyperliquid",
        label: "Hyperliquid"
      }
    }
  };
  const submittedRow = {
    ...pendingRow,
    id: "grid_submitted",
    botId: "bot_submitted",
    stateJson: {
      provisioning: {
        phase: "submitted_waiting_indexer",
        reason: "tx_submitted",
        pendingActionId: "act_submitted"
      }
    },
    bot: {
      ...pendingRow.bot,
      id: "bot_submitted",
      name: "Submitted Grid Bot"
    }
  };
  const ctx = createDeps({
    db: {
      ...createDeps().deps.db,
      gridBotInstance: {
        async findMany() {
          return [pendingRow, submittedRow];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_pending",
              userId: "user_1",
              masterVaultId: "mv_1",
              gridInstanceId: "grid_pending",
              allocatedUsd: 0,
              realizedGrossUsd: 0,
              realizedFeesUsd: 0,
              realizedNetUsd: 0,
              profitShareAccruedUsd: 0,
              withdrawnUsd: 0,
              availableUsd: 0,
              executionProvider: "hyperliquid",
              executionUnitId: "exec_pending",
              executionStatus: "created",
              executionLastSyncedAt: null,
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadata: {
                providerState: {
                  marketDataExchange: "hyperliquid"
                }
              },
              onchainActions: [
                {
                  actionKey: "grid:create_bot_vault:grid_pending:key_pending",
                  actionType: "create_bot_vault",
                  status: "prepared",
                  updatedAt: new Date()
                }
              ],
              status: "ACTIVE",
              updatedAt: new Date()
            },
            {
              id: "bv_submitted",
              userId: "user_1",
              masterVaultId: "mv_1",
              gridInstanceId: "grid_submitted",
              allocatedUsd: 0,
              realizedGrossUsd: 0,
              realizedFeesUsd: 0,
              realizedNetUsd: 0,
              profitShareAccruedUsd: 0,
              withdrawnUsd: 0,
              availableUsd: 0,
              executionProvider: "hyperliquid",
              executionUnitId: "exec_submitted",
              executionStatus: "created",
              executionLastSyncedAt: null,
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadata: {
                providerState: {
                  marketDataExchange: "hyperliquid"
                }
              },
              onchainActions: [
                {
                  actionKey: "grid:create_bot_vault:grid_submitted:key_submitted",
                  actionType: "create_bot_vault",
                  status: "submitted",
                  updatedAt: new Date()
                }
              ],
              status: "ACTIVE",
              updatedAt: new Date()
            }
          ];
        }
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances");
  const res = createMockRes("user_1");

  await handler({ query: {} } as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0]?.id, "grid_submitted");
  assert.equal(res.body.items[0]?.provisioningStatus?.phase, "submitted_waiting_indexer");
});

test("POST /grid/instances/:id/cancel-provisioning deletes pending-signature create records", async () => {
  const app = createFakeApp();
  const deleted: string[] = [];
  const ctx = createDeps({
    db: {
      ...createDeps().deps.db,
      gridBotInstance: {
        async findFirst(args: any) {
          if (String(args?.where?.id ?? "") !== "grid_cancel") return null;
          return {
            id: "grid_cancel",
            userId: "user_1",
            botId: "bot_cancel",
            stateJson: {
              provisioning: {
                phase: "pending_signature",
                startedAt: new Date().toISOString()
              }
            },
            bot: {
              id: "bot_cancel",
              futuresConfig: {}
            }
          };
        },
        async deleteMany(args: any) {
          deleted.push(`grid:${String(args?.where?.id ?? "")}`);
          return { count: 1 };
        }
      },
      botVault: {
        async findFirst() {
          return {
            id: "bv_cancel",
            userId: "user_1",
            gridInstanceId: "grid_cancel",
            vaultAddress: null,
            allocatedUsd: 0,
            principalAllocated: 0,
            availableUsd: 0,
            onchainActions: [
              {
                id: "act_cancel",
                actionType: "create_bot_vault",
                status: "prepared"
              }
            ]
          };
        },
        async deleteMany(args: any) {
          deleted.push(`botVault:${String(args?.where?.id ?? "")}`);
          return { count: 1 };
        }
      },
      onchainAction: {
        async deleteMany(args: any) {
          deleted.push(`action:${String(args?.where?.botVaultId ?? "")}:${String(args?.where?.status ?? "")}`);
          return { count: 1 };
        }
      },
      botRuntime: {
        async deleteMany(args: any) {
          deleted.push(`runtime:${String(args?.where?.botId ?? "")}`);
          return { count: 1 };
        }
      },
      futuresBotConfig: {
        async deleteMany(args: any) {
          deleted.push(`futures:${String(args?.where?.botId ?? "")}`);
          return { count: 1 };
        }
      },
      bot: {
        async deleteMany(args: any) {
          deleted.push(`bot:${String(args?.where?.id ?? "")}`);
          return { count: 1 };
        }
      },
      async $transaction(input: any) {
        if (typeof input === "function") {
          return input(this);
        }
        return null;
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/instances/:id/cancel-provisioning");
  const res = createMockRes("user_1");

  await handler({ params: { id: "grid_cancel" } } as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.deepEqual(deleted, [
    "action:bv_cancel:prepared",
    "botVault:bv_cancel",
    "grid:grid_cancel",
    "runtime:bot_cancel",
    "futures:bot_cancel",
    "bot:bot_cancel"
  ]);
});

test("GET /grid/instances/:id merges synced execution state into botVault summary", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    vaultService: {
      ...createDeps().deps.vaultService,
      getExecutionStateForGridInstance: async () => ({
        status: "running",
        observedAt: "2026-03-08T10:15:00.000Z",
        providerMetadata: {
          providerMode: "demo",
          chain: "hyperevm",
          marketDataExchange: "hyperliquid",
          vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          subaccountAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          agentWallet: "0xcccccccccccccccccccccccccccccccccccccccc",
          providerState: {
            lastAction: "startBotExecution"
          }
        }
      })
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances/:id");
  const req = { params: { id: "grid_1" } };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.botVault?.executionStatus, "running");
  assert.equal(res.body?.botVault?.providerMetadataSummary?.marketDataExchange, "hyperliquid");
  assert.equal(res.body?.botVault?.providerMetadataSummary?.lastAction, "startBotExecution");
  assert.equal(res.body?.pilotStatus?.allowed, true);
  assert.equal(res.body?.pilotStatus?.provider, "hyperliquid_demo");
  assert.equal(res.body?.botVault?.providerMetadataRaw, null);
});

test("GET /grid/instances/:id preserves existing botVault identity when synced provider metadata is partial", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    vaultService: {
      ...createDeps().deps.vaultService,
      getExecutionStateForGridInstance: async () => ({
        status: "running",
        observedAt: "2026-03-26T10:15:00.000Z",
        providerMetadata: {
          providerMode: "demo",
          providerState: {
            marketDataExchange: "hyperliquid",
            lastAction: "syncPartial"
          }
        }
      })
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances/:id");
  const req = { params: { id: "grid_1" } };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.hasOnchainBotVault, false);
  assert.equal(
    res.body?.botVault?.providerMetadataSummary?.vaultAddress,
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(
    res.body?.botVault?.providerMetadataSummary?.agentWallet,
    "0x3333333333333333333333333333333333333333"
  );
  assert.equal(res.body?.botVault?.providerMetadataSummary?.lastAction, "syncPartial");
});

test("GET /grid/instances/:id stays available when execution state sync fails", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    vaultService: {
      ...createDeps().deps.vaultService,
      getExecutionStateForGridInstance: async () => {
        throw new Error("hyperliquid_state_unavailable");
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances/:id");
  const req = { params: { id: "grid_1" } };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.id, "grid_1");
  assert.equal(res.body?.executionState, null);
  assert.match(String(res.body?.executionStateError ?? ""), /hyperliquid_state_unavailable/);
});

test("GET /grid/instances/:id exposes raw provider metadata for admin viewers only", async () => {
  const app = createFakeApp();
  const base = createDeps();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      globalSetting: {
        async findUnique() {
          return {
            value: {
              userIds: ["user_1"]
            }
          };
        }
      }
    }
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/instances/:id");
  const req = { params: { id: "grid_1" } };
  const res = createMockRes("user_1");

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.botVault?.providerMetadataSummary?.marketDataExchange, "hyperliquid");
  assert.equal(res.body?.botVault?.providerMetadataRaw?.marketDataExchange, "hyperliquid");
  assert.equal(res.body?.botVault?.providerMetadataRaw?.providerState?.lastAction, "assignAgent");
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
    const requestPayload = body?.payload ?? body;
    capturedMarkPrices.push(Number(requestPayload?.markPrice));
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

test("POST /admin/grid/templates/draft-preview includes normalized validation data", async () => {
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
      protocolVersion: "grid.v2",
      requestId: "req_validation",
      ok: true,
      payload: {
        perGridQty: 0.001,
        perGridNotional: 10,
        profitPerGridNetPct: 0.2,
        profitPerGridNetUsd: 0.02,
        minInvestmentUSDT: 120,
        minInvestmentBreakdown: { long: 120, short: 0, seed: 5, total: 120 },
        allocationBreakdown: { slotsLong: 250, slotsShort: 0, effectiveGridInvestUsd: 110 },
        capitalSummary: {
          effectiveGridInvestUsd: 110,
          effectiveGridSlots: 250,
          capitalPerGridUsd: 0.44,
          minimumRecommendedBudgetUsd: 180,
          recommendedBudgetShortfallUsd: 60,
          initialSeedMarginUsd: 5,
          initialSeedPct: 30,
          tooManyGridsForCapital: true
        },
        safetySummary: {
          leverage: 10,
          leverageBand: "elevated",
          rangeWidthPct: 6,
          nearestBoundaryDistancePct: 1.5,
          worstCaseLiqDistancePct: 9,
          liqDistanceMinPct: 8,
          liquidationBufferPct: 1,
          liquidationStatus: "low",
          narrowRangeLowBuffer: true,
          autoMarginExpectation: "recommended"
        },
        venueChecks: { fallbackUsed: true },
        worstCaseLiqDistancePct: 9,
        liqDistanceMinPct: 8,
        warnings: [
          "too_many_grids_for_available_capital",
          "narrow_range_low_buffer",
          "auto_margin_buffer_recommended"
        ]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const req = {
      body: {
        draftTemplate: createDraftTemplatePayload(),
        previewInput: {
          exchangeAccountId: "acc_1",
          investUsd: 120,
          extraMarginUsd: 0,
          marginMode: "MANUAL",
        }
      }
    };
    const res = createMockRes("user_1");

    await handler(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.validation?.ready, true);
    assert.equal(res.body?.validation?.severity, "warning");
    assert.equal(res.body?.validation?.capital?.capitalPerGridUsd, 0.44);
    assert.equal(res.body?.validation?.capital?.recommendedBudgetShortfallUsd, 60);
    assert.equal(res.body?.validation?.safety?.liquidationStatus, "low");
    assert.equal(res.body?.validation?.safety?.venueConstraintStatus, "fallback");
    assert.equal(res.body?.status?.codes.includes("too_many_grids_for_available_capital"), true);
    assert.equal(res.body?.status?.codes.includes("reserve_below_recommended"), true);
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /admin/grid/templates/draft-preview tolerates invalid optional venue constraints", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    resolveVenueContext: async () => ({
      markPrice: 45000,
      marketDataVenue: "paper",
      venueConstraints: {
        minQty: -1,
        qtyStep: 0.001,
        priceTick: 0.1,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
    }
  };

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/admin/grid/templates/draft-preview");
  const req = {
    body: {
      draftTemplate: createDraftTemplatePayload(),
      previewInput: {
        exchangeAccountId: "acc_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "MANUAL"
      }
    }
  };
  const res = createMockRes("user_1");
  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_invalid_constraints_tolerated",
    ok: true,
    payload: {
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 100,
      minInvestmentBreakdown: { long: 100, short: 0, seed: 0, total: 100 },
      liqEstimateLong: 47000,
      liqEstimateShort: null,
      worstCaseLiqDistancePct: 30,
      liqDistanceMinPct: 8,
      warnings: [],
      allocationBreakdown: { effectiveGridInvestUsd: 240 },
      qtyModel: { qtyPerOrder: 0.01 },
      windowMeta: { activeOrdersTotal: 10, activeBuys: 5, activeSells: 5, windowLowerIdx: 0, windowUpperIdx: 9 },
      venueChecks: { fallbackUsed: true },
      profitPerGridEstimateUSDT: 0.02
    }
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;

  try {
    await handler(req as any, res as any);
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.warnings), true);
});

test("POST /admin/grid/templates/draft-preview forwards crossSideConfig for cross mode", async () => {
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
  let capturedCrossSideConfig: any = null;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    capturedCrossSideConfig = body?.payload?.crossSideConfig ?? body?.crossSideConfig ?? null;
    return new Response(JSON.stringify({
      protocolVersion: "grid.v2",
      requestId: "req_cross",
      ok: true,
      payload: {
        perGridQty: 0.001,
        perGridNotional: 10,
        profitPerGridNetPct: 0.2,
        profitPerGridNetUsd: 0.02,
        minInvestmentUSDT: 120,
        minInvestmentBreakdown: { long: 60, short: 60, total: 120 },
        qtyModel: { mode: "EQUAL_NOTIONAL_PER_GRID", qtyPerOrder: 0.001 },
        allocationBreakdown: { slotsLong: 6, slotsShort: 9 },
        worstCaseLiqDistancePct: 12,
        liqDistanceMinPct: 8,
        liqEstimateLong: 65000,
        liqEstimateShort: 75000,
        warnings: []
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const req = {
      body: {
        draftTemplate: createDraftTemplatePayload({
          mode: "cross",
          crossSideConfig: {
            long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
            short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 },
          },
          lowerPrice: 50000,
          upperPrice: 90000,
          gridCount: 9,
        }),
        previewInput: {
          exchangeAccountId: "acc_1",
          investUsd: 300,
          extraMarginUsd: 0,
          marginMode: "MANUAL",
        }
      }
    };
    const res = createMockRes("user_1");

    await handler(req as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedCrossSideConfig, {
      long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 },
    });
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

test("POST /admin/grid/templates/draft-preview allows hyperliquid admin preview accounts", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  ctx.deps.db.exchangeAccount = {
    async findFirst() {
      return { id: "acc_hl_1", userId: "user_1", exchange: "hyperliquid", label: "HL Demo" };
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
        draftTemplate: createDraftTemplatePayload(),
        previewInput: {
          exchangeAccountId: "acc_hl_1",
          investUsd: 300,
          marginMode: "AUTO"
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

test("GET /admin/grid/templates bypasses product gate for admin backend users", async () => {
  const app = createFakeApp();
  const ctx = createDeps({
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.grid_bots": false
      }
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) =>
      capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    hasAdminBackendAccess: async () => true,
    requireSuperadmin: async () => true
  });

  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/admin/grid/templates");
  const res = createMockRes("user_1");

  await handler({ query: {} } as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.length, 1);
});

test("GET /grid/pilot-access returns allowlisted access", async () => {
  const base = createDeps();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      globalSetting: {
        async findUnique(args: any) {
          const key = String(args?.where?.key ?? "");
          if (key === "admin.gridHyperliquidPilot.v1") {
            return {
              value: {
                enabled: true,
                allowedUserIds: ["user_1"],
                allowedWorkspaceIds: []
              },
              updatedAt: new Date("2026-03-09T12:00:00.000Z")
            };
          }
          return null;
        }
      }
    }
  });
  const app = createFakeApp();
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/pilot-access");
  const res = createMockRes("user_1");

  await handler({} as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    allowed: true,
    reason: "allowlist",
    scope: "user",
    provider: "mock",
    allowLiveHyperliquid: false
  });
});

test("GET /grid/templates returns filtered catalog items with favorite state", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      gridBotTemplate: {
        async findMany() {
          return [
            createPublishedTemplateRow({
              id: "tpl_match",
              name: "Balanced Momentum",
              catalogCategory: "Trend",
              catalogTags: ["swing", "featured"],
              catalogDifficulty: "ADVANCED",
              catalogRiskLevel: "HIGH",
              catalogFeatured: true,
              favorites: [{ userId: "user_1" }]
            }),
            createPublishedTemplateRow({
              id: "tpl_other",
              name: "Mean Reversion",
              catalogCategory: "Reversion",
              catalogTags: ["range"],
              catalogDifficulty: "BEGINNER",
              catalogRiskLevel: "LOW",
              catalogFeatured: false,
              favorites: []
            })
          ];
        }
      }
    }
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/templates");
  const res = createMockRes("user_1");

  await handler({
    query: {
      search: "balanced",
      category: "Trend",
      tag: "swing",
      difficulty: "ADVANCED",
      risk: "HIGH",
      featured: "true",
      favoritesOnly: "true"
    }
  } as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.id, "tpl_match");
  assert.equal(res.body?.items?.[0]?.isFavorite, true);
});

test("GET /grid/templates/filters returns distinct non-empty catalog values", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      gridBotTemplate: {
        async findMany() {
          return [
            createPublishedTemplateRow({
              id: "tpl_1",
              catalogCategory: "Trend",
              catalogTags: ["swing", "btc"],
              catalogDifficulty: "BEGINNER",
              catalogRiskLevel: "MEDIUM"
            }),
            createPublishedTemplateRow({
              id: "tpl_2",
              catalogCategory: "Trend",
              catalogTags: ["btc", "breakout"],
              catalogDifficulty: "ADVANCED",
              catalogRiskLevel: "HIGH"
            }),
            createPublishedTemplateRow({
              id: "tpl_3",
              catalogCategory: null,
              catalogTags: [],
              catalogDifficulty: "EXPERT",
              catalogRiskLevel: "LOW"
            })
          ];
        }
      }
    }
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "get", "/grid/templates/filters");
  const res = createMockRes("user_1");

  await handler({ query: {} } as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    categories: ["Trend"],
    tags: ["breakout", "btc", "swing"],
    difficulties: ["ADVANCED", "BEGINNER", "EXPERT"],
    risks: ["HIGH", "LOW", "MEDIUM"]
  });
});

test("POST and DELETE /grid/templates/:id/favorite are idempotent", async () => {
  const app = createFakeApp();
  const ctx = createDeps();
  registerGridRoutes(app as any, ctx.deps as any);
  const addHandler = getFinalHandler(app, "post", "/grid/templates/:id/favorite");
  const removeHandler = getFinalHandler(app, "delete", "/grid/templates/:id/favorite");
  const resAddFirst = createMockRes("user_1");
  const resAddSecond = createMockRes("user_1");
  const resDelete = createMockRes("user_1");
  const req = { params: { id: "tpl_1" } };

  await addHandler(req as any, resAddFirst as any);
  await addHandler(req as any, resAddSecond as any);
  await removeHandler(req as any, resDelete as any);

  assert.equal(resAddFirst.statusCode, 200);
  assert.deepEqual(resAddFirst.body, { ok: true, isFavorite: true, templateId: "tpl_1" });
  assert.equal(resAddSecond.statusCode, 200);
  assert.deepEqual(resAddSecond.body, { ok: true, isFavorite: true, templateId: "tpl_1" });
  assert.equal(resDelete.statusCode, 200);
  assert.deepEqual(resDelete.body, { ok: true, isFavorite: false, templateId: "tpl_1" });
});

test("POST /grid/templates/:id/instance-preview blocks hyperliquid for non-allowlisted users", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper HL" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow();
        }
      }
    },
    resolveVenueContext: async () => ({
      markPrice: 67000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instance-preview");
  const res = createMockRes("user_1");

  await handler({
    params: { id: "tpl_1" },
    body: {
      exchangeAccountId: "acc_1",
      investUsd: 300,
      extraMarginUsd: 0,
      marginMode: "AUTO",
      autoMarginEnabled: true
    }
  } as any, res as any);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, "grid_hyperliquid_pilot_required");
  assert.equal(res.body?.allowed, false);
  assert.equal(res.body?.marketDataVenue, "hyperliquid");
});

test("POST /grid/templates/:id/instance-preview allows hyperliquid for allowlisted users", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      globalSetting: {
        async findUnique(args: any) {
          const key = String(args?.where?.key ?? "");
          if (key === "admin.gridHyperliquidPilot.v1") {
            return {
              value: {
                enabled: true,
                allowedUserIds: ["user_1"],
                allowedWorkspaceIds: []
              },
              updatedAt: new Date("2026-03-09T12:00:00.000Z")
            };
          }
          return null;
        }
      },
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper HL" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow();
        }
      }
    },
    resolveVenueContext: async () => ({
      markPrice: 67000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instance-preview");

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
      minInvestmentUSDT: 100,
      minInvestmentBreakdown: { long: 100, short: 0, seed: 1, total: 100 },
      liqEstimateLong: 47000,
      liqEstimateShort: null,
      worstCaseLiqDistancePct: 30,
      liqDistanceMinPct: 8,
      warnings: [],
      allocationBreakdown: { effectiveGridInvestUsd: 240 },
      qtyModel: { qtyPerOrder: 0.01 },
      windowMeta: { activeOrdersTotal: 100, activeBuys: 50, activeSells: 50, windowLowerIdx: 20, windowUpperIdx: 120 },
      venueChecks: { fallbackUsed: false },
      profitPerGridEstimateUSDT: 0.02
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const res = createMockRes("user_1");
    await handler({
      params: { id: "tpl_1" },
      body: {
        exchangeAccountId: "acc_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "AUTO",
        autoMarginEnabled: true
      }
    } as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.marketDataVenue, "hyperliquid");
    assert.deepEqual(res.body?.pilotAccess, {
      allowed: true,
      reason: "allowlist",
      scope: "user",
      provider: "mock",
      allowLiveHyperliquid: false
    });
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /grid/templates/:id/instance-preview forwards crossSideConfig to python preview", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow({
            mode: "cross",
            lowerPrice: 50000,
            upperPrice: 90000,
            gridCount: 9,
            crossLongLowerPrice: 50000,
            crossLongUpperPrice: 65000,
            crossLongGridCount: 6,
            crossShortLowerPrice: 70000,
            crossShortUpperPrice: 90000,
            crossShortGridCount: 9,
          });
        }
      }
    }
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instance-preview");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  let capturedCrossSideConfig: any = null;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    capturedCrossSideConfig = body?.payload?.crossSideConfig ?? body?.crossSideConfig ?? null;
    return new Response(JSON.stringify({
      protocolVersion: "grid.v2",
      requestId: "req_inst_preview_cross",
      ok: true,
      payload: {
        perGridQty: 0.001,
        perGridNotional: 10,
        profitPerGridNetPct: 0.2,
        profitPerGridNetUsd: 0.02,
        minInvestmentUSDT: 100,
        minInvestmentBreakdown: { long: 50, short: 50, seed: 0, total: 100 },
        liqEstimateLong: 47000,
        liqEstimateShort: 93000,
        worstCaseLiqDistancePct: 30,
        liqDistanceMinPct: 8,
        warnings: [],
        allocationBreakdown: { effectiveGridInvestUsd: 240 },
        qtyModel: { qtyPerOrder: 0.01 },
        windowMeta: { activeOrdersTotal: 15, activeBuys: 6, activeSells: 9, windowLowerIdx: 0, windowUpperIdx: 14 },
        venueChecks: { fallbackUsed: false },
        profitPerGridEstimateUSDT: 0.02
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;

  try {
    const res = createMockRes("user_1");
    await handler({
      params: { id: "tpl_1" },
      body: {
        exchangeAccountId: "acc_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "MANUAL",
        autoMarginEnabled: false
      }
    } as any, res as any);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedCrossSideConfig, {
      long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 },
    });
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /grid/templates/:id/instances blocks hyperliquid for non-allowlisted users", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper HL" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow();
        }
      }
    },
    resolveVenueContext: async () => ({
      markPrice: 67000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");
  const res = createMockRes("user_1");

  await handler({
    params: { id: "tpl_1" },
    body: {
      exchangeAccountId: "acc_1",
      investUsd: 300,
      extraMarginUsd: 0,
      marginMode: "AUTO",
      autoMarginEnabled: true
    }
  } as any, res as any);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, "grid_hyperliquid_pilot_required");
});

test("POST /grid/templates/:id/instances allows hyperliquid for allowlisted users during create+start", async () => {
  const base = createDeps();
  const app = createFakeApp();
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      globalSetting: {
        async findUnique(args: any) {
          const key = String(args?.where?.key ?? "");
          if (key === "admin.gridHyperliquidPilot.v1") {
            return {
              value: {
                enabled: true,
                allowedUserIds: ["user_1"],
                allowedWorkspaceIds: []
              },
              updatedAt: new Date("2026-03-09T12:00:00.000Z")
            };
          }
          return null;
        }
      },
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper HL" };
        }
      },
      workspaceMember: {
        async findFirst() {
          return { workspaceId: "ws_1" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow();
        }
      },
      async $transaction(input: any) {
        if (typeof input === "function") {
          return input({
            bot: {
              async create() {
                return { id: "bot_created", futuresConfig: {} };
              }
            },
            gridBotInstance: {
              async create() {
                return { id: "grid_created" };
              }
            }
          });
        }
        return null;
      }
    },
    resolveVenueContext: async () => ({
      markPrice: 67000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_inst_create_hl",
    ok: true,
    payload: {
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 100,
      minInvestmentBreakdown: { long: 100, short: 0, seed: 0, total: 100 },
      liqEstimateLong: 47000,
      liqEstimateShort: null,
      worstCaseLiqDistancePct: 30,
      liqDistanceMinPct: 8,
      warnings: [],
      allocationBreakdown: { effectiveGridInvestUsd: 240 },
      qtyModel: { qtyPerOrder: 0.01 },
      windowMeta: { activeOrdersTotal: 10, activeBuys: 5, activeSells: 5, windowLowerIdx: 0, windowUpperIdx: 9 },
      venueChecks: { fallbackUsed: false },
      profitPerGridEstimateUSDT: 0.02
    }
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;

  try {
    const res = createMockRes("user_1");
    await handler({
      params: { id: "tpl_1" },
      body: {
        exchangeAccountId: "acc_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "AUTO",
        autoMarginEnabled: true,
        name: "HL Allowlisted"
      }
    } as any, res as any);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.state, "running");
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /grid/templates/:id/instances returns pending onchain provisioning payload for hypervault live create", async () => {
  const base = createDeps();
  const app = createFakeApp();
  let createdGridInstanceId = "grid_created_live";
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      globalSetting: {
        async findUnique(args: any) {
          const key = String(args?.where?.key ?? "");
          if (key === "admin.gridHyperliquidPilot.v1") {
            return {
              value: {
                enabled: true,
                allowedUserIds: ["user_1"],
                allowedWorkspaceIds: []
              },
              updatedAt: new Date("2026-03-09T12:00:00.000Z")
            };
          }
          if (key === "admin.vaultExecutionProvider.v1") {
            return {
              value: { provider: "hyperliquid" },
              updatedAt: new Date("2026-03-09T12:00:00.000Z")
            };
          }
          return null;
        }
      },
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_hl_1", userId: "user_1", exchange: "hyperliquid", label: "HyperVault Live" };
        }
      },
      workspaceMember: {
        async findFirst() {
          return { workspaceId: "ws_1" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow();
        }
      },
      gridBotInstance: {
        async findFirst() {
          return {
            id: createdGridInstanceId,
            workspaceId: "ws_1",
            userId: "user_1",
            exchangeAccountId: "acc_hl_1",
            templateId: "tpl_1",
            botId: "bot_created_live",
            state: "created",
            investUsd: 240,
            leverage: 3,
            extraMarginUsd: 60,
            triggerPrice: null,
            slippagePct: 0.1,
            tpPct: null,
            slPrice: null,
            autoMarginEnabled: false,
            marginMode: "MANUAL",
            allocationMode: "EQUAL_NOTIONAL_PER_GRID",
            budgetSplitPolicy: "FIXED_50_50",
            longBudgetPct: 50,
            shortBudgetPct: 50,
            stateJson: {
              provisioning: {
                phase: "pending_signature",
                reason: "awaiting_wallet_signature",
                pendingActionId: "act_hl_create"
              }
            },
            metricsJson: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            template: createPublishedTemplateRow(),
            bot: {
              id: "bot_created_live",
              name: "HL Live Bot",
              symbol: "BTCUSDT",
              exchange: "hyperliquid",
              status: "stopped",
              futuresConfig: {},
              runtime: null,
              exchangeAccount: {
                id: "acc_hl_1",
                exchange: "hyperliquid",
                label: "HyperVault Live"
              }
            }
          };
        },
        async create() {
          return { id: createdGridInstanceId, investUsd: 240, extraMarginUsd: 60 };
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_created_live",
              userId: "user_1",
              masterVaultId: "mv_1",
              gridInstanceId: createdGridInstanceId,
              principalAllocated: 0,
              principalReturned: 0,
              allocatedUsd: 0,
              realizedGrossUsd: 0,
              realizedFeesUsd: 0,
              realizedNetUsd: 0,
              profitShareAccruedUsd: 0,
              withdrawnUsd: 0,
              availableUsd: 0,
              executionProvider: "hyperliquid",
              executionUnitId: "exec_unit_live",
              executionStatus: "created",
              executionLastSyncedAt: null,
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadata: {
                providerState: {
                  marketDataExchange: "hyperliquid",
                  lastAction: "createBotVaultPrepared"
                }
              },
              onchainActions: [
                {
                  actionKey: "grid:create_bot_vault:grid_created_live:key_live",
                  actionType: "create_bot_vault",
                  status: "prepared",
                  updatedAt: new Date()
                }
              ],
              status: "ACTIVE",
              updatedAt: new Date()
            }
          ];
        },
        async findUnique() {
          return null;
        }
      },
      async $transaction(input: any) {
        if (typeof input === "function") {
          return input({
            bot: {
              async create() {
                return { id: "bot_created_live", futuresConfig: {} };
              },
              async deleteMany() {
                return { count: 0 };
              }
            },
            gridBotInstance: {
              async create() {
                return { id: createdGridInstanceId, investUsd: 240, extraMarginUsd: 60 };
              },
              async update() {
                return {};
              }
            },
            botVault: {
              async update() {
                return {};
              },
              async findUnique() {
                return { executionMetadata: { providerState: { marketDataExchange: "hyperliquid" } } };
              }
            },
            onchainAction: {
              async deleteMany() {
                return { count: 0 };
              }
            },
            botRuntime: {
              async deleteMany() {
                return { count: 0 };
              }
            },
            futuresBotConfig: {
              async deleteMany() {
                return { count: 0 };
              }
            }
          });
        }
        return null;
      }
    },
    vaultService: {
      ...base.deps.vaultService,
      ensureBotVaultForGridInstance: async () => ({ id: "bv_created_live" })
    },
    onchainActionService: {
      async buildCreateBotVault() {
        return {
          mode: "onchain_live",
          action: {
            id: "act_hl_create",
            actionType: "create_bot_vault",
            status: "prepared"
          },
          txRequest: {
            to: "0x1111111111111111111111111111111111111111",
            data: "0x1234",
            value: "0",
            chainId: 999
          }
        };
      }
    },
    resolveVenueContext: async () => ({
      markPrice: 67000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: null,
        qtyStep: null,
        priceTick: null,
        minNotional: 5,
        feeRate: 0.06
      },
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    })
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_inst_create_hl_live",
    ok: true,
    payload: {
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 100,
      minInvestmentBreakdown: { long: 100, short: 0, seed: 0, total: 100 },
      liqEstimateLong: 47000,
      liqEstimateShort: null,
      worstCaseLiqDistancePct: 30,
      liqDistanceMinPct: 8,
      warnings: [],
      allocationBreakdown: { effectiveGridInvestUsd: 240 },
      qtyModel: { qtyPerOrder: 0.01 },
      windowMeta: { activeOrdersTotal: 10, activeBuys: 5, activeSells: 5, windowLowerIdx: 0, windowUpperIdx: 9 },
      venueChecks: { fallbackUsed: false },
      profitPerGridEstimateUSDT: 0.02
    }
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;

  try {
    const res = createMockRes("user_1");
    await handler({
      params: { id: "tpl_1" },
      body: {
        exchangeAccountId: "acc_hl_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "AUTO",
        autoMarginEnabled: true,
        name: "HL Live Create",
        idempotencyKey: "create_live_key"
      }
    } as any, res as any);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.instance?.id, "grid_created_live");
    assert.equal(res.body?.instance?.state, "created");
    assert.equal(res.body?.provisioningStatus?.phase, "pending_signature");
    assert.equal(res.body?.onchainAction?.actionType, "create_bot_vault");
    assert.equal(res.body?.txRequest?.to, "0x1111111111111111111111111111111111111111");
    assert.equal(ctx.lifecycleCalls.length, 0);
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("POST /grid/templates/:id/instances stores crossSideConfig in bot params", async () => {
  const base = createDeps();
  const app = createFakeApp();
  let createdBotParamsJson: any = null;
  const ctx = createDeps({
    db: {
      ...base.deps.db,
      exchangeAccount: {
        async findFirst() {
          return { id: "acc_1", userId: "user_1", exchange: "paper", label: "Paper" };
        }
      },
      workspaceMember: {
        async findFirst() {
          return { workspaceId: "ws_1" };
        }
      },
      gridBotTemplate: {
        async findFirst() {
          return createPublishedTemplateRow({
            mode: "cross",
            lowerPrice: 50000,
            upperPrice: 90000,
            gridCount: 9,
            crossLongLowerPrice: 50000,
            crossLongUpperPrice: 65000,
            crossLongGridCount: 6,
            crossShortLowerPrice: 70000,
            crossShortUpperPrice: 90000,
            crossShortGridCount: 9,
          });
        }
      },
      async $transaction(input: any) {
        if (typeof input === "function") {
          return input({
            bot: {
              async create(args: any) {
                createdBotParamsJson = args?.data?.futuresConfig?.create?.paramsJson ?? null;
                return { id: "bot_created", futuresConfig: {} };
              }
            },
            gridBotInstance: {
              async create() {
                return { id: "grid_created" };
              }
            }
          });
        }
        return null;
      }
    }
  });
  registerGridRoutes(app as any, ctx.deps as any);
  const handler = getFinalHandler(app, "post", "/grid/templates/:id/instances");

  const previousEnabled = process.env.PY_GRID_ENABLED;
  const previousUrl = process.env.PY_GRID_URL;
  const previousFetch = globalThis.fetch;
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://py-strategy.local";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_inst_create_cross",
    ok: true,
    payload: {
      perGridQty: 0.001,
      perGridNotional: 10,
      profitPerGridNetPct: 0.2,
      profitPerGridNetUsd: 0.02,
      minInvestmentUSDT: 100,
      minInvestmentBreakdown: { long: 50, short: 50, seed: 0, total: 100 },
      liqEstimateLong: 47000,
      liqEstimateShort: 93000,
      worstCaseLiqDistancePct: 30,
      liqDistanceMinPct: 8,
      warnings: [],
      allocationBreakdown: { effectiveGridInvestUsd: 240 },
      qtyModel: { qtyPerOrder: 0.01 },
      windowMeta: { activeOrdersTotal: 15, activeBuys: 6, activeSells: 9, windowLowerIdx: 0, windowUpperIdx: 14 },
      venueChecks: { fallbackUsed: false },
      profitPerGridEstimateUSDT: 0.02
    }
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;

  try {
    const res = createMockRes("user_1");
    await handler({
      params: { id: "tpl_1" },
      body: {
        exchangeAccountId: "acc_1",
        investUsd: 300,
        extraMarginUsd: 0,
        marginMode: "MANUAL",
        autoMarginEnabled: false,
        name: "Cross Bot"
      }
    } as any, res as any);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(createdBotParamsJson?.grid?.crossSideConfig, {
      long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 },
    });
  } finally {
    process.env.PY_GRID_ENABLED = previousEnabled;
    process.env.PY_GRID_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

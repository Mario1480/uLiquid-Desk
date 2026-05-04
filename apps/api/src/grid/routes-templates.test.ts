import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { registerGridTemplateRoutes } from "./routes-templates.js";
import { ManualTradingError } from "../trading.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();
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
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "put" | "delete", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function buildReadyComputed() {
  return {
    markPrice: 100000,
    minInvestmentUSDT: 20,
    minInvestmentBreakdown: {
      long: 10,
      short: 10,
      seed: 5,
      total: 20
    },
    initialSeed: {
      enabled: true,
      seedPct: 30,
      seedSide: "buy",
      seedQty: 0.001,
      seedNotionalUsd: 30,
      seedMarginUsd: 10,
      seedMinMarginUsd: 5
    },
    allocation: {
      totalBudgetUsd: 300,
      gridInvestUsd: 210,
      extraMarginUsd: 90,
      splitMode: "auto_liq_guard_dynamic",
      policy: "LIQ_GUARD_MAX_GRID",
      targetLiqDistancePct: 30,
      searchIterationsUsed: 2,
      insufficient: false,
      reasonCodes: []
    },
    preview: {
      warnings: [],
      validationErrors: [],
      profitPerGridEstimateUSDT: 1.25,
      liqEstimateLong: 78000,
      liqEstimateShort: 122000,
      worstCaseLiqPrice: 78000,
      worstCaseLiqDistancePct: 22,
      liqDistanceMinPct: 8,
      capitalSummary: {},
      safetySummary: {},
      allocationBreakdown: {},
      qtyModel: {},
      windowMeta: {},
      venueChecks: {}
    },
    warnings: [],
    venueContext: {
      markPrice: 100000,
      marketDataVenue: "paper",
      constraintSource: "live",
      venueConstraints: {},
      feeBufferPct: 1,
      mmrPct: 0.75,
      liqDistanceMinPct: 8,
      warnings: []
    }
  };
}

function createShared() {
  const templateSchema = z.object({
    name: z.string(),
    description: z.string().nullable().optional(),
    symbol: z.string(),
    mode: z.enum(["long", "short", "neutral", "cross"]),
    gridMode: z.enum(["arithmetic", "geometric"]),
    lowerPrice: z.number(),
    upperPrice: z.number(),
    gridCount: z.number(),
    leverageDefault: z.number(),
    templateVisibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
    creatorProfitSharePct: z.number().min(0).max(25).default(0)
  }).passthrough();

  return {
    allowedGridExchanges: new Set(["paper", "binance"]),
    async requireGridFeatureEnabledOrRespond() {
      return true;
    },
    async requireGridCapabilityOrRespond() {
      return true;
    },
    isMissingTableError() {
      return false;
    },
    normalizeTemplateSymbol(value: unknown) {
      return String(value ?? "").trim().toUpperCase();
    },
    normalizeTemplatePolicyInput(value: Record<string, unknown>) {
      return value;
    },
    gridTemplateCreateSchema: templateSchema,
    gridTemplateListQuerySchema: z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      difficulty: z.string().optional(),
      risk: z.string().optional(),
      featured: z.coerce.boolean().optional(),
      favoritesOnly: z.coerce.boolean().optional(),
      ownOnly: z.coerce.boolean().optional()
    }),
    gridTemplateUpdateSchema: templateSchema.partial(),
    gridTemplateDraftPreviewSchema: z.object({}).passthrough(),
    gridTemplatePreviewSchema: z.object({}).passthrough(),
    toGridTemplatePersistence(value: Record<string, unknown>) {
      return { ...value };
    },
    mapGridTemplateRow(row: any) {
      return {
        ...row,
        isFavorite: Array.isArray(row.favorites) ? row.favorites.length > 0 : Boolean(row.isFavorite),
        isOwnTemplate: Boolean(row.isOwnTemplate)
      };
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
    decorateGridTemplateRowForUser(row: any, userId: string) {
      return {
        ...row,
        isOwnTemplate: String(row.createdByUserId ?? "") === userId
      };
    },
    mapDraftTemplateToPreviewContext(value: Record<string, unknown>) {
      return { ...value };
    },
    isTemplatePolicyImplemented() {
      return true;
    },
    async getGridHyperliquidExecutionContext() {
      return { allowLiveHyperliquid: false, provider: "mock" };
    },
    ensureGridExchangeAllowed({ exchange, allowedExchanges }: any) {
      const normalized = String(exchange ?? "").trim().toLowerCase();
      return allowedExchanges.has(normalized)
        ? { ok: true, exchange: normalized, allowedExchanges: [...allowedExchanges] }
        : { ok: false, exchange: normalized, allowedExchanges: [...allowedExchanges] };
    },
    isAdminGridDraftPreviewExchangeAllowed() {
      return true;
    }
  };
}

function createValidBody(overrides: Record<string, unknown> = {}) {
  return {
    draftTemplate: {
      name: "My BTC Grid",
      description: "Private test template",
      symbol: "btcusdt",
      mode: "neutral",
      gridMode: "arithmetic",
      lowerPrice: 90000,
      upperPrice: 110000,
      gridCount: 40,
      leverage: 5,
      tpDefaultPct: 3,
      slDefaultPrice: 80000,
      creatorProfitSharePct: 12.5,
      ...((overrides.draftTemplate as Record<string, unknown>) ?? {})
    },
    previewInput: {
      exchangeAccountId: "acc_1",
      investUsd: 300,
      extraMarginUsd: 0,
      marginMode: "AUTO",
      autoMarginEnabled: true,
      ...((overrides.previewInput as Record<string, unknown>) ?? {})
    }
  };
}

function createDeps(captured: { createdData?: any; catalogWhere?: any } = {}) {
  return {
    ManualTradingError,
    requireSuperadmin: async () => true,
    resolveGridHyperliquidPilotAccess: async () => ({ allowed: false, reason: "disabled", scope: "none" }),
    resolveVenueContext: async () => ({}),
    computeGridPreviewAndAllocation: async () => buildReadyComputed(),
    db: {
      exchangeAccount: {
        async findFirst(args: any) {
          assert.equal(args.where.userId, "user_1");
          return { id: args.where.id, userId: args.where.userId, exchange: "paper" };
        }
      },
      workspaceMember: {
        async findFirst(args: any) {
          assert.equal(args.where.userId, "user_1");
          return { workspaceId: "ws_1" };
        }
      },
      gridBotTemplate: {
        async create(args: any) {
          captured.createdData = args.data;
          return {
            id: "tpl_user_1",
            ...args.data,
            favorites: [],
            createdAt: new Date("2026-05-04T10:00:00.000Z"),
            updatedAt: new Date("2026-05-04T10:00:00.000Z")
          };
        },
        async findMany(args: any) {
          captured.catalogWhere = args.where;
          return [
            {
              id: "tpl_public",
              name: "Public",
              symbol: "BTCUSDT",
              mode: "long",
              gridMode: "arithmetic",
              templateVisibility: "PUBLIC",
              createdByUserId: "admin_1",
              catalogTags: [],
              isPublished: true,
              isArchived: false,
              favorites: []
            },
            {
              id: "tpl_own",
              name: "Own",
              symbol: "ETHUSDT",
              mode: "neutral",
              gridMode: "geometric",
              templateVisibility: "PRIVATE",
              createdByUserId: "user_1",
              catalogTags: [],
              isPublished: true,
              isArchived: false,
              favorites: []
            }
          ];
        },
        async findFirst(args: any) {
          captured.catalogWhere = args.where;
          if (args.where?.id === "tpl_other") return null;
          return { id: args.where?.id ?? "tpl_1", isPublished: true, isArchived: false, templateVisibility: "PUBLIC" };
        }
      },
      gridTemplateFavorite: {
        async create() {
          return {};
        },
        async deleteMany() {
          return { count: 1 };
        }
      }
    }
  };
}

test("POST /grid/templates creates a private user template with server defaults after preview", async () => {
  const app = createFakeApp();
  const captured: { createdData?: any } = {};
  registerGridTemplateRoutes(app as any, createDeps(captured), createShared());

  const handler = getFinalHandler(app, "post", "/grid/templates");
  const res = createMockRes();
  await handler({ body: createValidBody() }, res);

  assert.equal(res.statusCode, 201);
  assert.ok(captured.createdData);
  const createdData = captured.createdData;
  assert.equal(createdData.workspaceId, "ws_1");
  assert.equal(createdData.createdByUserId, "user_1");
  assert.equal(createdData.isPublished, true);
  assert.equal(createdData.isArchived, false);
  assert.equal(createdData.templateVisibility, "PRIVATE");
  assert.equal(createdData.creatorProfitSharePct, 12.5);
  assert.equal(createdData.symbol, "BTCUSDT");
  assert.equal(createdData.mode, "neutral");
  assert.equal(createdData.marginPolicy, "AUTO_ALLOWED");
  assert.equal(createdData.autoReservePolicy, "LIQ_GUARD_MAX_GRID");
  assert.equal(createdData.autoReserveFixedGridPct, 70);
  assert.equal(createdData.autoReserveTargetLiqDistancePct, 30);
  assert.equal(createdData.autoReserveMaxPreviewIterations, 12);
  assert.equal(createdData.allocationMode, "EQUAL_NOTIONAL_PER_GRID");
  assert.equal(createdData.budgetSplitPolicy, "FIXED_50_50");
  assert.equal(createdData.initialSeedPct, 30);
  assert.equal(createdData.activeOrderWindowSize, 100);
  assert.equal(createdData.recenterDriftLevels, 1);
  assert.equal(createdData.leverageMin, 5);
  assert.equal(createdData.leverageMax, 5);
  assert.equal(createdData.leverageDefault, 5);
  assert.equal(res.body.isOwnTemplate, true);
});

test("POST /grid/templates rejects cross mode and profitshare above 25", async () => {
  const app = createFakeApp();
  registerGridTemplateRoutes(app as any, createDeps(), createShared());
  const handler = getFinalHandler(app, "post", "/grid/templates");

  const crossRes = createMockRes();
  await handler({ body: createValidBody({ draftTemplate: { mode: "cross" } }) }, crossRes);
  assert.equal(crossRes.statusCode, 400);
  assert.equal(crossRes.body.error, "invalid_payload");

  const shareRes = createMockRes();
  await handler({ body: createValidBody({ draftTemplate: { creatorProfitSharePct: 25.01 } }) }, shareRes);
  assert.equal(shareRes.statusCode, 400);
  assert.equal(shareRes.body.error, "invalid_payload");
});

test("GET /grid/templates applies visibility where and ownOnly filter", async () => {
  const app = createFakeApp();
  const captured: { catalogWhere?: any } = {};
  registerGridTemplateRoutes(app as any, createDeps(captured), createShared());

  const handler = getFinalHandler(app, "get", "/grid/templates");
  const res = createMockRes();
  await handler({ query: { ownOnly: "true" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.catalogWhere.OR, [
    { templateVisibility: "PUBLIC" },
    { templateVisibility: "PRIVATE", createdByUserId: "user_1" }
  ]);
  assert.deepEqual(res.body.items.map((item: any) => item.id), ["tpl_own"]);
  assert.equal(res.body.items[0].isOwnTemplate, true);
});

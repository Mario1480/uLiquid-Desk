import assert from "node:assert/strict";
import test from "node:test";
import { registerSystemRoutes, type RegisterSystemRoutesDeps } from "./routes.js";

type Handler = (...args: any[]) => any;

function createFakeApp() {
  const getRoutes = new Map<string, Handler[]>();
  const postRoutes = new Map<string, Handler[]>();
  return {
    get(path: string, ...handlers: Handler[]) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Handler[]) {
      postRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes
    }
  };
}

function createMockRes() {
  return {
    locals: {
      user: { id: "admin_1", email: "admin@example.com" }
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

function getHandlers(app: ReturnType<typeof createFakeApp>, path: string): Handler[] {
  const handlers = app.routes.get.get(path);
  if (!handlers?.length) throw new Error(`route_not_found:${path}`);
  return handlers;
}

function createDeps(overrides: Partial<RegisterSystemRoutesDeps> = {}): RegisterSystemRoutesDeps {
  const job = { getStatus: () => ({ ok: true }) };
  return {
    db: {},
    getVaultExecutionModeSettings: async () => ({ mode: "live" }),
    getVaultSafetyControlsSettings: async () => ({ killSwitch: false }),
    parseVaultSafetyControls: () => ({ killSwitch: true }),
    getRuntimeOrchestrationMode: () => "poll",
    isBillingEnabled: async () => true,
    isLicenseEnforcementEnabled: () => true,
    getQueueMetrics: async () => ({}),
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "enterprise", capabilities: {} }),
    listPluginCatalogForCapabilities: () => [],
    vaultAccountingJob: job,
    botVaultRiskJob: job,
    botVaultTradingReconciliationJob: job,
    vaultOnchainIndexerJob: job,
    vaultOnchainReconciliationJob: job,
    marketIntelligenceRefreshJob: job,
    economicCalendarDailyTelegramJob: job,
    requireSuperadmin: async () => true,
    ...overrides
  };
}

test("public health routes expose only minimal liveness", async () => {
  const app = createFakeApp();
  registerSystemRoutes(app as any, createDeps());

  for (const path of ["/health", "/healthz"]) {
    const handler = getHandlers(app, path).at(-1);
    const res = createMockRes();
    await handler?.({} as any, res as any);
    assert.deepEqual(res.body, { ok: true });
  }
});

test("admin health details stay behind auth middleware", async () => {
  const app = createFakeApp();
  registerSystemRoutes(app as any, createDeps());

  const handlers = getHandlers(app, "/admin/health/details");
  assert.equal(handlers.length, 2);

  const res = createMockRes();
  await handlers.at(-1)?.({} as any, res as any);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.service, "api");
  assert.equal(res.body?.vaultExecutionMode, "live");
  assert.deepEqual(res.body?.jobs?.vaultAccounting, { ok: true });
  assert.deepEqual(res.body?.jobs?.marketIntelligenceRefresh, { ok: true });
  assert.deepEqual(res.body?.jobs?.economicCalendarDailyTelegram, { ok: true });
});

test("public system settings omit orchestration internals", async () => {
  const app = createFakeApp();
  registerSystemRoutes(app as any, createDeps());

  const res = createMockRes();
  await getHandlers(app, "/system/settings").at(-1)?.({} as any, res as any);

  assert.deepEqual(res.body, {
    tradingEnabled: true,
    readOnlyMode: false
  });
});

test("legacy CCPayment webhook is not registered", () => {
  const app = createFakeApp();
  registerSystemRoutes(app as any, createDeps());

  assert.equal(app.routes.post.has("/webhooks/ccpayment"), false);
});

test("license state is registered as an authenticated admin route", async () => {
  let checkedAdmin = false;
  const app = createFakeApp();
  registerSystemRoutes(app as any, createDeps({
    requireSuperadmin: async () => {
      checkedAdmin = true;
      return true;
    }
  }));

  const handlers = getHandlers(app, "/license/state");
  assert.equal(handlers.length, 2);

  const res = createMockRes();
  await handlers.at(-1)?.({} as any, res as any);
  assert.equal(checkedAdmin, true);
  assert.deepEqual(res.body, {
    enforcement: "on",
    billingEnabled: "on"
  });
});

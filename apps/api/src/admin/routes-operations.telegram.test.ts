import assert from "node:assert/strict";
import test from "node:test";
import { registerAdminOperationsRoutes, resolveAdminTelegramUpdate } from "./routes-operations.js";

function createFakeApp() {
  const routes = {
    delete: new Map<string, Array<(...args: any[]) => any>>(),
    get: new Map<string, Array<(...args: any[]) => any>>(),
    post: new Map<string, Array<(...args: any[]) => any>>(),
    put: new Map<string, Array<(...args: any[]) => any>>()
  };
  return {
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.delete.set(path, handlers);
    },
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.get.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.post.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.put.set(path, handlers);
    },
    routes
  };
}

test("resolveAdminTelegramUpdate keeps existing token on chat-only updates", () => {
  const resolved = resolveAdminTelegramUpdate({
    currentToken: "existing-token",
    currentSystemChatId: "-1001",
    requestedToken: null,
    tokenProvided: true,
    requestedSystemChatId: "-1002",
    systemChatIdProvided: true,
    clearConfig: false
  });

  assert.deepEqual(resolved, {
    token: "existing-token",
    systemTelegramChatId: "-1002"
  });
});

test("resolveAdminTelegramUpdate clears the full config when requested", () => {
  const resolved = resolveAdminTelegramUpdate({
    currentToken: "existing-token",
    currentSystemChatId: "-1001",
    requestedToken: "new-token",
    tokenProvided: true,
    requestedSystemChatId: "-1002",
    systemChatIdProvided: true,
    clearConfig: true
  });

  assert.deepEqual(resolved, {
    token: null,
    systemTelegramChatId: null
  });
});

test("registerAdminOperationsRoutes leaves GET /admin/users to platform admin routes", () => {
  const app = createFakeApp();
  registerAdminOperationsRoutes(app as any, {} as any);

  assert.equal(app.routes.get.has("/admin/users"), false);
  assert.equal(app.routes.post.has("/admin/users"), true);
  assert.equal(app.routes.put.has("/admin/users/:id/password"), true);
  assert.equal(app.routes.delete.has("/admin/users/:id"), true);
});

test("venue health uses exchange option labels and product capabilities", async () => {
  const app = createFakeApp();
  const deps = {
    requireSuperadmin: async () => true,
    getAllowedExchangeValues: async () => ["hyperliquid", "paper"],
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    getRuntimeEnabledExchangeValues: () => new Set(["hyperliquid", "paper"]),
    EXCHANGE_OPTION_VALUES: new Set(["hyperliquid", "paper"]),
    getExchangeOptionsResponse: () => [
      {
        value: "hyperliquid",
        label: "Hyperliquid (Spot + Perp)",
        supportsSpotExecution: true,
        supportsPerpExecution: true
      },
      {
        value: "paper",
        label: "Paper (Spot + Perp Simulation)",
        supportsSpotExecution: true,
        supportsPerpExecution: true
      }
    ],
    db: {
      exchangeAccount: {
        findMany: async () => []
      }
    }
  };
  registerAdminOperationsRoutes(app as any, deps as any);
  const handlers = app.routes.get.get("/admin/venue-health/summary") ?? [];
  const handler = handlers.at(-1);
  let payload: any;
  await handler?.({} as any, {
    json(value: unknown) {
      payload = value;
      return value;
    }
  } as any);

  const hyperliquid = payload.items.find((item: any) => item.venue === "hyperliquid");
  const paper = payload.items.find((item: any) => item.venue === "paper");
  assert.equal(hyperliquid.label, "Hyperliquid (Spot + Perp)");
  assert.equal(hyperliquid.capabilities.supportsSpotExecution, true);
  assert.equal(hyperliquid.capabilities.supportsOrderEditing, true);
  assert.equal(paper.label, "Paper (Spot + Perp Simulation)");
  assert.equal(paper.capabilities.supportsOrderEditing, true);
});

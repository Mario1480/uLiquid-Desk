import assert from "node:assert/strict";
import test from "node:test";
import { registerVaultRoutes } from "./vaults.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  const getRoutes: RouteMap = new Map();

  return {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes,
      get: getRoutes
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "post" | "get", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("POST /vaults/master/deposit returns vault snapshot on success", async () => {
  const calls: any[] = [];
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async depositToMasterVault(input: any) {
        calls.push({ method: "deposit", input });
      },
      async getMasterVaultSummary() {
        return {
          id: "mv_1",
          userId: "user_1",
          freeBalance: 120,
          reservedBalance: 10,
          withdrawableBalance: 120
        };
      },
      async listBotVaults() {
        return [];
      },
      async listBotVaultLedger() {
        return [];
      },
      async listBotExecutionEvents() {
        return [];
      },
      async listProfitShareAccruals() {
        return [];
      },
      async validateMasterVaultWithdraw() {
        return { ok: true, reason: null, freeBalance: 0, reservedBalance: 0 };
      },
      async withdrawFromMasterVault() {
        return {};
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/master/deposit");
  const req = {
    body: {
      amountUsd: 25,
      idempotencyKey: "dep:u1:25",
      metadata: { source: "test" }
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.vault?.freeBalance, 120);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "deposit");
  assert.equal(calls[0]?.input?.idempotencyKey, "dep:u1:25");
});

test("POST /vaults/master/withdraw rejects insufficient free balance", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async depositToMasterVault() {
        return {};
      },
      async getMasterVaultSummary() {
        return {
          id: "mv_1",
          userId: "user_1"
        };
      },
      async listBotVaults() {
        return [];
      },
      async listBotVaultLedger() {
        return [];
      },
      async listBotExecutionEvents() {
        return [];
      },
      async listProfitShareAccruals() {
        return [];
      },
      async validateMasterVaultWithdraw() {
        return {
          ok: false,
          reason: "insufficient_free_balance",
          freeBalance: 5,
          reservedBalance: 20
        };
      },
      async withdrawFromMasterVault() {
        return {};
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/master/withdraw");
  const req = {
    body: {
      amountUsd: 10,
      idempotencyKey: "wd:u1:10"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "insufficient_free_balance");
  assert.equal(res.body?.freeBalance, 5);
  assert.equal(res.body?.reservedBalance, 20);
});

test("POST /vaults/master/withdraw executes on valid withdraw", async () => {
  const calls: any[] = [];
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async depositToMasterVault() {
        return {};
      },
      async getMasterVaultSummary() {
        return {
          id: "mv_1",
          userId: "user_1",
          freeBalance: 40,
          reservedBalance: 10,
          withdrawableBalance: 40
        };
      },
      async listBotVaults() {
        return [];
      },
      async listBotVaultLedger() {
        return [];
      },
      async listBotExecutionEvents() {
        return [];
      },
      async listProfitShareAccruals() {
        return [];
      },
      async validateMasterVaultWithdraw(input: any) {
        calls.push({ method: "validate", input });
        return {
          ok: true,
          reason: null,
          freeBalance: 50,
          reservedBalance: 10
        };
      },
      async withdrawFromMasterVault(input: any) {
        calls.push({ method: "withdraw", input });
        return {};
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/master/withdraw");
  const req = {
    body: {
      amountUsd: 10,
      idempotencyKey: "wd:u1:10",
      metadata: {
        note: "test"
      }
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, "validate");
  assert.equal(calls[1]?.method, "withdraw");
  assert.equal(calls[1]?.input?.idempotencyKey, "wd:u1:10");
});

test("GET /vaults/bot-vaults/:id/execution-events returns items", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async listBotExecutionEvents(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        return [{ id: "evt_1", action: "start", result: "succeeded" }];
      },
      async depositToMasterVault() {
        return {};
      },
      async getMasterVaultSummary() {
        return { id: "mv_1", userId: "user_1" };
      },
      async listBotVaults() {
        return [];
      },
      async listBotVaultLedger() {
        return [];
      },
      async listFeeEvents() {
        return [];
      },
      async listProfitShareAccruals() {
        return [];
      },
      async validateMasterVaultWithdraw() {
        return { ok: true, reason: null, freeBalance: 0, reservedBalance: 0 };
      },
      async withdrawFromMasterVault() {
        return {};
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-vaults/:id/execution-events");
  const req = {
    params: { id: "bv_1" },
    query: { limit: "50" }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.[0]?.id, "evt_1");
});

test("POST /vaults/master/create ensures and returns master vault snapshot", async () => {
  const app = createFakeApp();
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {
      async ensureMasterVaultExplicit(input: any) {
        calls.push(input);
        return {
          id: "mv_1",
          userId: "user_1",
          freeBalance: 0,
          reservedBalance: 0,
          withdrawableBalance: 0
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/master/create");
  const req = { body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.vault?.id, "mv_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userId, "user_1");
});

test("GET /vaults/bot-templates returns published copy templates", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async listCopyBotTemplates(input: any) {
        assert.equal(input.userId, "user_1");
        return [
          {
            id: "tpl_1",
            name: "BTC Grid",
            symbol: "BTCUSDT",
            isPublished: true,
            isArchived: false
          }
        ];
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-templates");
  const req = { query: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.[0]?.id, "tpl_1");
});

test("POST /vaults/bot-vaults/:id/close-only returns 404 for unknown bot vault", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async setBotVaultCloseOnly() {
        return null;
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/bot-vaults/:id/close-only");
  const req = { params: { id: "bv_missing" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error, "bot_vault_not_found");
});

test("POST /vaults/bot-vaults/:id/close-only maps invalid transition to 409", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async setBotVaultCloseOnly() {
        const error: any = new Error("risk_invalid_status_transition");
        error.code = "risk_invalid_status_transition";
        throw error;
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/bot-vaults/:id/close-only");
  const req = { params: { id: "bv_1" }, body: { reason: "manual" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "risk_invalid_status_transition");
});

test("POST /vaults/bot-vaults/:id/close-only succeeds and returns bot vault", async () => {
  const app = createFakeApp();
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {
      async setBotVaultCloseOnly(input: any) {
        calls.push(input);
        return {
          id: "bv_1",
          status: "CLOSE_ONLY"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/bot-vaults/:id/close-only");
  const req = { params: { id: "bv_1" }, body: { reason: "manual_close_only" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.botVault?.status, "CLOSE_ONLY");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userId, "user_1");
  assert.equal(calls[0]?.botVaultId, "bv_1");
});

test("GET /vaults/bot-vaults/:id/pnl-report returns report payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async getBotVaultPnlReport(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        assert.equal(input.fillsLimit, 5);
        return {
          botVaultId: "bv_1",
          isFlat: true,
          realizedPnlNet: 12.5,
          fillsPreview: []
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-vaults/:id/pnl-report");
  const req = { params: { id: "bv_1" }, query: { fillsLimit: "5" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.botVaultId, "bv_1");
  assert.equal(res.body?.isFlat, true);
});

test("GET /vaults/bot-vaults/:id/audit returns audit timeline", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async getBotVaultAudit(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        assert.equal(input.limit, 10);
        assert.equal(input.cursor, "2026-03-10T10:00:00.000Z");
        return {
          botVaultId: "bv_1",
          items: [{ id: "fill_1", kind: "fill", ts: "2026-03-10T10:00:00.000Z" }],
          nextCursor: null
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-vaults/:id/audit");
  const req = {
    params: { id: "bv_1" },
    query: {
      limit: "10",
      cursor: "2026-03-10T10:00:00.000Z"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.botVaultId, "bv_1");
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.[0]?.kind, "fill");
});

test("POST /vaults/onchain/master/create-tx returns tx request", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildCreateMasterVaultForUser(input: any) {
        assert.equal(input.userId, "user_1");
        return {
          mode: "onchain_simulated",
          action: {
            id: "act_1",
            actionType: "create_master_vault",
            status: "prepared"
          },
          txRequest: {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xdeadbeef",
            value: "0",
            chainId: 31337
          }
        };
      },
      async getMode() {
        return "onchain_simulated";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/master/create-tx");
  const req = { body: { actionKey: "ac_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.mode, "onchain_simulated");
  assert.equal(res.body?.txRequest?.chainId, 31337);
});

test("POST /vaults/onchain/actions/:id/submit-tx validates payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async submitActionTxHash() {
        return {};
      },
      async getMode() {
        return "onchain_simulated";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/actions/:id/submit-tx");
  const req = { params: { id: "act_1" }, body: { txHash: "0xabc" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "invalid_payload");
});

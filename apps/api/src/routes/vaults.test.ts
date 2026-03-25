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

test("GET /vaults/master returns summary plus execution mode", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async getMasterVaultSummary(input: any) {
        assert.equal(input.userId, "user_1");
        return {
          id: "mv_1",
          userId: "user_1",
          onchainAddress: "0x1234567890123456789012345678901234567890",
          freeBalance: 120,
          reservedBalance: 0,
          withdrawableBalance: 120,
          totalDeposited: 120,
          totalWithdrawn: 0,
          totalAllocatedUsd: 0,
          totalRealizedNetUsd: 0,
          totalProfitShareAccruedUsd: 0,
          totalWithdrawnUsd: 0,
          availableUsd: 120,
          status: "active",
          botVaultCount: 2,
          updatedAt: "2026-03-11T10:00:00.000Z"
        };
      }
    } as any,
    onchainActionService: {
      async getMode() {
        return "onchain_live";
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/master");
  const req = {};
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.id, "mv_1");
  assert.equal(res.body?.executionMode, "onchain_live");
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

test("POST /vaults/onchain/master/withdraw-tx returns tx request", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildWithdrawFromMasterVault(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.amountUsd, 12.5);
        return {
          mode: "onchain_live",
          action: {
            id: "act_wd_1",
            actionType: "withdraw_master_vault",
            status: "prepared"
          },
          txRequest: {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xdeadbeef",
            value: "0",
            chainId: 999
          }
        };
      },
      async getMode() {
        return "onchain_live";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/master/withdraw-tx");
  const req = { body: { amountUsd: 12.5, actionKey: "wd_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.mode, "onchain_live");
  assert.equal(res.body?.action?.actionType, "withdraw_master_vault");
  assert.equal(res.body?.txRequest?.chainId, 999);
});

test("POST /vaults/onchain/bot-vaults/:id/set-close-only-tx returns tx request", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildSetBotVaultCloseOnly(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        return {
          mode: "onchain_live",
          action: {
            id: "act_close_only_1",
            actionType: "set_bot_vault_close_only",
            status: "prepared"
          },
          txRequest: {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xdeadbeef",
            value: "0",
            chainId: 999
          }
        };
      },
      async getMode() {
        return "onchain_live";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/bot-vaults/:id/set-close-only-tx");
  const req = { params: { id: "bv_1" }, body: { actionKey: "co_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.action?.actionType, "set_bot_vault_close_only");
  assert.equal(res.body?.txRequest?.chainId, 999);
});

test("POST /vaults/onchain/bot-vaults/:id/close-tx maps close-only requirement to 409", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildCloseBotVault() {
        throw new Error("bot_vault_onchain_close_only_required:ACTIVE");
      },
      async getMode() {
        return "onchain_live";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/bot-vaults/:id/close-tx");
  const req = {
    params: { id: "bv_1" },
    body: { releasedReservedUsd: 240, grossReturnedUsd: 240, actionKey: "close_1" }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "onchain_close_only_required");
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

test("GET /wallet/:address/overview returns normalized wallet payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    walletReadService: {
      async getWalletOverview({ address }: any) {
        return {
          address,
          network: {
            chainId: 999,
            name: "HyperEVM",
            rpcUrl: "https://rpc.hyperliquid.xyz/evm",
            explorerUrl: "https://app.hyperliquid.xyz/explorer"
          },
          balances: {
            hype: { symbol: "HYPE", raw: "1", formatted: "0.000000000000000001", decimals: 18 },
            usdc: null
          },
          vaultSummary: { count: 1, totalEquityUsd: 42 },
          portfolio: { points: [], available: false },
          role: "follower",
          masterVault: { configured: false, address: null, usdcAddress: null },
          config: { errors: [] },
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      },
      async getWalletVaults() {
        return { address: "0x0", items: [], updatedAt: "2026-03-10T00:00:00.000Z" };
      },
      async getVaultDetails() {
        throw new Error("not_used");
      },
      async getWalletActivity() {
        return { address: "0x0", items: [], updatedAt: "2026-03-10T00:00:00.000Z" };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/wallet/:address/overview");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.address, "0x1234567890123456789012345678901234567890");
  assert.equal(res.body?.vaultSummary?.count, 1);
});

test("GET /wallet/:address/activity forwards limit to read service", async () => {
  const calls: any[] = [];
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    walletReadService: {
      async getWalletOverview() {
        throw new Error("not_used");
      },
      async getWalletVaults() {
        return { address: "0x0", items: [], updatedAt: "2026-03-10T00:00:00.000Z" };
      },
      async getVaultDetails() {
        throw new Error("not_used");
      },
      async getWalletActivity(input: any) {
        calls.push(input);
        return {
          address: input.address,
          items: [
            {
              id: "fill_1",
              type: "fill",
              symbol: "HYPE",
              side: "buy",
              size: 1,
              price: 10,
              closedPnlUsd: null,
              feeUsd: 0.1,
              timestamp: 1,
              txHash: null
            }
          ],
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/wallet/:address/activity");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    },
    query: {
      limit: "7"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]?.limit, 7);
  assert.equal(res.body?.items?.length, 1);
});

test("GET /vaults/:vaultAddress returns vault detail payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    walletReadService: {
      async getWalletOverview() {
        throw new Error("not_used");
      },
      async getWalletVaults() {
        return { address: "0x0", items: [], updatedAt: "2026-03-10T00:00:00.000Z" };
      },
      async getVaultDetails(input: any) {
        return {
          vaultAddress: input.vaultAddress,
          name: "Momentum Vault",
          leader: "0x1234567890123456789012345678901234567890",
          description: "Test vault",
          userEquityUsd: 12.5,
          userRole: "follower",
          apr: 11,
          allTimeReturnPct: 5,
          maxDrawdownPct: 2,
          tvlUsd: 1000,
          followerCount: 10,
          performance: {
            points: [{ time: 1, value: 100, pnl: 0 }],
            available: true
          },
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      },
      async getWalletActivity() {
        return { address: "0x0", items: [], updatedAt: "2026-03-10T00:00:00.000Z" };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/:vaultAddress");
  const req = {
    params: {
      vaultAddress: "0x1234567890123456789012345678901234567890"
    },
    query: {
      user: "0x1111111111111111111111111111111111111111"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.name, "Momentum Vault");
  assert.equal(res.body?.performance?.available, true);
});

test("GET /funding/:address/overview returns aggregated funding payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    fundingReadService: {
      async getFundingOverview(input: any) {
        return {
          address: input.address,
          arbitrum: {
            location: "arbitrum",
            chainId: 42161,
            networkName: "Arbitrum",
            rpcUrl: "https://arb1.arbitrum.io/rpc",
            explorerUrl: "https://arbiscan.io",
            address: input.address,
            eth: { symbol: "ETH", decimals: 18, raw: "1", formatted: "0.000000000000000001", state: "available", available: true, reason: null },
            usdc: { symbol: "USDC", decimals: 6, raw: "1000000", formatted: "1", state: "available", available: true, reason: null },
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          hyperCore: {
            location: "hyperCore",
            address: input.address,
            source: "spotClearinghouseState",
            available: true,
            reason: null,
            usdc: { symbol: "USDC", decimals: 6, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            hype: { symbol: "HYPE", decimals: 18, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          hyperEvm: {
            location: "hyperEvm",
            chainId: 999,
            networkName: "HyperEVM",
            rpcUrl: "https://rpc.hyperliquid.xyz/evm",
            explorerUrl: "https://app.hyperliquid.xyz/explorer",
            address: input.address,
            hype: { symbol: "HYPE", decimals: 18, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            usdc: { symbol: "USDC", decimals: 6, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          masterVault: {
            location: "masterVault",
            configured: true,
            writeEnabled: true,
            address: "0x9999999999999999999999999999999999999999",
            reasons: [],
            status: "ready"
          },
          bridge: {
            asset: "USDC",
            sourceLocation: "arbitrum",
            destinationLocation: "hyperCore",
            nativeUsdcOnly: true,
            minDepositUsd: "5",
            withdrawFeeUsd: "1",
            depositContractAddress: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
            creditedBalance: {
              symbol: "USDC",
              decimals: 6,
              raw: "1000000",
              formatted: "1",
              state: "available",
              available: true,
              reason: null
            },
            creditedBalanceSource: "clearinghouseState.withdrawable",
            creditedLocationLabel: "Hyperliquid trading wallet (USDC / Perps)",
            deposit: {
              enabled: true,
              status: "ready",
              reason: null,
              missingRequirements: []
            },
            withdraw: {
              enabled: true,
              status: "ready",
              reason: null,
              missingRequirements: []
            },
            links: {
              officialAppUrl: "https://app.hyperliquid.xyz/portfolio",
              depositContractExplorerUrl: "https://arbiscan.io/address/0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
              hyperliquidExchangeUrl: "https://api.hyperliquid.xyz"
            }
          },
          readiness: {
            currentStage: "deposit_usdc_to_hyperliquid",
            missingRequirements: [],
            recommendedAction: "deposit_usdc_to_hyperliquid",
            depositEnabled: false,
            stages: [],
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          actions: [],
          transferCapabilities: [],
          externalLinks: [],
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      },
      async getFundingReadiness() {
        throw new Error("not_used");
      },
      async getFundingHistory() {
        throw new Error("not_used");
      },
      async getFundingExternalLinks() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/:address/overview");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.address, "0x1234567890123456789012345678901234567890");
  assert.equal(res.body?.arbitrum?.usdc?.formatted, "1");
  assert.equal(res.body?.masterVault?.status, "ready");
  assert.equal(res.body?.bridge?.minDepositUsd, "5");
});

test("GET /funding/:address/readiness returns readiness payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    fundingReadService: {
      async getFundingOverview() {
        throw new Error("not_used");
      },
      async getFundingReadiness(input: any) {
        return {
          address: input.address,
          readiness: {
            currentStage: "hyperevm_hype",
            missingRequirements: ["hyperEVM_hype_missing"],
            recommendedAction: "transfer_hype_core_to_evm",
            depositEnabled: false,
            stages: [],
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      },
      async getFundingHistory() {
        throw new Error("not_used");
      },
      async getFundingExternalLinks() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/:address/readiness");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.readiness?.recommendedAction, "transfer_hype_core_to_evm");
});

test("GET /funding/:address/history forwards onchain actions to funding service", async () => {
  const app = createFakeApp();
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async listActionsForUser(input: any) {
        calls.push(input);
        return [
          {
            id: "act_1",
            actionType: "deposit_master_vault",
            status: "confirmed",
            txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            chainId: 999,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:05:00.000Z"
          }
        ];
      }
    } as any,
    fundingReadService: {
      async getFundingOverview() {
        throw new Error("not_used");
      },
      async getFundingReadiness() {
        throw new Error("not_used");
      },
      async getFundingHistory(input: any) {
        assert.equal(input.items?.length, 1);
        assert.equal(input.items?.[0]?.actionType, "deposit_master_vault");
        return {
          address: input.address,
          trackingMode: "lightweight",
          note: "External handoffs are not fully tracked.",
          items: [
            {
              id: "act_1",
              actionId: "master_vault_deposit",
              title: "MasterVault deposit",
              description: "Tracked deposit",
              locationFrom: "hyperEvm",
              locationTo: "masterVault",
              status: "confirmed",
              txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              chainId: 999,
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:05:00.000Z"
            }
          ],
          updatedAt: "2026-03-10T00:05:00.000Z"
        };
      },
      async getFundingExternalLinks() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/:address/history");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]?.userId, "user_1");
  assert.equal(calls[0]?.limit, 50);
  assert.equal(res.body?.items?.length, 1);
});

test("GET /funding/:address/external-links returns disabled links when config is missing", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    fundingReadService: {
      async getFundingOverview() {
        throw new Error("not_used");
      },
      async getFundingReadiness() {
        throw new Error("not_used");
      },
      async getFundingHistory() {
        throw new Error("not_used");
      },
      async getFundingExternalLinks(input: any) {
        return {
          address: input.address,
          links: [
            {
              id: "hyperliquid_deposit",
              label: "Deposit USDC to Hyperliquid",
              href: null,
              enabled: false,
              reason: "hyperliquid_deposit_url_missing"
            }
          ],
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/:address/external-links");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.links?.[0]?.enabled, false);
  assert.equal(res.body?.links?.[0]?.reason, "hyperliquid_deposit_url_missing");
});

test("GET /funding/:address/overview rejects invalid addresses", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    fundingReadService: {
      async getFundingOverview() {
        throw new Error("invalid_wallet_address");
      },
      async getFundingReadiness() {
        throw new Error("not_used");
      },
      async getFundingHistory() {
        throw new Error("not_used");
      },
      async getFundingExternalLinks() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/:address/overview");
  const req = {
    params: {
      address: "not-an-address"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "invalid_wallet_address");
});

test("GET /transfers/:address/overview returns aggregated transfer payload", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    transferReadService: {
      async getTransferOverview(input: any) {
        return {
          address: input.address,
          assets: [
            {
              asset: "USDC",
              symbol: "USDC",
              decimals: 6,
              hyperCoreToken: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
              evmAssetType: "erc20",
              evmTokenAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
              systemAddress: "0x2000000000000000000000000000000000000000"
            },
            {
              asset: "HYPE",
              symbol: "HYPE",
              decimals: 18,
              hyperCoreToken: "HYPE:0x0d01dc56dcaaca66ad901c959b4011ec",
              evmAssetType: "native",
              evmTokenAddress: null,
              systemAddress: "0x2222222222222222222222222222222222222222"
            }
          ],
          hyperCore: {
            location: "hyperCore",
            address: input.address,
            source: "spotClearinghouseState",
            available: true,
            reason: null,
            usdc: { symbol: "USDC", decimals: 6, raw: "1000000", formatted: "1", state: "available", available: true, reason: null },
            hype: { symbol: "HYPE", decimals: 18, raw: "1000000000000000000", formatted: "1", state: "available", available: true, reason: null },
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          hyperEvm: {
            location: "hyperEvm",
            address: input.address,
            available: true,
            reason: null,
            network: {
              chainId: 999,
              expectedChainId: 999,
              networkName: "HyperEVM",
              rpcUrl: "https://rpc.hyperliquid.xyz/evm",
              explorerUrl: "https://app.hyperliquid.xyz/explorer"
            },
            usdc: { symbol: "USDC", decimals: 6, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            hype: { symbol: "HYPE", decimals: 18, raw: "0", formatted: "0", state: "zero", available: true, reason: null },
            updatedAt: "2026-03-10T00:00:00.000Z"
          },
          capabilities: [
            {
              id: "usdc_core_to_evm",
              direction: "core_to_evm",
              asset: "USDC",
              supported: true,
              mode: "client_write",
              reason: null,
              systemAddress: "0x2000000000000000000000000000000000000000",
              hyperCoreToken: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
              evmAssetType: "erc20",
              evmTokenAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
              requiresChainId: null,
              gas: {
                asset: "HYPE",
                location: "hyperCore",
                required: true,
                available: true,
                balance: { symbol: "HYPE", decimals: 18, raw: "1000000000000000000", formatted: "1", state: "available", available: true, reason: null },
                detail: "Core -> EVM requires HYPE on HyperCore / Spot for gas.",
                reason: null
              }
            }
          ],
          protocol: {
            domainsDescription: "HyperCore and HyperEVM are separate balance domains.",
            timingCoreToEvm: "Core -> EVM is queued until the next HyperEVM block.",
            timingEvmToCore: "EVM -> Core is processed in the same L1 block after the HyperEVM block.",
            notes: []
          },
          updatedAt: "2026-03-10T00:00:00.000Z"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/transfers/:address/overview");
  const req = {
    params: {
      address: "0x1234567890123456789012345678901234567890"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.address, "0x1234567890123456789012345678901234567890");
  assert.equal(res.body?.hyperCore?.usdc?.formatted, "1");
  assert.equal(res.body?.capabilities?.[0]?.direction, "core_to_evm");
});

test("GET /transfers/:address/overview rejects invalid addresses", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    transferReadService: {
      async getTransferOverview() {
        throw new Error("invalid_wallet_address");
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/transfers/:address/overview");
  const req = {
    params: {
      address: "not-an-address"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "invalid_wallet_address");
});

test("vault guard blocks access when vault product gate is disabled", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.vaults": false
      }
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) =>
      capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        code: "CAPABILITY_DENIED",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    }
  });

  const handlers = app.routes.get.get("/vaults/master");
  if (!handlers || handlers.length < 2) {
    throw new Error("vault_guard_not_registered");
  }
  const guard = handlers[1];
  const res = createMockRes("user_1");

  await guard({}, res, () => {
    throw new Error("next_should_not_be_called");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.capability, "product.vaults");
});

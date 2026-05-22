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

function createMockRes(userId = "user_1", walletAddress: string | null = null) {
  return {
    locals: {
      user: {
        id: userId,
        email: `${userId}@example.com`,
        walletAddress
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

test("legacy POST /vaults/master/deposit returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/deposit");
  const res = createMockRes("user_1");
  await handler({ body: { amountUsd: 25, idempotencyKey: "dep:u1:25" } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("legacy POST /vaults/master/agent-wallet/set returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/agent-wallet/set");
  const res = createMockRes("user_1");
  await handler({ body: { agentWallet: "0x1111111111111111111111111111111111111111" } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("legacy POST /vaults/master/agent-wallet/threshold returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/agent-wallet/threshold");
  const res = createMockRes("user_1");
  await handler({ body: { thresholdHype: 0.02 } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("legacy POST /vaults/master/agent-wallet/withdraw-hype returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/agent-wallet/withdraw-hype");
  const res = createMockRes("user_1");
  await handler({ body: { amountHype: 0.5, reserveHype: 0.01 } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("GET /agent-wallet returns user-level agent wallet summary", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    botVaultV3Service: {
      async getUserAgentWalletSummary(input: any) {
        assert.equal(input.userId, "user_1");
        return {
          address: "0x3333333333333333333333333333333333333333",
          version: 1,
          secretRef: "users/user_1/agent/v1",
          hypeBalance: "0.42",
          hypeBalanceWei: "420000000000000000",
          lowHypeThreshold: 0.05,
          lowHypeState: "ok",
          updatedAt: "2026-03-29T00:00:00.000Z",
          stale: false
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/agent-wallet");
  const res = createMockRes("user_1");
  await handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.address, "0x3333333333333333333333333333333333333333");
});

test("POST /agent-wallet/withdraw-hype delegates to user agent wallet flow", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    botVaultV3Service: {
      async withdrawHypeFromUserAgentWallet(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.amountHype, 1);
        return {
          txHash: "0xagent",
          amountHype: "1",
          remainingReserveHype: "0.05",
          targetAddress: "0x4444444444444444444444444444444444444444"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/agent-wallet/withdraw-hype");
  const res = createMockRes("user_1");
  await handler({ body: { amountHype: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.txHash, "0xagent");
});

test("POST /agent-wallet/fund-hype records user agent wallet funding", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    botVaultV3Service: {
      async recordUserAgentWalletHypeFunding(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.amountHype, 0.02);
        assert.equal(input.fromAddress, "0x1111111111111111111111111111111111111111");
        assert.equal(input.txHash, "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        return {
          actionId: "act_1",
          txHash: input.txHash,
          agentWalletSummary: {
            address: "0x3333333333333333333333333333333333333333"
          }
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/agent-wallet/fund-hype");
  const res = createMockRes("user_1");
  await handler({
    body: {
      amountHype: 0.02,
      fromAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.actionId, "act_1");
});

test("legacy POST /vaults/master/withdraw returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/withdraw");
  const res = createMockRes("user_1");
  await handler({ body: { amountUsd: 10, idempotencyKey: "wd:u1:10" } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("legacy POST /vaults/master/create returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "post", "/vaults/master/create");
  const res = createMockRes("user_1");
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
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

test("GET /vaults/bot-vaults forwards reusableOnly filter", async () => {
  const app = createFakeApp();
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {
      async listBotVaults(input: any) {
        calls.push(input);
        return [{ id: "bv_reusable_1", reusable: true }];
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-vaults");
  const req = {
    query: {
      reusableOnly: "true"
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userId, "user_1");
  assert.equal(calls[0]?.reusableOnly, true);
});

test("GET /vaults/bot-vaults/overview returns usage counts and manual empty actions", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {
      async listBotVaults(input: any) {
        assert.equal(input.userId, "user_1");
        return [
          {
            id: "bv_running",
            allocatedUsd: 100,
            availableUsd: 0,
            executionStatus: "running",
            ownerSummary: { gridState: "running", botStatus: "running" },
            reusable: false
          },
          {
            id: "bv_unused",
            allocatedUsd: 0,
            availableUsd: 0,
            executionStatus: "stopped",
            statusCategory: "execution_ready",
            reusable: true
          },
          {
            id: "bv_error",
            allocatedUsd: 50,
            availableUsd: 3,
            statusCategory: "recovery_required",
            statusReason: "bot_vault_v4_hype_reserve_unknown_failure",
            reusable: false
          },
          {
            id: "bv_recover",
            allocatedUsd: 20,
            availableUsd: 7,
            principalAllocated: 20,
            principalReturned: 13,
            status: "CLOSED",
            executionStatus: "closed",
            statusCategory: "settled",
            canRecover: true,
            hasOnchainVault: true,
            reusable: false
          },
          {
            id: "bv_settled_fee_remainder",
            allocatedUsd: 6,
            availableUsd: 0,
            withdrawableUsd: 0,
            principalAllocated: 6,
            principalReturned: 5,
            status: "CLOSE_ONLY",
            executionStatus: "closed",
            statusCategory: "settled",
            fundingDisplayStatus: "funding_confirmed",
            fundingDisplayReasonCode: "settled",
            hasOnchainVault: true,
            reusable: true
          }
        ];
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/vaults/bot-vaults/overview");
  const res = createMockRes("user_1");

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.counts?.total, 5);
  assert.equal(res.body?.counts?.in_use, 1);
  assert.equal(res.body?.counts?.unused, 1);
  assert.equal(res.body?.counts?.error, 1);
  assert.equal(res.body?.counts?.settled, 2);
  assert.equal(res.body?.counts?.manualEmptyAvailable, 1);
  assert.equal(res.body?.items?.find((item: any) => item.id === "bv_recover")?.manualEmptyAction?.type, "recover_closed");
  assert.equal(res.body?.items?.find((item: any) => item.id === "bv_running")?.manualEmptyAction?.reason, "vault_in_use");
  assert.equal(res.body?.items?.find((item: any) => item.id === "bv_settled_fee_remainder")?.residualCapitalUsd, 0);
  assert.equal(res.body?.items?.find((item: any) => item.id === "bv_settled_fee_remainder")?.capitalUsd, 0);
  assert.equal(res.body?.items?.find((item: any) => item.id === "bv_settled_fee_remainder")?.manualEmptyAction?.reason, "already_empty");
  assert.equal(res.body?.totals?.availableUsd, 10);
  assert.equal(res.body?.totals?.residualCapitalUsd, 157);
});

test("GET /vaults/master returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });
  const handler = getFinalHandler(app, "get", "/vaults/master");
  const res = createMockRes("user_1");
  await handler({}, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
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

test("POST /vaults/bot-vaults/:id/controller-close maps insufficient contract balance to pending reconciliation", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    botVaultV3Service: {
      async controllerCloseBotVault(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        throw new Error("bot_vault_v3_pending_reconciliation:insufficient_contract_balance:close_vault:expectedAtomic=6000000:actualAtomic=0");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/bot-vaults/:id/controller-close");
  const req = { params: { id: "bv_1" }, body: {} };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "onchain_pending_reconciliation");
  assert.equal(res.body?.code, "insufficient_contract_balance");
  assert.equal(res.body?.recoveryHint, "retry_reconcile");
});

test("POST /vaults/bot-vaults/:id/reconcile delegates to runtime reconciliation", async () => {
  const app = createFakeApp();
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    botVaultV3Service: {
      async reconcileBotVaultV3ById(input: any) {
        calls.push(input);
        return { id: input.botVaultId, statusCategory: "execution_ready" };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/bot-vaults/:id/reconcile");
  const req = { params: { id: "bv_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.botVault?.id, "bv_1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: "user_1",
    botVaultId: "bv_1",
    persist: true
  });
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

test("POST /vaults/onchain/master/create-tx returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/master/create-tx");
  const req = { body: { actionKey: "ac_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
});

test("POST /vaults/onchain/master/withdraw-tx returns 410", async () => {
  const app = createFakeApp();
  registerVaultRoutes(app as any, { vaultService: {} as any });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/master/withdraw-tx");
  const req = { body: { amountUsd: 12.5, actionKey: "wd_1" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body?.error, "master_vault_removed");
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

test("POST /vaults/onchain/bot-vaults/:id/claim-tx maps closed-vault claim rejection to 409", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildClaimFromBotVault() {
        throw new Error("bot_vault_onchain_claim_not_allowed:CLOSED");
      },
      async getMode() {
        return "onchain_live";
      },
      async listActionsForUser() {
        return [];
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/vaults/onchain/bot-vaults/:id/claim-tx");
  const req = {
    params: { id: "bv_1" },
    body: { actionKey: "claim_closed_1" }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "onchain_claim_unavailable");
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

test("POST /vaults/onchain/bot-vaults/:id/close-tx accepts auto-derived close payload with actionKey only", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildCloseBotVault(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botVaultId, "bv_1");
        assert.equal(input.actionKey, "close_auto_1");
        assert.equal(input.releasedReservedUsd, undefined);
        assert.equal(input.grossReturnedUsd, undefined);
        return {
          mode: "onchain_live",
          action: {
            id: "act_close_1",
            actionType: "close_bot_vault",
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

  const handler = getFinalHandler(app, "post", "/vaults/onchain/bot-vaults/:id/close-tx");
  const req = {
    params: { id: "bv_1" },
    body: { actionKey: "close_auto_1" }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.action?.actionType, "close_bot_vault");
  assert.equal(res.body?.txRequest?.chainId, 999);
});

test("POST /vaults/onchain/bot-vaults/:id/set-close-only-tx maps noop close-only to 409", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async buildSetBotVaultCloseOnly() {
        throw new Error("bot_vault_onchain_close_only_already_set:CLOSE_ONLY");
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
  const req = { params: { id: "bv_1" }, body: { actionKey: "co_2" } };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "onchain_close_only_unavailable");
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
    onchainActionService: {
      async listActionsForUser() {
        return [
          {
            id: "act_1",
            actionType: "deposit_master_vault",
            status: "confirmed",
            txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            chainId: 999,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:05:00.000Z"
          },
          {
            id: "act_2",
            actionType: "withdraw_master_vault",
            status: "submitted",
            txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            chainId: 999,
            createdAt: "2026-03-11T00:00:00.000Z",
            updatedAt: "2026-03-11T00:05:00.000Z"
          }
        ];
      }
    } as any,
    walletReadService: {
      async getWalletOverview({ address }: any) {
        return {
          address,
          network: {
            chainId: 999,
            name: "HyperEVM",
            rpcUrl: "https://rpc.hyperliquid.xyz/evm",
            explorerUrl: "https://hyperevmscan.io"
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
    onchainActionService: {
      async listActionsForUser() {
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
              title: null,
              description: null,
              side: "buy",
              size: 1,
              price: 10,
              closedPnlUsd: null,
              feeUsd: 0.1,
              status: null,
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
  assert.equal(calls[0]?.items?.[0]?.actionType, "deposit_master_vault");
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
            explorerUrl: "https://hyperevmscan.io",
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
          },
          {
            id: "act_2",
            actionType: "withdraw_master_vault",
            status: "submitted",
            txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            chainId: 999,
            createdAt: "2026-03-11T00:00:00.000Z",
            updatedAt: "2026-03-11T00:05:00.000Z"
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
        assert.equal(input.items?.length, 2);
        assert.equal(input.items?.[0]?.actionType, "deposit_master_vault");
        assert.equal(input.items?.[1]?.actionType, "withdraw_master_vault");
        return {
          address: input.address,
          trackingMode: "lightweight",
          note: "External handoffs are not fully tracked.",
          items: [
            {
              id: "act_1",
              actionId: "master_vault_deposit",
              title: "BotVault deposit",
              description: "Tracked deposit",
              locationFrom: "hyperEvm",
              locationTo: "masterVault",
              status: "confirmed",
              txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              chainId: 999,
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:05:00.000Z"
            },
            {
              id: "act_2",
              actionId: "withdraw_master_vault",
              title: "BotVault withdraw",
              description: "Tracked withdraw",
              locationFrom: "masterVault",
              locationTo: "hyperEvm",
              status: "submitted",
              txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              chainId: 999,
              createdAt: "2026-03-11T00:00:00.000Z",
              updatedAt: "2026-03-11T00:05:00.000Z"
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
  assert.equal(res.body?.items?.length, 2);
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

test("POST /funding/:address/intents creates durable funding intent for linked wallet", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async createFundingIntent(input: any) {
        calls.push(input);
        return {
          id: "intent_1",
          actionType: input.actionType,
          status: "prepared",
          txHash: null,
          metadata: input
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/intents");
  const res = createMockRes("user_1", wallet);
  await handler({
    params: { address: wallet },
    body: {
      actionType: "funding_bridge_deposit",
      chainId: 42161,
      toAddress: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
      asset: "USDC",
      direction: "arbitrum_to_hypercore",
      amountRaw: "5000000",
      amountFormatted: "5",
      sourceLocation: "arbitrum",
      destinationLocation: "hyperCore",
      beforeSourceRaw: "10000000",
      beforeDestinationRaw: "0",
      targetDestinationRaw: "5000000"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.action?.id, "intent_1");
  assert.equal(calls[0]?.walletAddress, wallet);
});

test("POST /funding/:address/relay/quote delegates to Relay service for linked wallet", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    relayFundingService: {
      async getQuote(input: any) {
        calls.push(input);
        return {
          provider: "relay",
          direction: "arbitrum_to_hyperevm",
          originChainId: 42161,
          destinationChainId: 999,
          usdc: { destinationAmount: { formatted: "9.99" } },
          hypeTopup: null,
          createdAt: "2026-05-13T00:00:00.000Z"
        };
      },
      async getStatus() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/relay/quote");
  const res = createMockRes("user_1", wallet);
  await handler({
    params: { address: wallet },
    body: {
      usdcAmount: "10",
      includeHypeTopup: true,
      hypeTopupUsdcAmount: "5"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]?.user, wallet);
  assert.equal(calls[0]?.includeHypeTopup, true);
});

test("POST /funding/:address/relay/quote forwards reverse Relay direction", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";
  const calls: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    relayFundingService: {
      async getQuote(input: any) {
        calls.push(input);
        return {
          provider: "relay",
          direction: "hyperevm_to_arbitrum",
          originChainId: 999,
          destinationChainId: 42161,
          usdc: { destinationAmount: { formatted: "9.99" } },
          hypeTopup: null,
          createdAt: "2026-05-13T00:00:00.000Z"
        };
      },
      async getStatus() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/relay/quote");
  const res = createMockRes("user_1", wallet);
  await handler({
    params: { address: wallet },
    body: {
      direction: "hyperevm_to_arbitrum",
      usdcAmount: "10"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0]?.direction, "hyperevm_to_arbitrum");
  assert.equal(calls[0]?.user, wallet);
});

test("POST /funding/:address/relay/quote rejects wallet mismatch", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    relayFundingService: {
      async getQuote() {
        throw new Error("not_used");
      },
      async getStatus() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/relay/quote");
  const res = createMockRes("user_1", "0x1234567890123456789012345678901234567890");
  await handler({
    params: { address: "0x9999999999999999999999999999999999999999" },
    body: { usdcAmount: "10" }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, "wallet_address_mismatch");
});

test("GET /funding/relay/status validates request id and delegates", async () => {
  const app = createFakeApp();
  const requestId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    relayFundingService: {
      async getQuote() {
        throw new Error("not_used");
      },
      async getStatus(input: any) {
        return {
          provider: "relay",
          requestId: input.requestId,
          status: "pending",
          rawStatus: "waiting",
          txHash: null,
          updatedAt: "2026-05-13T00:00:00.000Z"
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "get", "/funding/relay/status");
  const res = createMockRes("user_1", "0x1234567890123456789012345678901234567890");
  await handler({ query: { requestId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.requestId, requestId);
  assert.equal(res.body?.status, "pending");
});

test("POST /funding/:address/intents rejects wallet mismatch", async () => {
  const app = createFakeApp();

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async createFundingIntent() {
        throw new Error("not_used");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/intents");
  const res = createMockRes("user_1", "0x1234567890123456789012345678901234567890");
  await handler({
    params: { address: "0x9999999999999999999999999999999999999999" },
    body: {
      actionType: "funding_bridge_deposit",
      chainId: 42161,
      asset: "USDC",
      direction: "arbitrum_to_hypercore",
      amountRaw: "5000000",
      amountFormatted: "5",
      sourceLocation: "arbitrum",
      destinationLocation: "hyperCore",
      beforeSourceRaw: "10000000",
      beforeDestinationRaw: "0",
      targetDestinationRaw: "5000000"
    }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, "wallet_address_mismatch");
});

test("POST /funding/:address/intents maps duplicate pending intent to conflict", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async createFundingIntent() {
        throw new Error("funding_intent_pending_reconciliation:intent_1");
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/:address/intents");
  const res = createMockRes("user_1", wallet);
  await handler({
    params: { address: wallet },
    body: {
      actionType: "funding_bridge_deposit",
      chainId: 42161,
      asset: "USDC",
      direction: "arbitrum_to_hypercore",
      amountRaw: "5000000",
      amountFormatted: "5",
      sourceLocation: "arbitrum",
      destinationLocation: "hyperCore",
      beforeSourceRaw: "10000000",
      beforeDestinationRaw: "0",
      targetDestinationRaw: "5000000"
    }
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "funding_intent_pending_reconciliation");
});

test("POST /funding/intents/:id/reconcile keeps pending until target destination balance is reached", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";
  const updates: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async getFundingIntentForUser() {
        return {
          id: "intent_1",
          actionType: "funding_bridge_deposit",
          status: "submitted",
          txHash: null,
          metadata: {
            walletAddress: wallet,
            targetDestinationRaw: "5000000",
            direction: "arbitrum_to_hypercore",
            asset: "USDC"
          }
        };
      },
      async updateFundingIntentStatus(input: any) {
        updates.push(input);
        return {
          id: input.actionId,
          actionType: "funding_bridge_deposit",
          status: input.status,
          txHash: null,
          metadata: input.metadata
        };
      }
    } as any,
    fundingReadService: {
      async getFundingOverview() {
        return {
          bridge: { creditedBalance: { raw: "4999998" } }
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/intents/:id/reconcile");
  const res = createMockRes("user_1", wallet);
  await handler({ params: { id: "intent_1" }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.reconciliation?.status, "pending_reconciliation");
  assert.equal(updates[0]?.status, "pending_reconciliation");
});

test("POST /funding/intents/:id/reconcile confirms when target destination balance is reached", async () => {
  const app = createFakeApp();
  const wallet = "0x1234567890123456789012345678901234567890";
  const updates: any[] = [];

  registerVaultRoutes(app as any, {
    vaultService: {} as any,
    onchainActionService: {
      async getFundingIntentForUser() {
        return {
          id: "intent_1",
          actionType: "funding_bridge_deposit",
          status: "pending_reconciliation",
          txHash: null,
          metadata: {
            walletAddress: wallet,
            targetDestinationRaw: "5000000",
            direction: "arbitrum_to_hypercore",
            asset: "USDC"
          }
        };
      },
      async updateFundingIntentStatus(input: any) {
        updates.push(input);
        return {
          id: input.actionId,
          actionType: "funding_bridge_deposit",
          status: input.status,
          txHash: null,
          metadata: input.metadata
        };
      }
    } as any,
    fundingReadService: {
      async getFundingOverview() {
        return {
          bridge: { creditedBalance: { raw: "5000000" } }
        };
      }
    } as any
  });

  const handler = getFinalHandler(app, "post", "/funding/intents/:id/reconcile");
  const res = createMockRes("user_1", wallet);
  await handler({ params: { id: "intent_1" }, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.reconciliation?.status, "confirmed");
  assert.equal(updates[0]?.status, "confirmed");
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
              explorerUrl: "https://hyperevmscan.io"
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

  const handlers = app.routes.get.get("/vaults/bot-vaults");
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

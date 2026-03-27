import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerAdminVaultOperationsRoutes } from "./routes-vault-operations.js";

function createFakeApp() {
  const routes: Record<string, Array<{ path: string; handlers: any[] }>> = {
    get: [],
    post: [],
    put: []
  };
  return {
    routes,
    get(path: string, ...handlers: any[]) {
      routes.get.push({ path, handlers });
    },
    post(path: string, ...handlers: any[]) {
      routes.post.push({ path, handlers });
    },
    put(path: string, ...handlers: any[]) {
      routes.put.push({ path, handlers });
    }
  };
}

function createMockRes(userId = "admin_1") {
  return {
    statusCode: 200,
    body: undefined as any,
    locals: {
      user: {
        id: userId,
        email: "admin@example.com",
        role: "SUPERADMIN",
        isSuperadmin: true,
        hasAdminBackendAccess: true
      }
    },
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "post", path: string) {
  const route = app.routes[method].find((entry) => entry.path === path);
  if (!route) throw new Error(`route_not_found:${method}:${path}`);
  return route.handlers[route.handlers.length - 1];
}

function createDeps(overrides?: Partial<Parameters<typeof registerAdminVaultOperationsRoutes>[1]>) {
  return {
    db: {},
    requireSuperadmin: async () => true,
    getVaultExecutionModeSettings: async () => ({ defaults: { mode: "onchain_live" } }),
    setVaultExecutionModeSettings: async () => ({}),
    getVaultExecutionProviderSettings: async () => ({ provider: "hyperliquid", source: "db", updatedAt: null, defaults: { provider: "hyperliquid" }, availableProviders: [] }),
    setVaultExecutionProviderSettings: async () => ({}),
    getGridHyperliquidPilotSettings: async () => ({ updatedAt: null }),
    setGridHyperliquidPilotSettings: async () => ({}),
    GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY: "vault_execution_mode",
    getVaultProfitShareTreasurySettings: async () => ({ enabled: false, walletAddress: null, feeRatePct: 30 }),
    setVaultProfitShareTreasurySettings: async () => ({}),
    normalizeTreasuryWalletAddress: (value: string) => value,
    normalizeProfitShareFeeRatePct: (value: unknown) => Number(value),
    onchainActionService: null,
    ONCHAIN_TREASURY_PAYOUT_MODEL: "factory",
    parseJsonObject: () => ({}),
    ignoreMissingTable: async <T>(operation: () => Promise<T>) => operation(),
    getVaultSafetyControlsSettings: async () => ({}),
    setVaultSafetyControlsSettings: async () => ({}),
    vaultService: {
      async getBotVaultLifecycleSnapshot() {
        return {
          id: "bv_1",
          userId: "user_1"
        };
      },
      async compensateClosedBotVaultRecovery() {
        return { ok: true };
      }
    },
    vaultAccountingJob: { getStatus: () => ({}) },
    botVaultRiskJob: { getStatus: () => ({}) },
    botVaultTradingReconciliationJob: { getStatus: () => ({}) },
    vaultOnchainIndexerJob: { getStatus: () => ({}) },
    vaultOnchainReconciliationJob: { getStatus: () => ({}) },
    systemHealthTelegramJob: { getStatus: () => ({}) },
    ...overrides
  };
}

test("POST /admin/vault-ops/bot-vaults/:id/intervene forwards closed-vault compensation payload", async () => {
  const app = createFakeApp();
  let captured: any = null;
  registerAdminVaultOperationsRoutes(app as unknown as express.Express, createDeps({
    vaultService: {
      async getBotVaultLifecycleSnapshot() {
        return {
          id: "bv_1",
          userId: "user_1"
        };
      },
      async compensateClosedBotVaultRecovery(input: any) {
        captured = input;
        return {
          compensatedUsd: input.amountUsd
        };
      }
    }
  }) as any);

  const handler = getFinalHandler(app, "post", "/admin/vault-ops/bot-vaults/:id/intervene");
  const req = {
    params: { id: "bv_1" },
    body: {
      action: "compensate_closed_recovery",
      amountUsd: 50,
      idempotencyKey: "recover_50_1",
      reason: "legacy_close_bug",
      externalReference: "0xdeadbeef"
    }
  };
  const res = createMockRes();

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 200);
  assert.equal(captured.userId, "user_1");
  assert.equal(captured.botVaultId, "bv_1");
  assert.equal(captured.amountUsd, 50);
  assert.equal(captured.idempotencyKey, "recover_50_1");
  assert.equal(captured.reason, "legacy_close_bug");
  assert.equal(captured.externalReference, "0xdeadbeef");
});

test("POST /admin/vault-ops/bot-vaults/:id/intervene requires amount for closed-vault compensation", async () => {
  const app = createFakeApp();
  registerAdminVaultOperationsRoutes(app as unknown as express.Express, createDeps() as any);

  const handler = getFinalHandler(app, "post", "/admin/vault-ops/bot-vaults/:id/intervene");
  const req = {
    params: { id: "bv_1" },
    body: {
      action: "compensate_closed_recovery",
      idempotencyKey: "recover_missing_amount"
    }
  };
  const res = createMockRes();

  await handler(req as any, res as any);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "amount_usd_required");
});

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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "put", path: string) {
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

test("GET /admin/vault-profit-share/summary ignores adjustment fee events", async () => {
  const app = createFakeApp();
  let capturedArgs: any = null;
  registerAdminVaultOperationsRoutes(app as unknown as express.Express, createDeps({
    db: {
      feeEvent: {
        async findMany(args: any) {
          capturedArgs = args;
          const rows = [
            {
              eventType: "PROFIT_SHARE",
              feeAmount: 0.136217,
              metadata: { treasuryPayoutModel: "onchain_treasury_v1" }
            },
            {
              eventType: "ADJUSTMENT",
              feeAmount: 1,
              metadata: { source: "hypercore_account_creation" }
            }
          ];
          return rows
            .filter((row) => !args?.where?.eventType || row.eventType === args.where.eventType)
            .map(({ feeAmount, metadata }) => ({ feeAmount, metadata }));
        }
      }
    },
    getVaultProfitShareTreasurySettings: async () => ({ enabled: true, walletAddress: "0x123", feeRatePct: 30, onchainFeeRatePct: 30 }),
    ONCHAIN_TREASURY_PAYOUT_MODEL: "onchain_treasury_v1"
  }) as any);

  const handler = getFinalHandler(app, "get", "/admin/vault-profit-share/summary");
  const res = createMockRes();

  await handler({} as any, res as any);

  assert.deepEqual(capturedArgs?.where, { eventType: "PROFIT_SHARE" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.totalFeePaidUsd, 0.1362);
  assert.equal(res.body?.totalOnchainPaidUsd, 0.1362);
  assert.equal(res.body?.pendingLegacyAccrualUsd, 0);
});

test("GET /admin/vault-profit-share/payouts only returns profit share events", async () => {
  const app = createFakeApp();
  let capturedArgs: any = null;
  registerAdminVaultOperationsRoutes(app as unknown as express.Express, createDeps({
    db: {
      feeEvent: {
        async findMany(args: any) {
          capturedArgs = args;
          return [
            {
              id: "fee_1",
              botVaultId: "bv_1",
              feeAmount: 0.136217,
              profitBase: 0.454059,
              metadata: { treasuryPayoutModel: "onchain_treasury_v1" },
              createdAt: new Date("2026-04-10T16:00:00.000Z"),
              botVault: {
                userId: "user_1",
                gridInstanceId: "grid_1"
              }
            },
            {
              id: "fee_legacy",
              botVaultId: "bv_legacy",
              feeAmount: 7,
              profitBase: 21,
              metadata: { treasuryPayoutModel: "legacy_no_treasury_payout" },
              createdAt: new Date("2026-04-09T16:00:00.000Z"),
              botVault: {
                userId: "user_2",
                gridInstanceId: "grid_legacy"
              }
            }
          ];
        }
      }
    },
    parseJsonObject: (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {},
    ONCHAIN_TREASURY_PAYOUT_MODEL: "onchain_treasury_v1"
  }) as any);

  const handler = getFinalHandler(app, "get", "/admin/vault-profit-share/payouts");
  const res = createMockRes();

  await handler({} as any, res as any);

  assert.deepEqual(capturedArgs?.where, { eventType: "PROFIT_SHARE" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body?.items, [
    {
      id: "fee_1",
      botVaultId: "bv_1",
      userId: "user_1",
      gridInstanceId: "grid_1",
      feeAmountUsd: 0.136217,
      profitBaseUsd: 0.454059,
      metadata: { treasuryPayoutModel: "onchain_treasury_v1" },
      createdAt: "2026-04-10T16:00:00.000Z"
    }
  ]);
});

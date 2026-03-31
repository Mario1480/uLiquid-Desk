import assert from "node:assert/strict";
import test from "node:test";
import { registerBotRoutes } from "./routes.js";

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

function createMockRes() {
  return {
    locals: {
      user: {
        id: "user_1",
        email: "user_1@example.com"
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

function getFinalPostHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

function getFinalGetHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.get.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("admin backend access bypasses product gate when creating bots", async () => {
  const app = createFakeApp();

  registerBotRoutes(app as any, {
    db: {
      exchangeAccount: {
        async findFirst() {
          return {
            id: "acc_1",
            exchange: "paper",
            label: "Demo"
          };
        }
      },
      bot: {
        async create(input: any) {
          return {
            id: "bot_1",
            ...input.data
          };
        }
      }
    },
    toSafeBot: (bot: any) => bot,
    normalizeSymbolInput: (value: string | null | undefined) =>
      typeof value === "string" ? value.trim().toUpperCase() : null,
    asRecord: (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}),
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.ai_predictions": false
      },
      capabilitySnapshot: null
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) => capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    botCreateSchema: {
      safeParse() {
        return {
          success: true,
          data: {
            name: "SMC",
            symbol: "BTCUSDT",
            exchangeAccountId: "acc_1",
            strategyKey: "prediction_copier",
            marginMode: "isolated",
            leverage: 10,
            tickMs: 1000,
            paramsJson: {
              predictionCopier: {
                sourceStateId: "state_1",
                timeframe: "15m"
              }
            }
          }
        };
      }
    },
    strategyCapabilityForKey: () => "product.ai_predictions",
    executionCapabilityForMode: () => "product.paper_trading",
    readExecutionSettingsFromParams: () => ({ mode: "simple" }),
    readPredictionCopierRootConfig: (paramsJson: any) => ({
      root: paramsJson?.predictionCopier ?? {},
      nested: false
    }),
    predictionCopierSettingsSchema: {
      safeParse(root: any) {
        return {
          success: true,
          data: {
            sourceStateId: String(root?.sourceStateId ?? "state_1"),
            timeframe: String(root?.timeframe ?? "15m")
          }
        };
      }
    },
    findPredictionSourceStateForCopier: async () => ({
      id: "state_1",
      symbol: "BTCUSDT",
      timeframe: "15m"
    }),
    readPredictionSourceSnapshotFromState: () => ({ stateId: "state_1" }),
    normalizeCopierTimeframe: (value: unknown) => String(value ?? "15m"),
    writePredictionCopierRootConfig: (_paramsJson: unknown, root: Record<string, unknown>) => ({
      predictionCopier: root
    }),
    buildPluginPolicySnapshot: () => ({}),
    attachPluginPolicySnapshot: (paramsJson: Record<string, unknown>) => paramsJson,
    evaluateAccessSectionBypassForUser: async () => true,
    canCreateBotForUser: async () => ({
      allowed: true,
      limit: null,
      usage: 0,
      remaining: null
    }),
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots");
  const res = createMockRes();

  await handler({ body: {} }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.id, "bot_1");
});

test("admin backend access bypasses product gate and start license when starting bots", async () => {
  const app = createFakeApp();
  let startLicenseChecked = false;

  registerBotRoutes(app as any, {
    db: {
      bot: {
        async findFirst() {
          return {
            id: "bot_1",
            userId: "user_1",
            exchange: "paper",
            exchangeAccountId: "acc_1",
            status: "stopped",
            futuresConfig: {
              strategyKey: "dummy",
              paramsJson: {
                execution: {
                  mode: "simple"
                }
              }
            }
          };
        },
        async count(input: any) {
          return input?.where?.status === "running" ? 0 : 1;
        },
        async update(input: any) {
          return {
            id: input.where.id,
            status: input.data.status ?? "stopped"
          };
        }
      },
      botRuntime: {
        async upsert() {
          return null;
        }
      }
    },
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.bots": false,
        "product.paper_trading": false
      },
      capabilitySnapshot: null
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) => capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    strategyCapabilityForKey: () => "product.bots",
    readExecutionSettingsFromParams: () => ({ mode: "simple" }),
    executionCapabilityForMode: () => "product.paper_trading",
    buildPluginPolicySnapshot: () => ({}),
    attachPluginPolicySnapshot: (paramsJson: Record<string, unknown>) => paramsJson,
    evaluateAccessSectionBypassForUser: async () => true,
    getAccessSectionSettings: async () => ({
      limits: {
        bots: 1
      }
    }),
    enforceBotStartLicense: async () => {
      startLicenseChecked = true;
      return {
        allowed: false,
        reason: "should_have_been_bypassed"
      };
    },
    enqueueBotRun: async () => ({ jobId: "job_1", queued: true }),
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots/:id/start");
  const res = createMockRes();

  await handler({ params: { id: "bot_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.status, "running");
  assert.equal(startLicenseChecked, false);
});

test("POST /bots/:id/vault/claim-profit returns BotVaultV3 claim result", async () => {
  const app = createFakeApp();

  registerBotRoutes(app as any, {
    db: {
      bot: {
        async findFirst() {
          return { id: "bot_1" };
        }
      }
    },
    botVaultV3Service: {
      async claimProfit(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botId, "bot_1");
        assert.equal(input.amountUsd, 12.5);
        return {
          botVaultId: "bv_1",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          claimTxHash: "0xclaim",
          grossAmountAtomic: "12500000",
          feeAmountAtomic: "3750000",
          principalPortionAtomic: "0"
        };
      }
    },
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots/:id/vault/claim-profit");
  const res = createMockRes();

  await handler({ params: { id: "bot_1" }, body: { amountUsd: 12.5 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.result?.claimTxHash, "0xclaim");
});

test("GET /bots/:id/vault returns BotVaultV3 action capability flags", async () => {
  const app = createFakeApp();

  registerBotRoutes(app as any, {
    db: {
      bot: {
        async findFirst() {
          return { id: "bot_1" };
        }
      }
    },
    botVaultV3Service: {
      async getBotVaultForBot(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botId, "bot_1");
        return {
          id: "bv_1",
          botId: "bot_1",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          beneficiaryAddress: null,
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          onchainBotVaultAddress: "0x1111111111111111111111111111111111111111",
          agentWallet: "0x3333333333333333333333333333333333333333",
          agentWalletAddress: "0x3333333333333333333333333333333333333333",
          agentWalletVersion: 1,
          agentSecretRef: null,
          allocatedUsd: 100,
          availableUsd: 115,
          withdrawnUsd: 0,
          claimedProfitUsd: 0,
          feePaidTotal: 0,
          fundingStatus: "hyper_evm_confirmed_onchain",
          hypercoreFundingStatus: "pending",
          hasOnchainVault: true,
          fundingConfirmedOnchain: true,
          canClaim: true,
          canClose: true,
          canRecover: false,
          canSetAgentWallet: true,
          healthSummary: {
            lifecycleStatus: "active",
            fundingHealth: "transfer_pending",
            onchainStateKnown: true,
            actionState: "claim_available"
          },
          executionStatus: "funded",
          status: "ACTIVE",
          claimableProfitUsd: 15,
          endedAt: null,
          closedAt: null,
          createdAt: null,
          updatedAt: null
        };
      }
    },
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalGetHandler(app, "/bots/:id/vault");
  const res = createMockRes();

  await handler({ params: { id: "bot_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.hasOnchainVault, true);
  assert.equal(res.body?.fundingConfirmedOnchain, true);
  assert.equal(res.body?.canClaim, true);
  assert.equal(res.body?.canClose, true);
  assert.equal(res.body?.canRecover, false);
  assert.equal(res.body?.canSetAgentWallet, true);
  assert.equal(res.body?.healthSummary?.lifecycleStatus, "active");
  assert.equal(res.body?.healthSummary?.fundingHealth, "transfer_pending");
  assert.equal(res.body?.healthSummary?.onchainStateKnown, true);
  assert.equal(res.body?.healthSummary?.actionState, "claim_available");
  assert.equal(res.body?.onchainBotVaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(res.body?.agentWalletAddress, "0x3333333333333333333333333333333333333333");
});

test("POST /bots/:id/end returns BotVaultV3 close result", async () => {
  const app = createFakeApp();
  let cancelCalledWith: string | null = null;

  registerBotRoutes(app as any, {
    botVaultV3Service: {
      async endBotVault(input: any) {
        assert.equal(input.userId, "user_1");
        assert.equal(input.botId, "bot_1");
        return {
          botVaultId: "bv_1",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          closeOnlyTxHash: "0xcloseonly",
          closeTxHash: "0xclose",
          onchainStatusBefore: "ACTIVE",
          onchainStatusAfterCloseOnly: "CLOSE_ONLY",
          principalToReturnAtomic: "100000000",
          grossAmountAtomic: "120000000",
          feeAmountAtomic: "6000000"
        };
      }
    },
    cancelBotRun: async (botId: string) => {
      cancelCalledWith = botId;
      return undefined;
    },
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots/:id/end");
  const res = createMockRes();

  await handler({ params: { id: "bot_1" } }, res);

  assert.equal(cancelCalledWith, "bot_1");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.result?.closeTxHash, "0xclose");
});

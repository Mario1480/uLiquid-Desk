import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultFundingLifecycleMetadata } from "./botVaultRuntime.lifecycle.js";
import {
  claimBotVaultProfit,
  closeBotVaultOnchain,
  createBotVaultRuntimeService,
  createBotVaultV4Service,
  evaluateBotVaultExecutionReadiness,
  evaluateBotVaultV4ExecutionReadiness,
  finalizeBotVaultMarginAdd,
  finalizeBotVaultV4MarginAdd,
  fundBotVaultForRuntime,
  fundBotVaultV4,
  readBotVaultReconciliation,
  readBotVaultV4Reconciliation,
  recoverBotVaultClosedFunds,
  reduceBotVaultMargin,
  reduceBotVaultV4Margin,
  reconcileBotVaultV4ById,
  reconcileBotVaultById
} from "./botVaultRuntime.service.js";

test("bot vault runtime service exposes a neutral reconcile alias", async () => {
  const service = createBotVaultRuntimeService({});

  assert.equal(typeof service.reconcileBotVaultById, "function");
  assert.equal(service.reconcileBotVaultById, service.reconcileBotVaultV3ById);
  assert.equal(typeof service.reconcileBotVaultV4ById, "function");
  assert.equal(service.reconcileBotVaultV4ById, service.reconcileBotVaultV3ById);
  assert.equal(service.getBotVaultV4ForBot, service.getBotVaultForBot);
  assert.equal(service.ensureBotVaultV4ForBot, service.ensureBotVaultForBot);
  assert.equal(service.fundBotVaultForRuntime, service.fundBotVault);
  assert.equal(service.fundBotVaultV4, service.fundBotVault);
  assert.equal(service.previewBotVaultClaimProfit, service.previewClaimProfit);
  assert.equal(service.previewBotVaultV4ClaimProfit, service.previewClaimProfit);
  assert.equal(service.claimBotVaultProfit, service.claimProfit);
  assert.equal(service.claimBotVaultV4Profit, service.claimProfit);
  assert.equal(service.finalizeBotVaultMarginAdd, service.finalizeMarginAdd);
  assert.equal(service.finalizeBotVaultV4MarginAdd, service.finalizeMarginAdd);
  assert.equal(service.reduceBotVaultMargin, service.reduceMargin);
  assert.equal(service.reduceBotVaultV4Margin, service.reduceMargin);
  assert.equal(service.closeBotVaultOnchain, service.controllerCloseBotVault);
  assert.equal(service.closeBotVaultV4Onchain, service.controllerCloseBotVault);
  assert.equal(service.recoverBotVaultClosedFunds, service.controllerRecoverClosedBotVault);
  assert.equal(service.recoverBotVaultV4ClosedFunds, service.controllerRecoverClosedBotVault);
});

test("bot vault runtime capital-flow helpers prefer product aliases and support legacy services", async () => {
  const preferred = {
    fundBotVaultForRuntime: async () => ({ mode: "runtime_fund" }),
    fundBotVaultV4: async () => ({ mode: "v4_fund" }),
    fundBotVault: async () => ({ mode: "legacy_fund" }),
    claimBotVaultProfit: async () => ({ mode: "runtime_claim" }),
    claimProfit: async () => ({ mode: "legacy_claim" }),
    finalizeBotVaultMarginAdd: async () => ({ mode: "runtime_margin_add" }),
    finalizeBotVaultV4MarginAdd: async () => ({ mode: "v4_margin_add" }),
    finalizeMarginAdd: async () => ({ mode: "legacy_margin_add" }),
    reduceBotVaultMargin: async () => ({ mode: "runtime_reduce" }),
    reduceBotVaultV4Margin: async () => ({ mode: "v4_reduce" }),
    reduceMargin: async () => ({ mode: "legacy_reduce" }),
    closeBotVaultOnchain: async () => ({ mode: "runtime_close" }),
    controllerCloseBotVault: async () => ({ mode: "legacy_close" }),
    recoverBotVaultClosedFunds: async () => ({ mode: "runtime_recover" }),
    controllerRecoverClosedBotVault: async () => ({ mode: "legacy_recover" })
  } as any;
  const legacy = {
    fundBotVault: async (params: { botId: string }) => ({ mode: "legacy_fund", id: params.botId }),
    claimProfit: async (params: { botId: string }) => ({ mode: "legacy_claim", id: params.botId }),
    finalizeMarginAdd: async (params: { botVaultId: string }) => ({ mode: "legacy_margin_add", id: params.botVaultId }),
    reduceMargin: async (params: { botVaultId: string }) => ({ mode: "legacy_reduce", id: params.botVaultId }),
    controllerCloseBotVault: async (params: { botVaultId: string }) => ({ mode: "legacy_close", id: params.botVaultId }),
    controllerRecoverClosedBotVault: async (params: { botVaultId: string }) => ({ mode: "legacy_recover", id: params.botVaultId })
  } as any;

  assert.deepEqual(await fundBotVaultForRuntime(preferred, { userId: "user_1", botId: "bot_1", amountUsd: 10 }), { mode: "runtime_fund" });
  assert.deepEqual(await fundBotVaultV4(preferred, { userId: "user_1", botId: "bot_1", amountUsd: 10 }), { mode: "v4_fund" });
  assert.deepEqual(await claimBotVaultProfit(preferred, { userId: "user_1", botId: "bot_1", amountUsd: 1 }), { mode: "runtime_claim" });
  assert.deepEqual(await finalizeBotVaultMarginAdd(preferred, { userId: "user_1", botVaultId: "vault_1", amountUsd: 10 }), { mode: "runtime_margin_add" });
  assert.deepEqual(await finalizeBotVaultV4MarginAdd(preferred, { userId: "user_1", botVaultId: "vault_1", amountUsd: 10 }), { mode: "v4_margin_add" });
  assert.deepEqual(await reduceBotVaultMargin(preferred, { userId: "user_1", botVaultId: "vault_1", amountUsd: 5 }), { mode: "runtime_reduce" });
  assert.deepEqual(await reduceBotVaultV4Margin(preferred, { userId: "user_1", botVaultId: "vault_1", amountUsd: 5 }), { mode: "v4_reduce" });
  assert.deepEqual(await closeBotVaultOnchain(preferred, { userId: "user_1", botVaultId: "vault_1" }), { mode: "runtime_close" });
  assert.deepEqual(await recoverBotVaultClosedFunds(preferred, { userId: "user_1", botVaultId: "vault_1" }), { mode: "runtime_recover" });

  assert.deepEqual(await fundBotVaultForRuntime(legacy, { userId: "user_1", botId: "bot_2", amountUsd: 10 }), { mode: "legacy_fund", id: "bot_2" });
  assert.deepEqual(await claimBotVaultProfit(legacy, { userId: "user_1", botId: "bot_2", amountUsd: 1 }), { mode: "legacy_claim", id: "bot_2" });
  assert.deepEqual(await finalizeBotVaultMarginAdd(legacy, { userId: "user_1", botVaultId: "vault_2", amountUsd: 10 }), { mode: "legacy_margin_add", id: "vault_2" });
  assert.deepEqual(await reduceBotVaultMargin(legacy, { userId: "user_1", botVaultId: "vault_2", amountUsd: 5 }), { mode: "legacy_reduce", id: "vault_2" });
  assert.deepEqual(await closeBotVaultOnchain(legacy, { userId: "user_1", botVaultId: "vault_2" }), { mode: "legacy_close", id: "vault_2" });
  assert.deepEqual(await recoverBotVaultClosedFunds(legacy, { userId: "user_1", botVaultId: "vault_2" }), { mode: "legacy_recover", id: "vault_2" });
});

test("bot vault runtime reconcile helpers prefer product aliases and support legacy services", async () => {
  const preferred = await reconcileBotVaultById({
    reconcileBotVaultById: async () => ({ mode: "runtime" }),
    reconcileBotVaultV3ById: async () => ({ mode: "legacy" })
  } as any, { userId: "user_1", botVaultId: "vault_1" });
  const preferredV4 = await reconcileBotVaultV4ById({
    reconcileBotVaultV4ById: async () => ({ mode: "v4" }),
    reconcileBotVaultById: async () => ({ mode: "runtime" }),
    reconcileBotVaultV3ById: async () => ({ mode: "legacy" })
  } as any, { userId: "user_1", botVaultId: "vault_1" });

  const legacy = await reconcileBotVaultById({
    reconcileBotVaultV3ById: async (params: { botVaultId: string }) => ({ mode: "legacy", id: params.botVaultId })
  } as any, { userId: "user_1", botVaultId: "vault_2" });

  assert.deepEqual(preferred, { mode: "runtime" });
  assert.deepEqual(preferredV4, { mode: "v4" });
  assert.deepEqual(legacy, { mode: "legacy", id: "vault_2" });
});

test("bot vault runtime readiness aliases evaluate a fully verified v4 vault as ready", () => {
  const row = {
    status: "DEPLOYED",
    contractVersion: "v4",
    onchainBotVaultAddress: "0x0000000000000000000000000000000000000001",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    executionMetadata: {
      ...createBotVaultFundingLifecycleMetadata("execution_ready", "2026-04-29T00:00:00.000Z"),
      onchainContractVersion: "v4",
      marginAddFinalization: {
        verificationState: "funding_verified",
        fundingVerified: true,
        marginFundingVerified: true,
        transferObserved: true,
        hypeReserveReady: true,
        hypeReserveState: "ready",
        finalPerpStateReadable: true,
        finalStateResynced: true,
        pauseStateSafe: true,
        perpAvailableMarginAfterUsd: 25,
        perpEquityAfterUsd: 25
      }
    },
    reconciliation: {
      status: "ok",
      checkedAt: "2026-04-29T00:00:00.000Z",
      detail: null,
      autoApplied: false,
      issues: [],
      sourceOfTruth: {
        principalAllocated: "onchain",
        principalReturned: "onchain",
        availableUsd: "onchain",
        claimedProfitUsd: "local_settlement",
        feePaidTotal: "onchain",
        fundingLifecycle: "derived",
        hypercoreFundingLifecycle: "derived",
        executionBalances: "execution"
      },
      onchainSnapshot: null,
      executionSnapshot: {
        state: "ok",
        coreSpotUsd: null,
        perpAvailableMarginUsd: 25,
        perpEquityUsd: 25,
        totalVisibleUsd: 25,
        detail: null
      }
    }
  };
  const readiness = evaluateBotVaultExecutionReadiness(row);
  const v4Readiness = evaluateBotVaultV4ExecutionReadiness(row);

  assert.equal(readiness.ready, true);
  assert.equal(v4Readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
  assert.equal(readiness.statusCategory, "execution_ready");
});

test("bot vault runtime reconciliation alias reads the stored compatibility key", () => {
  const reconciliation = readBotVaultReconciliation({
    botVaultV3Reconciliation: {
      status: "ok",
      executionSnapshot: {
        state: "ok",
        perpAvailableMarginUsd: 12,
        perpEquityUsd: 12
      }
    }
  });

  assert.equal(reconciliation?.status, "ok");
  assert.equal(readBotVaultV4Reconciliation({
    botVaultV3Reconciliation: reconciliation
  })?.status, "ok");
  assert.equal(reconciliation?.statusCategory, "execution_ready");
  assert.equal(reconciliation?.executionSnapshot.state, "ok");
});

test("bot vault v4 service facade creates the runtime service without changing compatibility keys", () => {
  const service = createBotVaultV4Service({});

  assert.equal(service.reconcileBotVaultById, service.reconcileBotVaultV3ById);
  assert.equal(service.reconcileBotVaultV4ById, service.reconcileBotVaultV3ById);
});

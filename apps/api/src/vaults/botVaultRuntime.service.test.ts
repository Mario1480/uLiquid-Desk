import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultFundingLifecycleMetadata } from "./botVaultRuntime.lifecycle.js";
import {
  createBotVaultRuntimeService,
  createBotVaultV4Service,
  evaluateBotVaultExecutionReadiness,
  evaluateBotVaultV4ExecutionReadiness,
  readBotVaultReconciliation,
  readBotVaultV4Reconciliation,
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
  assert.equal(service.fundBotVaultV4, service.fundBotVault);
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

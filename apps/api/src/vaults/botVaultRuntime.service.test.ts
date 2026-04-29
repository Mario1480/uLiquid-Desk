import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultFundingLifecycleMetadata } from "./botVaultRuntime.lifecycle.js";
import {
  createBotVaultRuntimeService,
  evaluateBotVaultExecutionReadiness,
  readBotVaultReconciliation,
  reconcileBotVaultById
} from "./botVaultRuntime.service.js";

test("bot vault runtime service exposes a neutral reconcile alias", async () => {
  const service = createBotVaultRuntimeService({});

  assert.equal(typeof service.reconcileBotVaultById, "function");
  assert.equal(service.reconcileBotVaultById, service.reconcileBotVaultV3ById);
});

test("bot vault runtime reconcile helper prefers the neutral method and supports legacy services", async () => {
  const preferred = await reconcileBotVaultById({
    reconcileBotVaultById: async () => ({ mode: "runtime" }),
    reconcileBotVaultV3ById: async () => ({ mode: "legacy" })
  } as any, { userId: "user_1", botVaultId: "vault_1" });

  const legacy = await reconcileBotVaultById({
    reconcileBotVaultV3ById: async (params: { botVaultId: string }) => ({ mode: "legacy", id: params.botVaultId })
  } as any, { userId: "user_1", botVaultId: "vault_2" });

  assert.deepEqual(preferred, { mode: "runtime" });
  assert.deepEqual(legacy, { mode: "legacy", id: "vault_2" });
});

test("bot vault runtime readiness alias evaluates a fully verified v4 vault as ready", () => {
  const readiness = evaluateBotVaultExecutionReadiness({
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
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
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
  assert.equal(reconciliation?.executionSnapshot.state, "ok");
});

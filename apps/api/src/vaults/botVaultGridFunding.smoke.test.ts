import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBotVaultFundingDisplayState,
  deriveBotVaultV3OperationState,
  evaluateBotVaultV3ExecutionReadiness
} from "./botVaultV3.service.js";
import { hasPendingBotVaultRuntimeReconciliation } from "../jobs/vaultOnchainReconciliationJob.js";

function buildOkReconciliation() {
  return {
    status: "ok",
    checkedAt: "2026-05-02T10:00:00.000Z",
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
      coreSpotUsd: 2,
      perpAvailableMarginUsd: 25,
      perpEquityUsd: 25,
      totalVisibleUsd: 27,
      detail: null
    }
  };
}

function buildExecutionReadyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_smoke",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v4",
    vaultAddress: `0x${"a".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    reconciliation: buildOkReconciliation(),
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-05-02T10:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified",
        verificationBlockingReason: null,
        fundingVerified: true,
        marginFundingVerified: true,
        transferObserved: true,
        finalPerpStateReadable: true,
        finalStateResynced: true,
        pauseStateSafe: true,
        hypeReserveState: "ready",
        hypeReserveReady: true,
        perpAvailableMarginAfterUsd: 25,
        perpEquityAfterUsd: 25
      }
    },
    ...overrides
  };
}

test("BotVault/GridBot smoke lifecycle blocks start and claim until funding reconciles", () => {
  const depositPendingRow = buildExecutionReadyRow({
    hypercoreFundingStatus: "pending",
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "hyper_evm_confirmed",
        updatedAt: "2026-05-02T10:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "transfer_submitted",
        verificationBlockingReason: "transfer_not_yet_observed",
        requestedAmountUsd: 25
      }
    }
  });
  const depositOperation = deriveBotVaultV3OperationState(depositPendingRow);
  const depositReadiness = evaluateBotVaultV3ExecutionReadiness(depositPendingRow);
  const depositDisplay = deriveBotVaultFundingDisplayState({
    row: depositPendingRow,
    operationState: depositOperation,
    executionReady: depositReadiness.ready,
    statusCategory: depositReadiness.statusCategory,
    statusReason: depositReadiness.reason,
    statusDetail: depositReadiness.detail,
    statusRecoveryHint: depositReadiness.recoveryHint
  });
  assert.equal(depositDisplay.status, "deposit_pending_reconciliation");
  assert.equal(depositReadiness.ready, false);
  assert.equal(hasPendingBotVaultRuntimeReconciliation(depositPendingRow), true);

  const confirmedFundingRow = buildExecutionReadyRow();
  const confirmedReadiness = evaluateBotVaultV3ExecutionReadiness(confirmedFundingRow);
  const confirmedDisplay = deriveBotVaultFundingDisplayState({
    row: confirmedFundingRow,
    operationState: deriveBotVaultV3OperationState(confirmedFundingRow),
    executionReady: confirmedReadiness.ready,
    statusCategory: confirmedReadiness.statusCategory,
    statusReason: confirmedReadiness.reason,
    statusDetail: confirmedReadiness.detail,
    statusRecoveryHint: confirmedReadiness.recoveryHint
  });
  assert.equal(confirmedReadiness.ready, true);
  assert.equal(confirmedDisplay.status, "funding_confirmed");
  assert.equal(hasPendingBotVaultRuntimeReconciliation(confirmedFundingRow), false);

  const withdrawPendingRow = buildExecutionReadyRow({
    executionMetadata: {
      ...buildExecutionReadyRow().executionMetadata,
      contractBalanceReconciliation: {
        state: "pending_reconciliation",
        reasonCode: "insufficient_contract_balance",
        action: "claim_profit",
        expectedAmountUsd: 5,
        expectedAmountAtomic: "5000000",
        actualBalanceAtomic: "0",
        updatedAt: "2026-05-02T10:05:00.000Z"
      }
    }
  });
  const withdrawOperation = deriveBotVaultV3OperationState(withdrawPendingRow);
  const withdrawDisplay = deriveBotVaultFundingDisplayState({
    row: withdrawPendingRow,
    operationState: withdrawOperation,
    executionReady: false,
    statusCategory: "blocked",
    statusReason: "insufficient_contract_balance",
    statusRecoveryHint: "retry_reconcile"
  });
  assert.equal(withdrawOperation?.step, "claim");
  assert.equal(withdrawOperation?.state, "pending_reconciliation");
  assert.equal(withdrawDisplay.status, "withdraw_pending_reconciliation");
  assert.equal(withdrawDisplay.nextRecommendedAction, "retry_reconcile");
  assert.equal(hasPendingBotVaultRuntimeReconciliation(withdrawPendingRow), true);

  const claimAfterReconcileDisplay = deriveBotVaultFundingDisplayState({
    row: confirmedFundingRow,
    operationState: null,
    executionReady: true,
    statusCategory: "execution_ready",
    statusReason: "funding_confirmed",
    statusRecoveryHint: "none"
  });
  assert.equal(claimAfterReconcileDisplay.status, "funding_confirmed");
  assert.equal(claimAfterReconcileDisplay.nextRecommendedAction, "none");
});

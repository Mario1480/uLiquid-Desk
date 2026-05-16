import {
  normalizeBotVaultV4StatusCategory,
  readBotVaultV3FundingLifecycleState
} from "./botVaultV3.lifecycle.js";
import {
  type BotVaultV3OperationState,
  type BotVaultV3OperationStateValue,
  type BotVaultV3OperationStep
} from "./botVaultFundingDisplay.js";
import {
  readBotVaultV3ClaimSettlementState,
  readBotVaultV3ControllerSettlementState,
  type BotVaultV3ClaimSettlementState,
  type BotVaultV3ControllerSettlementState
} from "./botVaultV3SettlementState.js";

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function readBotVaultV3AddressSemantics(row: unknown): {
  onchainBotVaultAddress: string | null;
} {
  const record = toRecord(row);
  return {
    onchainBotVaultAddress: toNullableString(record.onchainBotVaultAddress ?? record.vaultAddress)
  };
}

function buildBotVaultV3OperationState(input: {
  step: BotVaultV3OperationStep;
  state: BotVaultV3OperationStateValue;
  reasonCode: string;
  detail?: string | null;
  amountUsd?: number | null;
  txHash?: string | null;
  updatedAt?: string | null;
}): BotVaultV3OperationState {
  const nextRecommendedAction = (() => {
    if (input.state === "pending") return "submit";
    if (input.state === "submitted") return "wait";
    if (input.state === "pending_reconciliation") return "retry_reconcile";
    if (input.state === "failed_retryable") return "retry";
    if (input.state === "failed_final") {
      const reason = `${input.reasonCode}:${input.detail ?? ""}`.toLowerCase();
      return reason.includes("user_action") || reason.includes("insufficient") || reason.includes("missing")
        ? "request_user_action"
        : "recover";
    }
    return "none";
  })();
  return {
    step: input.step,
    state: input.state,
    reasonCode: input.reasonCode,
    detail: toNullableString(input.detail) ?? null,
    nextRecommendedAction,
    canRetry: input.state === "pending_reconciliation" || input.state === "failed_retryable",
    amountUsd: input.amountUsd == null ? null : roundUsd(toNonNegativeNumber(input.amountUsd), 6),
    txHash: toNullableString(input.txHash),
    updatedAt: toNullableString(input.updatedAt)
  };
}

function mapControllerSettlementOperationState(
  settlement: BotVaultV3ControllerSettlementState | null,
  step: "close" | "recover"
): BotVaultV3OperationState | null {
  if (!settlement) return null;
  const txHash = settlement.closeTxHash;
  if (settlement.stage === "applied" && settlement.postProcessing.state === "complete") {
    return buildBotVaultV3OperationState({
      step,
      state: "confirmed",
      reasonCode: `${settlement.sourceAction}_confirmed`,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt ?? settlement.appliedAt
    });
  }
  if (settlement.lastError) {
    return buildBotVaultV3OperationState({
      step,
      state: "pending_reconciliation",
      reasonCode: `${settlement.sourceAction}_pending_reconciliation`,
      detail: settlement.lastError,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt
    });
  }
  if (settlement.stage === "confirmed" || txHash) {
    return buildBotVaultV3OperationState({
      step,
      state: settlement.postProcessing.state === "pending" ? "pending_reconciliation" : "confirmed",
      reasonCode: settlement.postProcessing.state === "pending"
        ? `${settlement.sourceAction}_pending_reconciliation`
        : `${settlement.sourceAction}_confirmed`,
      detail: settlement.postProcessing.pendingSteps.join(",") || null,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt ?? settlement.confirmedAt
    });
  }
  return buildBotVaultV3OperationState({
    step,
    state: "pending",
    reasonCode: `${settlement.sourceAction}_prepared`,
    amountUsd: settlement.grossAmountUsd,
    txHash,
    updatedAt: settlement.updatedAt ?? settlement.preparedAt
  });
}

function mapClaimSettlementOperationState(
  settlement: BotVaultV3ClaimSettlementState | null
): BotVaultV3OperationState | null {
  if (!settlement) return null;
  if (settlement.stage === "applied" && settlement.postProcessing.state === "complete") {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: "confirmed",
      reasonCode: "claim_profit_confirmed",
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt ?? settlement.appliedAt
    });
  }
  if (settlement.lastError) {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: "pending_reconciliation",
      reasonCode: "claim_profit_pending_reconciliation",
      detail: settlement.lastError,
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt
    });
  }
  if (settlement.stage === "confirmed" || settlement.claimTxHash) {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: settlement.postProcessing.state === "pending" ? "pending_reconciliation" : "confirmed",
      reasonCode: settlement.postProcessing.state === "pending"
        ? "claim_profit_pending_reconciliation"
        : "claim_profit_confirmed",
      detail: settlement.postProcessing.pendingSteps.join(",") || null,
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt ?? settlement.confirmedAt
    });
  }
  return buildBotVaultV3OperationState({
    step: "claim",
    state: "pending",
    reasonCode: "claim_profit_prepared",
    amountUsd: settlement.grossAmountUsd,
    txHash: settlement.claimTxHash,
    updatedAt: settlement.updatedAt ?? settlement.preparedAt
  });
}

export function deriveBotVaultV3OperationState(row: unknown): BotVaultV3OperationState | null {
  const rowRecord = toRecord(row);
  const metadata = toRecord(rowRecord.executionMetadata);
  const contractBalanceReconciliation = toRecord(metadata.contractBalanceReconciliation);
  if (
    contractBalanceReconciliation.state === "pending_reconciliation"
    && contractBalanceReconciliation.reasonCode === "insufficient_contract_balance"
  ) {
    const action = String(contractBalanceReconciliation.action ?? "");
    const step: BotVaultV3OperationStep =
      action === "claim_profit" ? "claim"
        : action === "close_vault" ? "close"
        : action === "recover_closed_funds" ? "recover"
        : "hypercore_withdraw";
    return buildBotVaultV3OperationState({
      step,
      state: "pending_reconciliation",
      reasonCode: "insufficient_contract_balance",
      detail: `expected=${String(contractBalanceReconciliation.expectedAmountAtomic ?? "")};actual=${String(contractBalanceReconciliation.actualBalanceAtomic ?? "")}`,
      amountUsd: toNonNegativeNumber(contractBalanceReconciliation.expectedAmountUsd),
      updatedAt: toNullableString(contractBalanceReconciliation.updatedAt)
    });
  }

  const recoveryState = mapControllerSettlementOperationState(
    readBotVaultV3ControllerSettlementState({
      executionMetadata: metadata,
      metadataKey: "recoverySettlement",
      sourceAction: "recover_closed_funds"
    }),
    "recover"
  );
  if (recoveryState && recoveryState.state !== "confirmed") return recoveryState;

  const closeState = mapControllerSettlementOperationState(
    readBotVaultV3ControllerSettlementState({
      executionMetadata: metadata,
      metadataKey: "closeSettlement",
      sourceAction: "close_vault"
    }),
    "close"
  );
  if (closeState && closeState.state !== "confirmed") return closeState;

  const claimState = mapClaimSettlementOperationState(readBotVaultV3ClaimSettlementState(metadata));
  if (claimState && claimState.state !== "confirmed") return claimState;

  const reduceMarginFinalization = toRecord(metadata.reduceMarginFinalization);
  if (Object.keys(reduceMarginFinalization).length > 0) {
    const stage = String(reduceMarginFinalization.stage ?? "").trim().toLowerCase();
    const postReconcileState = String(reduceMarginFinalization.postReconcileState ?? "").trim().toLowerCase();
    const statusCategory = normalizeBotVaultV4StatusCategory(reduceMarginFinalization.statusCategory);
    const state: BotVaultV3OperationStateValue =
      postReconcileState === "recovery_required" || statusCategory === "recovery_required"
        ? "failed_final"
        : postReconcileState === "pending"
          ? "pending_reconciliation"
          : stage === "failed"
            ? "failed_retryable"
            : stage === "verified"
              ? "confirmed"
              : stage === "observed"
                ? "pending_reconciliation"
                : stage === "submitted"
                  ? "submitted"
                  : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hypercore_withdraw",
      state,
      reasonCode: toNullableString(reduceMarginFinalization.postReconcileReason)
        ?? toNullableString(reduceMarginFinalization.verificationBlockingReason)
        ?? toNullableString(reduceMarginFinalization.statusReason)
        ?? `reduce_margin_${stage || "pending"}`,
      detail: toNullableString(reduceMarginFinalization.error),
      amountUsd: toNonNegativeNumber(reduceMarginFinalization.releasedAmountUsd),
      txHash: toNullableString(reduceMarginFinalization.spotToEvmTransferTxHash)
        ?? toNullableString(reduceMarginFinalization.transferTxHash),
      updatedAt: toNullableString(reduceMarginFinalization.updatedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  if (Object.keys(marginAddFinalization).length > 0) {
    const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
    const failureClass = String(marginAddFinalization.hypeReserveFailureClass ?? "").trim().toLowerCase();
    const state: BotVaultV3OperationStateValue =
      marginAddFinalization.fundingVerified === true || verificationState === "funding_verified"
        ? "confirmed"
        : failureClass === "recovery_required" || marginAddFinalization.hypeReserveRequiresRecovery === true
          ? "failed_final"
          : failureClass === "user_action_required" || marginAddFinalization.hypeReserveNeedsUserAction === true
            ? "failed_final"
            : failureClass === "retryable"
              ? "failed_retryable"
              : verificationState === "transfer_observed"
                || verificationState === "hype_reserve_pending"
                || verificationState === "hype_reserve_retryable"
                ? "pending_reconciliation"
                : verificationState === "transfer_submitted"
                  ? "submitted"
                  : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state,
      reasonCode: toNullableString(marginAddFinalization.verificationBlockingReason)
        ?? toNullableString(marginAddFinalization.hypeReserveReasonCode)
        ?? `margin_add_${verificationState || "pending"}`,
      detail: toNullableString(marginAddFinalization.hypeReserveError),
      amountUsd: toNonNegativeNumber(marginAddFinalization.requestedAmountUsd),
      txHash: toNullableString(marginAddFinalization.transferTxHash)
        ?? toNullableString(marginAddFinalization.depositTxHash)
        ?? toNullableString(marginAddFinalization.activateTxHash),
      updatedAt: toNullableString(marginAddFinalization.updatedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const fundingIntent = toRecord(metadata.fundingIntent);
  if (Object.keys(fundingIntent).length > 0) {
    const actionStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
    const state: BotVaultV3OperationStateValue =
      actionStatus === "confirmed"
        ? "confirmed"
        : actionStatus === "submitted"
          ? "submitted"
          : actionStatus === "failed" || actionStatus === "timed_out"
            ? "failed_retryable"
            : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state,
      reasonCode: toNullableString(fundingIntent.timeoutReason)
        ?? toNullableString(fundingIntent.lastError)
        ?? `funding_${actionStatus || "pending"}`,
      detail: toNullableString(fundingIntent.sourceKey),
      amountUsd: toNonNegativeNumber(fundingIntent.amountUsd),
      txHash: toNullableString(fundingIntent.txHash),
      updatedAt: toNullableString(fundingIntent.updatedAt)
        ?? toNullableString(fundingIntent.timedOutAt)
        ?? toNullableString(fundingIntent.lastBoundAt)
        ?? toNullableString(fundingIntent.requestedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const fundingStatus = String(rowRecord.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(rowRecord.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const amountUsd = toNonNegativeNumber(rowRecord.principalAllocated ?? rowRecord.allocatedUsd ?? rowRecord.availableUsd);
  const updatedAt = rowRecord.updatedAt instanceof Date ? rowRecord.updatedAt.toISOString() : toNullableString(rowRecord.updatedAt);
  if (lifecycle.stage === "failed" || lifecycle.stage === "recovery_required") {
    const hasEvmFundingEvidence =
      fundingStatus === "hyper_evm_confirmed_onchain"
      || fundingStatus === "hyper_evm_funded"
      || hypercoreFundingStatus === "pending"
      || hypercoreFundingStatus === "funded";
    return buildBotVaultV3OperationState({
      step: hasEvmFundingEvidence ? "hypercore_funding" : "hyper_evm_deposit",
      state: lifecycle.stage === "failed" ? "failed_retryable" : "failed_final",
      reasonCode: lifecycle.recoveryReason ?? lifecycle.failureReason ?? `funding_${lifecycle.stage}`,
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (lifecycle.stage === "funding_requested" || fundingStatus === "hyper_evm_funding_requested") {
    return buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state: "pending",
      reasonCode: "funding_requested",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (onchainBotVaultAddress && lifecycle.stage === "deployed") {
    return buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state: "pending",
      reasonCode: "funding_not_started",
      amountUsd,
      updatedAt
    });
  }
  if (lifecycle.stage === "execution_ready" || lifecycle.stage === "settled") {
    return recoveryState ?? closeState ?? claimState ?? null;
  }
  if (lifecycle.stage === "perp_margin_transferred" || lifecycle.stage === "hype_reserve_ready") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending_reconciliation",
      reasonCode: "hypercore_final_state_unverified",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (hypercoreFundingStatus === "pending") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "submitted",
      reasonCode: "hypercore_transfer_pending",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (lifecycle.stage === "hypercore_funded" || hypercoreFundingStatus === "funded") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending",
      reasonCode: "perp_margin_not_started",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (
    lifecycle.stage === "hyper_evm_confirmed"
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
  ) {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending",
      reasonCode: "hypercore_funding_not_started",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }

  return recoveryState ?? closeState ?? claimState ?? null;
}

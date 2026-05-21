import {
  readBotVaultV3FundingLifecycleState,
  type BotVaultV3FundingLifecycleStage,
  type BotVaultV4RecoveryHint,
  type BotVaultV4StatusCategory
} from "./botVaultV3.lifecycle.js";

export type BotVaultV3OperationStep =
  | "hyper_evm_deposit"
  | "hypercore_funding"
  | "hypercore_withdraw"
  | "claim"
  | "close"
  | "recover";

export type BotVaultV3OperationStateValue =
  | "pending"
  | "submitted"
  | "confirmed"
  | "pending_reconciliation"
  | "failed_retryable"
  | "failed_final";

export type BotVaultV3OperationState = {
  step: BotVaultV3OperationStep;
  state: BotVaultV3OperationStateValue;
  reasonCode: string;
  detail: string | null;
  nextRecommendedAction: "submit" | "wait" | "retry" | "retry_reconcile" | "recover" | "request_user_action" | "none";
  canRetry: boolean;
  amountUsd: number | null;
  txHash: string | null;
  updatedAt: string | null;
};

export type BotVaultFundingDisplayStatus =
  | "deposit_pending_reconciliation"
  | "withdraw_pending_reconciliation"
  | "funding_confirmed"
  | "funding_failed_retryable"
  | "funding_failed_final"
  | "funding_pending";

export type BotVaultFundingDisplayState = {
  status: BotVaultFundingDisplayStatus;
  reasonCode: string;
  detail: string | null;
  recoveryHint: BotVaultV4RecoveryHint | null;
  nextRecommendedAction: BotVaultV3OperationState["nextRecommendedAction"];
};

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeFundingDisplayRecoveryHint(params: {
  status: BotVaultFundingDisplayStatus;
  operationState?: BotVaultV3OperationState | null;
  fallback?: BotVaultV4RecoveryHint | null;
}): BotVaultV4RecoveryHint | null {
  if (params.operationState?.state === "pending_reconciliation") return "retry_reconcile";
  if (params.operationState?.state === "failed_retryable") return "retry_reconcile";
  if (params.operationState?.state === "failed_final") {
    return params.operationState.nextRecommendedAction === "request_user_action"
      ? "request_user_action"
      : "run_recovery";
  }
  if (params.status === "funding_failed_retryable") return "retry_reconcile";
  if (params.status === "funding_failed_final") return params.fallback ?? "run_recovery";
  if (params.status === "funding_confirmed") return "none";
  return params.fallback ?? "none";
}

function buildBotVaultFundingDisplayState(params: {
  status: BotVaultFundingDisplayStatus;
  reasonCode?: string | null;
  detail?: string | null;
  recoveryHint?: BotVaultV4RecoveryHint | null;
  nextRecommendedAction?: BotVaultV3OperationState["nextRecommendedAction"] | null;
  operationState?: BotVaultV3OperationState | null;
}): BotVaultFundingDisplayState {
  const recoveryHint = normalizeFundingDisplayRecoveryHint({
    status: params.status,
    operationState: params.operationState,
    fallback: params.recoveryHint ?? null
  });
  return {
    status: params.status,
    reasonCode: toNullableString(params.reasonCode) ?? params.status,
    detail: toNullableString(params.detail),
    recoveryHint,
    nextRecommendedAction: params.nextRecommendedAction
      ?? params.operationState?.nextRecommendedAction
      ?? (params.status === "funding_confirmed" ? "none" : params.status === "funding_pending" ? "submit" : "wait")
  };
}

export function deriveBotVaultFundingDisplayState(params: {
  row?: unknown;
  operationState?: BotVaultV3OperationState | null;
  lifecycleStage?: BotVaultV3FundingLifecycleStage | string | null;
  fundingStatus?: string | null;
  hypercoreFundingStatus?: string | null;
  executionReady?: boolean | null;
  statusCategory?: BotVaultV4StatusCategory | string | null;
  statusReason?: string | null;
  statusDetail?: string | null;
  statusRecoveryHint?: BotVaultV4RecoveryHint | null;
  executionMetadata?: unknown;
}): BotVaultFundingDisplayState {
  const row = toRecord(params.row);
  const metadata = toRecord(params.executionMetadata ?? row.executionMetadata);
  const lifecycleStage = String(
    params.lifecycleStage ?? (Object.keys(row).length > 0 ? readBotVaultV3FundingLifecycleState(row).stage : "")
  ).trim().toLowerCase();
  const fundingStatus = String(params.fundingStatus ?? row.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(params.hypercoreFundingStatus ?? row.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const statusCategory = String(params.statusCategory ?? "").trim().toLowerCase();
  const operationState = params.operationState ?? null;

  if (lifecycleStage === "settled" || fundingStatus === "settled" || hypercoreFundingStatus === "withdrawn") {
    return buildBotVaultFundingDisplayState({
      status: "funding_confirmed",
      reasonCode: "settled",
      detail: params.statusDetail ?? "closed",
      recoveryHint: "none",
      nextRecommendedAction: "none"
    });
  }

  if (operationState) {
    if (operationState.state === "failed_retryable") {
      return buildBotVaultFundingDisplayState({
        status: "funding_failed_retryable",
        reasonCode: operationState.reasonCode,
        detail: operationState.detail,
        operationState
      });
    }
    if (operationState.state === "failed_final") {
      return buildBotVaultFundingDisplayState({
        status: "funding_failed_final",
        reasonCode: operationState.reasonCode,
        detail: operationState.detail,
        operationState
      });
    }
    if (
      (operationState.state === "pending"
        || operationState.state === "submitted"
        || operationState.state === "pending_reconciliation")
      && new Set<BotVaultV3OperationStep>(["hypercore_withdraw", "claim", "close", "recover"]).has(operationState.step)
    ) {
      return buildBotVaultFundingDisplayState({
        status: "withdraw_pending_reconciliation",
        reasonCode: operationState.reasonCode,
        detail: operationState.detail,
        operationState
      });
    }
  }

  if (params.executionReady === true || lifecycleStage === "execution_ready") {
    return buildBotVaultFundingDisplayState({
      status: "funding_confirmed",
      reasonCode: params.statusReason ?? "funding_confirmed",
      detail: params.statusDetail,
      recoveryHint: params.statusRecoveryHint ?? "none",
      nextRecommendedAction: "none"
    });
  }

  if (operationState) {
    if (
      operationState.state === "pending"
      || operationState.state === "submitted"
      || operationState.state === "pending_reconciliation"
    ) {
      return buildBotVaultFundingDisplayState({
        status: "deposit_pending_reconciliation",
        reasonCode: operationState.reasonCode,
        detail: operationState.detail,
        operationState
      });
    }
  }

  const lifecycleOverrideState = String(metadata.lifecycleOverrideState ?? "").trim().toLowerCase();
  const settlementStage = String(metadata.settlementStage ?? "").trim().toLowerCase();
  const contractBalanceReconciliation = toRecord(metadata.contractBalanceReconciliation);
  const hasWithdrawPendingSignal =
    lifecycleOverrideState === "withdraw_pending"
    || lifecycleOverrideState === "settling"
    || settlementStage === "perp_to_spot_pending"
    || settlementStage === "spot_to_evm_pending"
    || contractBalanceReconciliation.state === "pending_reconciliation";
  if (hasWithdrawPendingSignal) {
    return buildBotVaultFundingDisplayState({
      status: "withdraw_pending_reconciliation",
      reasonCode: params.statusReason ?? toNullableString(contractBalanceReconciliation.reasonCode) ?? settlementStage ?? lifecycleOverrideState,
      detail: params.statusDetail ?? toNullableString(contractBalanceReconciliation.detail),
      recoveryHint: params.statusRecoveryHint ?? "retry_reconcile",
      nextRecommendedAction: "retry_reconcile"
    });
  }

  if (statusCategory === "retryable" || lifecycleStage === "failed") {
    return buildBotVaultFundingDisplayState({
      status: "funding_failed_retryable",
      reasonCode: params.statusReason ?? "funding_failed_retryable",
      detail: params.statusDetail,
      recoveryHint: params.statusRecoveryHint ?? "retry_reconcile",
      nextRecommendedAction: "retry"
    });
  }

  if (statusCategory === "recovery_required" || lifecycleStage === "recovery_required") {
    return buildBotVaultFundingDisplayState({
      status: "funding_failed_final",
      reasonCode: params.statusReason ?? "funding_failed_final",
      detail: params.statusDetail,
      recoveryHint: params.statusRecoveryHint ?? "run_recovery",
      nextRecommendedAction: "recover"
    });
  }

  if (
    lifecycleStage === "funding_requested"
    || lifecycleStage === "hyper_evm_confirmed"
    || lifecycleStage === "hypercore_funded"
    || lifecycleStage === "perp_margin_transferred"
    || lifecycleStage === "hype_reserve_ready"
    || fundingStatus === "hyper_evm_funding_requested"
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || hypercoreFundingStatus === "pending"
  ) {
    return buildBotVaultFundingDisplayState({
      status: "deposit_pending_reconciliation",
      reasonCode: params.statusReason ?? "deposit_pending_reconciliation",
      detail: params.statusDetail,
      recoveryHint: params.statusRecoveryHint ?? "retry_reconcile",
      nextRecommendedAction: "retry_reconcile"
    });
  }

  return buildBotVaultFundingDisplayState({
    status: "funding_pending",
    reasonCode: params.statusReason ?? "funding_pending",
    detail: params.statusDetail,
    recoveryHint: params.statusRecoveryHint ?? "none",
    nextRecommendedAction: "submit"
  });
}

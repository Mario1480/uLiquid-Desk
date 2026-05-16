import { isAddress } from "viem";
import {
  BOT_VAULT_RUNTIME_MODEL_V3,
  BOT_VAULT_RUNTIME_MODEL_V4,
  botVaultRuntimeReasonCode
} from "@mm/core";
import {
  classifyBotVaultV4Mismatch,
  classifyBotVaultV4Status,
  deriveBotVaultV4RecoveryHint,
  normalizeBotVaultV4MismatchCategory,
  normalizeBotVaultV4MismatchRecoveryAction,
  normalizeBotVaultV4RecoveryHint,
  readBotVaultV3FundingLifecycleState,
  type BotVaultV4MismatchCategory,
  type BotVaultV4MismatchRecoveryAction,
  type BotVaultV4RecoveryHint,
  type BotVaultV4StatusCategory
} from "./botVaultV3.lifecycle.js";
import {
  deriveBotVaultFundingDisplayState,
  type BotVaultV3OperationState
} from "./botVaultFundingDisplay.js";
import { deriveBotVaultV3OperationState } from "./botVaultV3OperationState.js";
import {
  readBotVaultV3Reconciliation,
  type BotVaultV3Reconciliation
} from "./botVaultV3ReconciliationState.js";

const USD_VERIFICATION_EPSILON = 0.000001;

export type BotVaultV3ActionFlags = {
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
};

export type BotVaultV3HealthSummary = {
  lifecycleStatus: string;
  fundingHealth: string;
  onchainStateKnown: boolean;
  actionState: string;
  statusCategory: BotVaultV4StatusCategory;
  statusReason: string;
  statusDetail: string | null;
  statusMismatchCategory: BotVaultV4MismatchCategory | null;
  statusRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
  statusRecoveryHint: BotVaultV4RecoveryHint | null;
};

export type BotVaultV3ExecutionReadinessReason =
  | `bot_vault_v4_${string}`
  | "bot_vault_v3_ready"
  | "bot_vault_v3_onchain_vault_missing"
  | "bot_vault_v3_execution_blocked"
  | "bot_vault_v3_reconciliation_blocking_mismatch"
  | "bot_vault_v3_execution_lifecycle_not_ready"
  | "bot_vault_v3_funding_requested_not_confirmed"
  | "bot_vault_v4_funding_requested_not_confirmed"
  | "bot_vault_v3_hypercore_funding_not_started"
  | "bot_vault_v3_hypercore_transfer_pending"
  | "bot_vault_v3_hypercore_transfer_not_observed"
  | "bot_vault_v3_hype_reserve_not_ready"
  | "bot_vault_v4_funding_verification_missing"
  | "bot_vault_v4_hype_reserve_not_ready"
  | "bot_vault_v4_hype_reserve_not_verified"
  | "bot_vault_v4_perp_margin_not_verified"
  | "bot_vault_v4_perp_margin_not_visible"
  | "bot_vault_v4_reconciliation_snapshot_missing"
  | "bot_vault_v3_hypercore_final_state_unverified"
  | "bot_vault_v3_hypercore_pause_restore_unverified";

export type BotVaultV3ExecutionReadiness = {
  ready: boolean;
  stage: "ready" | "configuration" | "funding" | "transfer" | "verification" | "blocked";
  statusCategory: BotVaultV4StatusCategory;
  reason: BotVaultV3ExecutionReadinessReason;
  detail: string | null;
  fundingStatus: string;
  hypercoreFundingStatus: string;
  verificationState: string | null;
  verificationBlockingReason: string | null;
  mismatchCategory?: BotVaultV4MismatchCategory | null;
  recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
  recoveryHint?: BotVaultV4RecoveryHint | null;
};

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
  agentWalletAddress: string | null;
} {
  const record = toRecord(row);
  const onchainBotVaultAddress = toNullableString(record.onchainBotVaultAddress ?? record.vaultAddress);
  const agentWalletAddress = toNullableString(record.agentWalletAddress ?? record.agentWallet);
  return {
    onchainBotVaultAddress,
    agentWalletAddress
  };
}

function readBotVaultExecutionMetadata(value: unknown): Record<string, unknown> {
  return toRecord(value);
}

function readBotVaultOnchainContractVersion(value: unknown): "v3" | "v4" {
  const metadata = readBotVaultExecutionMetadata(value);
  return String(metadata.onchainContractVersion ?? "").trim().toLowerCase() === "v4" ? "v4" : "v3";
}

function resolveBotVaultRuntimeModelForContractVersion(contractVersion: "v3" | "v4"): "bot_vault_v3" | "bot_vault_v4" {
  return contractVersion === "v4" ? BOT_VAULT_RUNTIME_MODEL_V4 : BOT_VAULT_RUNTIME_MODEL_V3;
}

function readBotVaultHypeReserveState(value: unknown): string {
  const metadata = readBotVaultExecutionMetadata(value);
  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  const normalized = String(
    marginAddFinalization.hypeReserveState
    ?? metadata.hypeReserveState
    ?? ""
  ).trim().toLowerCase();
  return normalized || "not_required";
}

function computeClaimableProfitUsd(row: {
  availableUsd?: unknown;
  principalAllocated?: unknown;
  principalReturned?: unknown;
  executionMetadata?: unknown;
}): number {
  const executionMetadata = toRecord(row.executionMetadata);
  const excludedPrincipalUsd = roundUsd(
    toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
    6
  );
  const availableUsd = toNonNegativeNumber(row.availableUsd);
  const principalOutstanding = Math.max(
    0,
    toNonNegativeNumber(row.principalAllocated) - toNonNegativeNumber(row.principalReturned)
  );
  const effectivePrincipalOutstandingUsd = Math.max(0, principalOutstanding - excludedPrincipalUsd);
  return roundUsd(Math.max(0, availableUsd - effectivePrincipalOutstandingUsd));
}

export function buildBotVaultV3ActionFlags(row: unknown): BotVaultV3ActionFlags {
  const record = toRecord(row);
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const status = String(record.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(record.executionStatus ?? "").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const principalAllocated = toNonNegativeNumber(record.principalAllocated ?? record.allocatedUsd);
  const principalReturned = toNonNegativeNumber(record.principalReturned);
  const claimableProfitUsd = computeClaimableProfitUsd(record);
  const hasOnchainVault = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));
  const fundingConfirmedOnchain =
    principalAllocated > 0
    || principalReturned > 0
    || lifecycle.stage === "hyper_evm_confirmed"
    || lifecycle.stage === "hypercore_funded"
    || lifecycle.stage === "perp_margin_transferred"
    || lifecycle.stage === "hype_reserve_ready"
    || lifecycle.stage === "execution_ready"
    || lifecycle.stage === "settled";
  const operationState = deriveBotVaultV3OperationState(row);
  const hasBlockingOperationState = Boolean(operationState && operationState.state !== "confirmed");
  const executionReadiness = evaluateBotVaultV3ExecutionReadiness(row);
  const fundingDisplay = deriveBotVaultFundingDisplayState({
    row,
    operationState,
    lifecycleStage: lifecycle.stage,
    fundingStatus: toNullableString(record.fundingStatus),
    hypercoreFundingStatus: toNullableString(record.hypercoreFundingStatus),
    executionReady: executionReadiness.ready,
    statusCategory: executionReadiness.statusCategory,
    statusReason: executionReadiness.reason,
    statusDetail: executionReadiness.detail,
    statusRecoveryHint: executionReadiness.recoveryHint,
    executionMetadata: record.executionMetadata
  });
  const fundingActionsReady = fundingDisplay.status === "funding_confirmed" && !hasBlockingOperationState;
  const recoveryActionsReady = !hasBlockingOperationState
    && fundingDisplay.status !== "deposit_pending_reconciliation"
    && fundingDisplay.status !== "withdraw_pending_reconciliation"
    && fundingDisplay.status !== "funding_failed_retryable";

  return {
    hasOnchainVault,
    fundingConfirmedOnchain,
    canClaim: hasOnchainVault
      && fundingActionsReady
      && executionStatus !== "closed"
      && status !== "CLOSED"
      && claimableProfitUsd > USD_VERIFICATION_EPSILON,
    canClose: hasOnchainVault
      && fundingActionsReady
      && executionStatus !== "closed"
      && (status === "FUNDED" || status === "ACTIVE" || status === "PAUSED" || status === "CLOSE_ONLY"),
    canRecover: hasOnchainVault
      && recoveryActionsReady
      && fundingConfirmedOnchain
      && executionStatus === "closed"
      && (status === "CLOSE_ONLY" || status === "CLOSED"),
    canSetAgentWallet: true
  };
}

export function buildBotVaultV3HealthSummary(row: unknown): BotVaultV3HealthSummary {
  const record = toRecord(row);
  const { onchainBotVaultAddress, agentWalletAddress } = readBotVaultV3AddressSemantics(row);
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const status = String(record.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(record.executionStatus ?? "").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const executionMetadata = toRecord(record.executionMetadata);
  const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
  const hypeReserveFailureClass = String(marginAddFinalization.hypeReserveFailureClass ?? "").trim().toLowerCase();
  const hypeReserveReasonCode = toNullableString(marginAddFinalization.hypeReserveReasonCode);
  const hypeReserveDetail = toNullableString(marginAddFinalization.hypeReserveError);
  const fundingConfirmedOnchain = actionFlags.fundingConfirmedOnchain;
  const onchainStateKnown = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));

  let lifecycleStatus: string = lifecycle.stage;
  if (executionStatus === "closed") lifecycleStatus = "closed";
  else if (status === "ACTIVE" && lifecycle.stage === "execution_ready") lifecycleStatus = "active";
  else if (status === "PAUSED" && lifecycle.stage === "execution_ready") lifecycleStatus = "paused";
  else if (status === "CLOSE_ONLY") lifecycleStatus = "close_only";
  else if (status === "CLOSED" || lifecycle.stage === "settled") lifecycleStatus = "closed";

  let fundingHealth = "empty";
  if (lifecycle.stage === "funding_requested") fundingHealth = "requested";
  else if (lifecycle.stage === "hyper_evm_confirmed") fundingHealth = "confirmed_onchain";
  else if (lifecycle.stage === "hypercore_funded") fundingHealth = "hypercore_funded";
  else if (lifecycle.stage === "perp_margin_transferred") fundingHealth = "transfer_pending";
  else if (lifecycle.stage === "hype_reserve_ready") fundingHealth = "reserve_ready";
  else if (lifecycle.stage === "execution_ready") fundingHealth = "funded";
  else if (lifecycle.stage === "failed") fundingHealth = "failed";
  else if (lifecycle.stage === "recovery_required") fundingHealth = "recovery_required";
  else if (lifecycle.stage === "settled") fundingHealth = "settled";
  else if (fundingConfirmedOnchain) fundingHealth = "confirmed_onchain";

  let actionState = "idle";
  if (!agentWalletAddress && actionFlags.canSetAgentWallet) actionState = "agent_setup_required";
  else if (hypeReserveFailureClass === "user_action_required") actionState = "user_action_required";
  else if (hypeReserveFailureClass === "recovery_required" || fundingHealth === "recovery_required") actionState = "recovery_required";
  else if (actionFlags.canRecover) actionState = "recover_available";
  else if (actionFlags.canClaim) actionState = "claim_available";
  else if (actionFlags.canClose) actionState = "close_available";
  else if (
    fundingHealth === "requested"
    || fundingHealth === "confirmed_onchain"
    || fundingHealth === "hypercore_funded"
    || fundingHealth === "transfer_pending"
    || fundingHealth === "reserve_ready"
  ) actionState = "waiting_on_chain";
  else if (executionStatus === "closed" || lifecycleStatus === "closed") actionState = "closed";

  const statusDescriptor = classifyBotVaultV4Status({
    lifecycleStage: lifecycle.stage,
    reason: hypeReserveReasonCode ?? actionState ?? fundingHealth,
    detail: hypeReserveDetail ?? lifecycle.recoveryReason ?? lifecycle.failureReason ?? lifecycleStatus,
    mismatch: hypeReserveFailureClass
      ? classifyBotVaultV4Mismatch({
        reason: hypeReserveReasonCode ?? "bot_vault_v4_hype_reserve_incomplete",
        detail: hypeReserveDetail,
        failureClass: hypeReserveFailureClass,
        defaultCategory: "reserve_bootstrap_incomplete"
      })
      : null,
    fallbackCategory: lifecycle.stage === "settled"
      ? "settled"
      : actionState === "user_action_required" || actionState === "agent_setup_required"
        ? "user_action_required"
        : actionState === "recovery_required"
          ? "recovery_required"
          : lifecycle.stage === "execution_ready"
            ? "execution_ready"
            : "pending"
  });

  return {
    lifecycleStatus,
    fundingHealth,
    onchainStateKnown,
    actionState,
    statusCategory: statusDescriptor.category,
    statusReason: statusDescriptor.reason,
    statusDetail: statusDescriptor.detail,
    statusMismatchCategory: statusDescriptor.mismatchCategory,
    statusRecoveryAction: statusDescriptor.recoveryAction,
    statusRecoveryHint: statusDescriptor.recoveryHint
  };
}

export function evaluateBotVaultV3ExecutionReadiness(row: unknown): BotVaultV3ExecutionReadiness {
  const record = toRecord(row);
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const hasOnchainVault = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));
  const status = String(record.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(record.executionStatus ?? "").trim().toLowerCase();
  const fundingStatus = String(record.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(record.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const executionMetadata = toRecord(record.executionMetadata);
  const contractVersion = String(record.contractVersion ?? "").trim().toLowerCase() === "v4"
    ? "v4"
    : readBotVaultOnchainContractVersion(executionMetadata);
  const runtimeModel = resolveBotVaultRuntimeModelForContractVersion(contractVersion);
  const runtimeReason = (suffix: string): BotVaultV3ExecutionReadinessReason =>
    botVaultRuntimeReasonCode({ runtimeModel, suffix }) as BotVaultV3ExecutionReadinessReason;
  const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
  const reconciliation = record.reconciliation && typeof record.reconciliation === "object"
    ? record.reconciliation as BotVaultV3Reconciliation
    : readBotVaultV3Reconciliation(executionMetadata);
  const lifecycleOverrideState = String(executionMetadata.lifecycleOverrideState ?? "").trim().toLowerCase();
  const verificationState = toNullableString(marginAddFinalization.verificationState);
  const verificationBlockingReason = toNullableString(marginAddFinalization.verificationBlockingReason);
  const hypeReserveReasonCode = toNullableString(marginAddFinalization.hypeReserveReasonCode);
  const hypeReserveMismatchCategory = normalizeBotVaultV4MismatchCategory(marginAddFinalization.hypeReserveMismatchCategory);
  const hypeReserveRecoveryAction = normalizeBotVaultV4MismatchRecoveryAction(marginAddFinalization.hypeReserveRecoveryAction);
  const hypeReserveRecoveryHint = normalizeBotVaultV4RecoveryHint(marginAddFinalization.hypeReserveRecoveryHint)
    ?? deriveBotVaultV4RecoveryHint({
      mismatchCategory: hypeReserveMismatchCategory,
      recoveryAction: hypeReserveRecoveryAction
    });
  const hypeReserveState = readBotVaultHypeReserveState(executionMetadata);
  const transferObserved = marginAddFinalization.transferObserved === true;
  const fundingVerified = marginAddFinalization.fundingVerified === true;
  const marginFundingVerified = marginAddFinalization.marginFundingVerified === true;
  const hypeReserveReady = marginAddFinalization.hypeReserveReady === true;
  const finalPerpStateReadable = marginAddFinalization.finalPerpStateReadable === true;
  const finalStateResynced = marginAddFinalization.finalStateResynced === true;
  const pauseStateSafe = marginAddFinalization.pauseStateSafe !== false;
  const perpAvailableMarginAfterUsd = toNonNegativeNumber(marginAddFinalization.perpAvailableMarginAfterUsd);
  const perpEquityAfterUsd = toNonNegativeNumber(marginAddFinalization.perpEquityAfterUsd);
  const reconciliationExecutionSnapshot = reconciliation?.executionSnapshot ?? null;
  const reconciliationPerpEquityUsd = toNonNegativeNumber(reconciliationExecutionSnapshot?.perpEquityUsd);
  const reconciliationPerpAvailableMarginUsd = toNonNegativeNumber(reconciliationExecutionSnapshot?.perpAvailableMarginUsd);
  const primaryReconciliationIssue = reconciliation?.issues.find((issue) => issue.severity === "blocking")
    ?? reconciliation?.issues[0]
    ?? null;

  const buildResult = (
    ready: boolean,
    stage: BotVaultV3ExecutionReadiness["stage"],
    reason: BotVaultV3ExecutionReadinessReason,
    detail?: string | null,
    mismatchOverride?: {
      mismatchCategory?: BotVaultV4MismatchCategory | null;
      recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
      recoveryHint?: BotVaultV4RecoveryHint | null;
    }
  ): BotVaultV3ExecutionReadiness => {
    const normalizedDetail = toNullableString(detail);
    const mismatch = !ready && contractVersion === "v4"
      ? classifyBotVaultV4Mismatch({ reason, detail: normalizedDetail })
      : null;
    const mismatchCategory = mismatchOverride?.mismatchCategory ?? mismatch?.category ?? null;
    const recoveryAction = mismatchOverride?.recoveryAction ?? mismatch?.recoveryAction ?? null;
    const recoveryHint = mismatchOverride?.recoveryHint
      ?? deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
    const statusDescriptor = classifyBotVaultV4Status({
      ready,
      lifecycleStage: lifecycle.stage,
      readinessStage: stage,
      reconciliationStatus: reconciliation?.status ?? null,
      issueSeverity: primaryReconciliationIssue?.severity ?? null,
      reason,
      detail: normalizedDetail,
      mismatchCategory,
      recoveryAction,
      fallbackCategory: ready ? "execution_ready" : stage === "blocked" ? "blocked" : "pending"
    });
    return {
      ready,
      stage,
      statusCategory: statusDescriptor.category,
      reason,
      detail: normalizedDetail,
      fundingStatus,
      hypercoreFundingStatus,
      verificationState,
      verificationBlockingReason,
      mismatchCategory,
      recoveryAction,
      recoveryHint
    };
  };

  if (
    lifecycle.stage === "failed"
    || lifecycle.stage === "recovery_required"
    || status === "ERROR"
    || status === "CLOSE_ONLY"
    || status === "CLOSED"
    || executionStatus === "error"
    || executionStatus === "close_only"
    || executionStatus === "closed"
    || lifecycleOverrideState === "withdraw_pending"
    || lifecycleOverrideState === "settling"
    || lifecycleOverrideState === "close_only"
    || lifecycleOverrideState === "closed"
  ) {
    return buildResult(
      false,
      "blocked",
      runtimeReason("execution_blocked"),
      lifecycle.recoveryReason || lifecycle.failureReason || lifecycleOverrideState || executionStatus || status
    );
  }

  if (reconciliation?.status === "blocking") {
    return buildResult(
      false,
      "blocked",
      runtimeReason("reconciliation_blocking_mismatch"),
      primaryReconciliationIssue?.code ?? reconciliation.detail,
      {
        mismatchCategory: primaryReconciliationIssue?.mismatchCategory ?? null,
        recoveryAction: primaryReconciliationIssue?.recoveryAction ?? null,
        recoveryHint: primaryReconciliationIssue?.recoveryHint ?? null
      }
    );
  }

  if (!hasOnchainVault) {
    return buildResult(false, "configuration", runtimeReason("onchain_vault_missing"));
  }

  if (lifecycle.stage === "deployed") {
    return buildResult(
      false,
      "funding",
      runtimeReason("funding_requested_not_confirmed"),
      "deployed"
    );
  }

  if (lifecycle.stage === "funding_requested" || fundingStatus === "hyper_evm_funding_requested") {
    return buildResult(
      false,
      "funding",
      runtimeReason("funding_requested_not_confirmed")
    );
  }

  if (lifecycle.stage === "execution_ready") {
    if (contractVersion === "v4") {
      if (hypeReserveState !== "ready") {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_hype_reserve_not_ready",
          verificationBlockingReason || hypeReserveReasonCode || hypeReserveState || "hype_reserve_not_ready",
          {
            mismatchCategory: hypeReserveMismatchCategory,
            recoveryAction: hypeReserveRecoveryAction,
            recoveryHint: hypeReserveRecoveryHint
          }
        );
      }
      if (!hypeReserveReady) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_hype_reserve_not_verified",
          verificationBlockingReason || "hype_reserve_ready_flag_missing"
        );
      }
      if (verificationState !== "funding_verified" || !fundingVerified) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_funding_verification_missing",
          verificationBlockingReason || verificationState || "funding_verified_metadata_missing"
        );
      }
      if (!marginFundingVerified || !transferObserved || !finalPerpStateReadable || !finalStateResynced || !pauseStateSafe) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_verified",
          verificationBlockingReason
            || (!transferObserved ? "transfer_not_observed" : null)
            || (!marginFundingVerified ? "margin_funding_not_verified" : null)
            || (!finalPerpStateReadable ? "perp_state_read_unavailable" : null)
            || (!finalStateResynced ? "final_state_resync_unavailable" : null)
            || (!pauseStateSafe ? "paused_restore_unconfirmed" : null)
            || "perp_margin_verification_incomplete"
        );
      }
      if (perpEquityAfterUsd <= USD_VERIFICATION_EPSILON || perpAvailableMarginAfterUsd <= USD_VERIFICATION_EPSILON) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_verified",
          "perp_margin_after_missing"
        );
      }
      if (!reconciliation || reconciliationExecutionSnapshot?.state !== "ok") {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_reconciliation_snapshot_missing",
          reconciliationExecutionSnapshot?.detail || reconciliation?.detail || "reconciliation_execution_snapshot_missing"
        );
      }
      if (reconciliationPerpEquityUsd <= USD_VERIFICATION_EPSILON || reconciliationPerpAvailableMarginUsd <= USD_VERIFICATION_EPSILON) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_visible",
          `perp_equity:${reconciliationPerpEquityUsd};perp_available:${reconciliationPerpAvailableMarginUsd}`
        );
      }
      return buildResult(true, "ready", runtimeReason("ready"));
    }
    if (verificationState && verificationState !== "funding_verified") {
      return buildResult(
        false,
        verificationBlockingReason === "paused_restore_unconfirmed" ? "verification" : "transfer",
        verificationBlockingReason === "paused_restore_unconfirmed"
          ? "bot_vault_v3_hypercore_pause_restore_unverified"
          : "bot_vault_v3_hypercore_final_state_unverified",
        verificationBlockingReason
      );
    }
    return buildResult(true, "ready", runtimeReason("ready"));
  }

  if (
    contractVersion === "v4"
    && lifecycle.stage === "perp_margin_transferred"
    && hypeReserveState !== "ready"
  ) {
    return buildResult(
      false,
      "verification",
      "bot_vault_v4_hype_reserve_not_ready",
      verificationBlockingReason || hypeReserveReasonCode || hypeReserveState || "hype_reserve_not_ready",
      {
        mismatchCategory: hypeReserveMismatchCategory,
        recoveryAction: hypeReserveRecoveryAction,
        recoveryHint: hypeReserveRecoveryHint
      }
    );
  }

  if (
    verificationState === "funding_verified"
    || hypercoreFundingStatus === "funded"
    || executionStatus === "running"
    || executionStatus === "paused"
  ) {
    return buildResult(
      false,
      "verification",
      runtimeReason("execution_lifecycle_not_ready"),
      lifecycle.stage
    );
  }

  if (lifecycle.stage === "hypercore_funded") {
    return buildResult(false, "transfer", runtimeReason("hypercore_transfer_pending"));
  }

  if (lifecycle.stage === "hype_reserve_ready") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", runtimeReason("hypercore_pause_restore_unverified"), verificationBlockingReason);
    }
    return buildResult(false, "verification", runtimeReason("hypercore_final_state_unverified"), verificationBlockingReason);
  }

  if (lifecycle.stage === "perp_margin_transferred") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", runtimeReason("hypercore_pause_restore_unverified"), verificationBlockingReason);
    }
    return buildResult(false, "verification", runtimeReason("hypercore_final_state_unverified"), verificationBlockingReason);
  }

  if (hypercoreFundingStatus === "pending") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", runtimeReason("hypercore_pause_restore_unverified"), verificationBlockingReason);
    }
    if (
      verificationBlockingReason === "perp_state_read_unavailable"
      || verificationBlockingReason === "final_state_resync_unavailable"
      || verificationState === "transfer_observed"
    ) {
      return buildResult(false, "verification", runtimeReason("hypercore_final_state_unverified"), verificationBlockingReason);
    }
    if (
      verificationBlockingReason === "transfer_not_yet_observed"
      || verificationState === "transfer_submitted"
    ) {
      return buildResult(false, "transfer", runtimeReason("hypercore_transfer_not_observed"), verificationBlockingReason);
    }
    return buildResult(false, "transfer", runtimeReason("hypercore_transfer_pending"), verificationBlockingReason);
  }

  if (lifecycle.stage === "hyper_evm_confirmed" || fundingStatus === "hyper_evm_confirmed_onchain" || fundingStatus === "hyper_evm_funded") {
    return buildResult(false, "transfer", runtimeReason("hypercore_funding_not_started"));
  }

  return buildResult(
    false,
    "funding",
    runtimeReason("funding_requested_not_confirmed")
  );
}

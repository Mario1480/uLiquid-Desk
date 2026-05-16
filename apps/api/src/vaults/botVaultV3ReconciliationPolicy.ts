import {
  classifyBotVaultV4Mismatch,
  getBotVaultV3FundingLifecycleProgressIndex,
  type BotVaultV3FundingLifecycleStage,
  type BotVaultV4MismatchCategory,
  type BotVaultV4MismatchClassification
} from "./botVaultV3.lifecycle.js";
import type {
  BotVaultV3ExecutionStateSnapshot,
  BotVaultV3OnchainSnapshot
} from "./botVaultV3ReconciliationState.js";

const USD_VERIFICATION_EPSILON = 0.000001;

export type BotVaultV3LifecycleCounterEvidence = {
  code: string;
  severity: "warning" | "blocking";
  mismatch: BotVaultV4MismatchClassification | null;
  sourceOfTruth: "onchain" | "execution" | "derived";
  detail: string;
  targetStage: BotVaultV3FundingLifecycleStage;
  forceRecovery: boolean;
  observedValue: number | string | null;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function buildBotVaultV3ResyncUpdate(snapshot: BotVaultV3OnchainSnapshot, now = new Date()) {
  const data: Record<string, unknown> = {
    status: snapshot.status,
    principalAllocated: snapshot.principalAllocated,
    allocatedUsd: snapshot.principalAllocated,
    principalReturned: snapshot.principalReturned,
    availableUsd: snapshot.availableUsd,
    feePaidTotal: snapshot.feePaidTotal
  };

  const economicallyClosed = snapshot.status === "CLOSED"
    || (
      snapshot.status === "CLOSE_ONLY"
      && snapshot.availableUsd <= 0
      && snapshot.principalReturned > 0
    );

  if (economicallyClosed) {
    data.fundingStatus = "settled";
    data.hypercoreFundingStatus = "withdrawn";
    data.executionStatus = "closed";
    data.endedAt = now;
    data.closedAt = now;
    return data;
  }

  if (snapshot.principalAllocated > 0 || snapshot.availableUsd > 0) {
    data.fundingStatus = "hyper_evm_confirmed_onchain";
  }

  return data;
}

export function clearBotVaultV3ExecutionSettlementMetadataForClosedState(
  executionMetadata: Record<string, unknown>,
  settledAtIso: string
): Record<string, unknown> {
  const lifecycle = toRecord(executionMetadata.lifecycle);
  return {
    ...executionMetadata,
    lifecycle: {
      ...lifecycle,
      state: "closed",
      overrideState: null,
      updatedAt: settledAtIso,
      isTerminal: true,
      executionStatus: "closed",
      canAcceptNewOrders: false,
      needsIntervention: false,
      pendingActionType: null,
      pendingActionStatus: null
    },
    lifecycleOverrideState: null,
    settlementStage: null,
    settlementReadyAt: null,
    settlementLastUpdatedAt: null,
    settlementPerpToSpotAmountUsd: null,
    settlementPerpToSpotTxHash: null,
    settlementPerpToSpotStatus: null,
    settlementSpotToEvmAmountUsd: null,
    settlementSpotToEvmTxHash: null,
    settlementSpotToEvmStatus: null,
    settlementLastError: null,
    reconciliationMonitor: null
  };
}

function isBotVaultV3ProgressStageAtLeast(
  stage: BotVaultV3FundingLifecycleStage,
  minimum: BotVaultV3FundingLifecycleStage
): boolean {
  const stageIndex = getBotVaultV3FundingLifecycleProgressIndex(stage);
  const minimumIndex = getBotVaultV3FundingLifecycleProgressIndex(minimum);
  return stageIndex >= 0 && minimumIndex >= 0 && stageIndex >= minimumIndex;
}

function hasBotVaultV3OnchainFundingEvidence(snapshot: BotVaultV3OnchainSnapshot | null): boolean {
  if (!snapshot) return false;
  const status = String(snapshot.status ?? "").trim().toUpperCase();
  return (
    snapshot.principalAllocated > USD_VERIFICATION_EPSILON
    || snapshot.availableUsd > USD_VERIFICATION_EPSILON
    || status === "FUNDED"
    || status === "ACTIVE"
    || status === "PAUSED"
    || status === "CLOSE_ONLY"
    || status === "CLOSED"
  );
}

export function buildBotVaultV3LifecycleCounterEvidence(params: {
  currentStage: BotVaultV3FundingLifecycleStage;
  desiredStage: BotVaultV3FundingLifecycleStage;
  onchainSnapshot: BotVaultV3OnchainSnapshot | null;
  executionSnapshot: BotVaultV3ExecutionStateSnapshot;
  fundingIntentStatus: string;
  contractVersion: "v3" | "v4";
}): BotVaultV3LifecycleCounterEvidence | null {
  const executionStateKnown = params.executionSnapshot.state === "ok";
  const executionTotalUsd = toNonNegativeNumber(params.executionSnapshot.totalVisibleUsd);
  const executionPerpUsd = toNonNegativeNumber(params.executionSnapshot.perpEquityUsd);
  const executionSpotUsd = toNonNegativeNumber(params.executionSnapshot.coreSpotUsd);
  const onchainFundingEvidence = hasBotVaultV3OnchainFundingEvidence(params.onchainSnapshot);
  const executionFundingEvidence = executionStateKnown && executionTotalUsd > USD_VERIFICATION_EPSILON;
  const hasAnyFundingEvidence = onchainFundingEvidence || executionFundingEvidence;
  const hasContentSnapshot = Boolean(params.onchainSnapshot) || executionStateKnown;
  const buildV4Mismatch = (
    reason: string,
    detail: string,
    defaultCategory: BotVaultV4MismatchCategory = "local_ahead_of_observed_state"
  ) => params.contractVersion === "v4"
    ? classifyBotVaultV4Mismatch({ reason, detail, defaultCategory })
    : null;

  if (
    params.desiredStage === "failed"
    && params.fundingIntentStatus === "failed"
    && hasContentSnapshot
    && !hasAnyFundingEvidence
  ) {
    return {
      code: "funding_lifecycle_failed_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_failed_counterevidence",
        "funding action failed and no onchain or venue funding was observed"
      ),
      sourceOfTruth: "derived",
      detail: "funding action failed and no onchain or venue funding was observed",
      targetStage: "failed",
      forceRecovery: false,
      observedValue: params.fundingIntentStatus
    };
  }

  if (
    params.onchainSnapshot
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "hyper_evm_confirmed")
    && !hasAnyFundingEvidence
  ) {
    return {
      code: "funding_lifecycle_funding_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_funding_counterevidence",
        "local lifecycle requires funded capital, but the onchain snapshot shows no funding and no venue funds were observed"
      ),
      sourceOfTruth: "onchain",
      detail: "local lifecycle requires funded capital, but the onchain snapshot shows no funding and no venue funds were observed",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: params.onchainSnapshot.status
    };
  }

  if (
    executionStateKnown
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "hypercore_funded")
    && executionTotalUsd <= USD_VERIFICATION_EPSILON
  ) {
    return {
      code: "funding_lifecycle_hypercore_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_hypercore_counterevidence",
        "local lifecycle requires HyperCore funding, but venue balances show no visible Core or perp funds"
      ),
      sourceOfTruth: "execution",
      detail: "local lifecycle requires HyperCore funding, but venue balances show no visible Core or perp funds",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: executionTotalUsd
    };
  }

  if (
    executionStateKnown
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "perp_margin_transferred")
    && executionPerpUsd <= USD_VERIFICATION_EPSILON
    && executionSpotUsd > USD_VERIFICATION_EPSILON
  ) {
    return {
      code: "funding_lifecycle_perp_margin_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_perp_margin_counterevidence",
        "local lifecycle requires perp margin, but venue balances only show Core spot funds"
      ),
      sourceOfTruth: "execution",
      detail: "local lifecycle requires perp margin, but venue balances only show Core spot funds",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: executionSpotUsd
    };
  }

  if (
    executionStateKnown
    && (
      (params.currentStage === "execution_ready" && (
        params.desiredStage === "hype_reserve_ready"
        || params.desiredStage === "perp_margin_transferred"
      ))
      || (params.currentStage === "hype_reserve_ready" && params.desiredStage === "perp_margin_transferred")
    )
  ) {
    return {
      code: "funding_lifecycle_execution_ready_counterevidence",
      severity: "warning",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_execution_ready_counterevidence",
        `venue state supports ${params.desiredStage}, but not execution_ready`
      ),
      sourceOfTruth: "execution",
      detail: `venue state supports ${params.desiredStage}, but not execution_ready`,
      targetStage: params.desiredStage,
      forceRecovery: false,
      observedValue: executionTotalUsd
    };
  }

  return null;
}

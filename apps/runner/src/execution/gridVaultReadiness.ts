import {
  BOT_VAULT_RUNTIME_MODEL_V4,
  botVaultRuntimeReasonCode,
  deriveBotVaultLifecycleState,
  getBotVaultGridReadiness,
  isBotVaultRuntimeModelRow,
  resolveBotVaultRuntimeModel,
  type BotVaultGridReadinessResult
} from "@mm/core";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function buildReadyBotVaultGridReadiness(): BotVaultGridReadinessResult {
  return {
    ready: true,
    reasonCode: null,
    statusCategory: "execution_ready",
    recoveryHint: null,
    recoveryAction: null,
    mismatchCategory: null,
    detail: null,
    blockers: []
  };
}

function isRunnerBotVaultGridReadinessRequired(params: {
  executionExchange: string;
  botVaultExecution: unknown;
}): boolean {
  if (String(params.executionExchange ?? "").trim().toLowerCase() === "paper") return false;
  const botVault = asRecord(params.botVaultExecution);
  if (!botVault) return false;
  return isBotVaultRuntimeModelRow(botVault);
}

export function isRunnerBotVaultRuntimeExecution(botVaultExecution: unknown): boolean {
  return isBotVaultRuntimeModelRow(botVaultExecution);
}

export function runnerBotVaultMonitorKey(botVaultExecution: unknown, botVaultId: string): string {
  const runtimeModel = resolveBotVaultRuntimeModel(botVaultExecution) ?? BOT_VAULT_RUNTIME_MODEL_V4;
  return `${runtimeModel}:${botVaultId}`;
}

export function evaluateBotVaultGridReadinessForRunner(params: {
  executionExchange: string;
  botVaultExecution: unknown;
  userId: string;
  gridInstanceId: string;
  botId: string;
  minOrderQty?: number | null;
  minOrderNotionalUsd?: number | null;
  plannedOrderQty?: number | null;
  plannedOrderNotionalUsd?: number | null;
  requireOrderSize?: boolean;
}): BotVaultGridReadinessResult {
  if (!isRunnerBotVaultGridReadinessRequired({
    executionExchange: params.executionExchange,
    botVaultExecution: params.botVaultExecution
  })) {
    return buildReadyBotVaultGridReadiness();
  }

  const botVault = asRecord(params.botVaultExecution) ?? {};
  return getBotVaultGridReadiness({
    userId: params.userId,
    gridInstanceId: params.gridInstanceId,
    botId: params.botId,
    botVault: {
      ...botVault,
      userId: botVault.userId ?? params.userId,
      gridInstanceId: botVault.gridInstanceId ?? params.gridInstanceId,
      botId: botVault.botId ?? params.botId
    },
    minOrderQty: params.minOrderQty,
    minOrderNotionalUsd: params.minOrderNotionalUsd,
    plannedOrderQty: params.plannedOrderQty,
    plannedOrderNotionalUsd: params.plannedOrderNotionalUsd,
    requireOnchainActive: true,
    requireExecutionLifecycle: true,
    requireFunding: true,
    requirePerpFunding: true,
    requireOrderSize: params.requireOrderSize !== false
  });
}

export function serializeBotVaultGridReadiness(readiness: BotVaultGridReadinessResult): Record<string, unknown> {
  return {
    ready: readiness.ready,
    reasonCode: readiness.reasonCode,
    statusCategory: readiness.statusCategory,
    recoveryHint: readiness.recoveryHint,
    recoveryAction: readiness.recoveryAction,
    mismatchCategory: readiness.mismatchCategory,
    detail: readiness.detail,
    blockers: readiness.blockers.map((blocker) => ({
      reasonCode: blocker.reasonCode,
      statusCategory: blocker.statusCategory,
      recoveryHint: blocker.recoveryHint,
      recoveryAction: blocker.recoveryAction,
      mismatchCategory: blocker.mismatchCategory,
      detail: blocker.detail,
      step: blocker.step
    }))
  };
}

export function withGridHealthState(
  stateJson: Record<string, unknown>,
  health: {
    code: string;
    severity: "info" | "warning" | "error";
    reason?: string | null;
    details?: Record<string, unknown> | null;
    now: Date;
  } | null
): Record<string, unknown> {
  if (!health) {
    if (!("gridHealth" in stateJson)) return stateJson;
    const next = { ...stateJson };
    delete next.gridHealth;
    return next;
  }
  return {
    ...stateJson,
    gridHealth: {
      code: health.code,
      severity: health.severity,
      reason: health.reason ?? null,
      updatedAt: health.now.toISOString(),
      details: health.details ?? null
    }
  };
}

export function shouldAllowHyperliquidVaultBootstrap(params: {
  status?: unknown;
  executionStatus?: unknown;
  executionLastError?: unknown;
  executionMetadata?: unknown;
}): boolean {
  const lifecycle = deriveBotVaultLifecycleState({
    status: params.status,
    executionStatus: params.executionStatus,
    executionLastError: params.executionLastError,
    executionMetadata: params.executionMetadata
  });
  return lifecycle.mode === "normal" && (lifecycle.state === "bot_activation" || lifecycle.state === "execution_active");
}

function readBotVaultExecutionMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function readBotVaultOnchainContractVersion(value: unknown): "v3" | "v4" {
  return String(readBotVaultExecutionMetadataRecord(value).onchainContractVersion ?? "").trim().toLowerCase() === "v4"
    ? "v4"
    : "v3";
}

function readBotVaultHypeReserveState(value: unknown): string {
  const metadata = readBotVaultExecutionMetadataRecord(value);
  const marginAddFinalization = readBotVaultExecutionMetadataRecord(metadata.marginAddFinalization);
  return String(
    marginAddFinalization.hypeReserveState
    ?? metadata.hypeReserveState
    ?? ""
  ).trim().toLowerCase();
}

export function evaluateHyperliquidBotVaultExecutionReadiness(params: {
  vaultAddress?: unknown;
  status?: unknown;
  executionStatus?: unknown;
  executionLastError?: unknown;
  executionMetadata?: unknown;
  fundingStatus?: unknown;
  hypercoreFundingStatus?: unknown;
}): {
  ready: boolean;
  reason: string;
  detail: string | null;
} {
  const vaultAddress = String(params.vaultAddress ?? "").trim();
  const status = String(params.status ?? "").trim().toUpperCase();
  const executionStatus = String(params.executionStatus ?? "").trim().toLowerCase();
  const fundingStatus = String(params.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(params.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const executionMetadata =
    params.executionMetadata && typeof params.executionMetadata === "object" && !Array.isArray(params.executionMetadata)
      ? params.executionMetadata as Record<string, unknown>
      : {};
  const lifecycleOverrideState = String(executionMetadata.lifecycleOverrideState ?? "").trim().toLowerCase();
  const marginAddFinalization =
    executionMetadata.marginAddFinalization && typeof executionMetadata.marginAddFinalization === "object" && !Array.isArray(executionMetadata.marginAddFinalization)
      ? executionMetadata.marginAddFinalization as Record<string, unknown>
      : {};
  const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
  const verificationBlockingReason = String(marginAddFinalization.verificationBlockingReason ?? "").trim().toLowerCase();
  const fundingVerified =
    marginAddFinalization.fundingVerified === true
    || marginAddFinalization.marginFundingVerified === true;
  const transferObserved = marginAddFinalization.transferObserved === true;
  const finalPerpStateReadable = marginAddFinalization.finalPerpStateReadable === true;
  const finalStateResynced = marginAddFinalization.finalStateResynced === true;
  const contractVersion = readBotVaultOnchainContractVersion(executionMetadata);
  const runtimeModel = resolveBotVaultRuntimeModel({ executionMetadata, contractVersion }) ?? BOT_VAULT_RUNTIME_MODEL_V4;
  const runtimeReason = (suffix: string) => botVaultRuntimeReasonCode({ runtimeModel, suffix });
  const hypeReserveState = readBotVaultHypeReserveState(executionMetadata);

  if (!vaultAddress) {
    return { ready: false, reason: runtimeReason("onchain_vault_missing"), detail: null };
  }

  if (
    status === "ERROR"
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
    return {
      ready: false,
      reason: runtimeReason("execution_blocked"),
      detail: lifecycleOverrideState || executionStatus || status || String(params.executionLastError ?? "").trim() || null
    };
  }

  if (fundingStatus === "hyper_evm_funding_requested") {
    return { ready: false, reason: runtimeReason("funding_requested_not_confirmed"), detail: null };
  }

  if (hypercoreFundingStatus === "funded") {
    if (contractVersion === "v4" && hypeReserveState !== "ready") {
      return {
        ready: false,
        reason: runtimeReason("hype_reserve_not_ready"),
        detail: verificationBlockingReason || hypeReserveState || null
      };
    }
    if (
      contractVersion === "v4"
      && (
        verificationState !== "funding_verified"
        || !fundingVerified
        || !transferObserved
        || !finalPerpStateReadable
        || !finalStateResynced
      )
    ) {
      return {
        ready: false,
        reason: "bot_vault_v4_funding_verification_missing",
        detail: verificationBlockingReason
          || verificationState
          || (!fundingVerified ? "funding_verified_metadata_missing" : null)
          || (!transferObserved ? "transfer_not_observed" : null)
          || (!finalPerpStateReadable ? "perp_state_read_unavailable" : null)
          || (!finalStateResynced ? "final_state_resync_unavailable" : null)
          || "funding_verification_incomplete"
      };
    }
    if (verificationState && verificationState !== "funding_verified") {
      return {
        ready: false,
        reason: verificationBlockingReason === "paused_restore_unconfirmed"
          ? runtimeReason("hypercore_pause_restore_unverified")
          : runtimeReason("hypercore_final_state_unverified"),
        detail: verificationBlockingReason || verificationState || null
      };
    }
    return { ready: true, reason: runtimeReason("ready"), detail: null };
  }

  if (hypercoreFundingStatus === "pending") {
    if (contractVersion === "v4" && hypeReserveState !== "ready") {
      return {
        ready: false,
        reason: runtimeReason("hype_reserve_not_ready"),
        detail: verificationBlockingReason || hypeReserveState || null
      };
    }
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return { ready: false, reason: runtimeReason("hypercore_pause_restore_unverified"), detail: verificationBlockingReason };
    }
    if (
      verificationBlockingReason === "perp_state_read_unavailable"
      || verificationBlockingReason === "final_state_resync_unavailable"
      || verificationState === "transfer_observed"
    ) {
      return { ready: false, reason: runtimeReason("hypercore_final_state_unverified"), detail: verificationBlockingReason || verificationState || null };
    }
    if (verificationBlockingReason === "transfer_not_yet_observed" || verificationState === "transfer_submitted") {
      return { ready: false, reason: runtimeReason("hypercore_transfer_not_observed"), detail: verificationBlockingReason || verificationState || null };
    }
    return { ready: false, reason: runtimeReason("hypercore_transfer_pending"), detail: verificationBlockingReason || verificationState || null };
  }

  if (
    fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || fundingStatus === "deployed"
  ) {
    return { ready: false, reason: runtimeReason("hypercore_funding_not_started"), detail: null };
  }

  return { ready: false, reason: runtimeReason("funding_requested_not_confirmed"), detail: null };
}

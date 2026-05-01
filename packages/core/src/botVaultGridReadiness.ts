import { deriveBotVaultLifecycleState } from "./vaultLifecycle.js";

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizeStringUpper(value: unknown): string {
  return normalizeString(value).toUpperCase();
}

function readText(value: unknown): string | null {
  const text = normalizeString(value);
  return text || null;
}

function readId(value: unknown): string | null {
  const text = normalizeString(value);
  return text || null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function readNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return toRecord(source[key]);
}

const EVM_FUNDING_CONFIRMED_STATUSES = new Set([
  "hyper_evm_confirmed_onchain",
  "hyper_evm_funded",
  "confirmed",
  "funded"
]);
const HYPERCORE_FUNDING_CONFIRMED_STATUSES = new Set(["funded", "confirmed"]);
const PENDING_OPERATION_STATES = new Set([
  "pending",
  "submitted",
  "pending_reconciliation",
  "failed_retryable",
  "failed_final"
]);
const PENDING_ACTION_STATUSES = new Set(["prepared", "requested", "submitted", "pending"]);
const GRID_BLOCKING_METADATA_KEYS = [
  "contractBalanceReconciliation",
  "reduceMarginFinalization",
  "closeSettlement",
  "recoverySettlement",
  "claimSettlement"
] as const;

export type BotVaultGridReadinessStatusCategory =
  | "pending"
  | "retryable"
  | "recovery_required"
  | "user_action_required"
  | "blocked"
  | "execution_ready"
  | "settled";

export type BotVaultGridReadinessRecoveryHint =
  | "none"
  | "retry_reconcile"
  | "degrade_to_observed_state"
  | "run_recovery"
  | "request_user_action";

export type BotVaultGridReadinessRecoveryAction =
  | "none"
  | "retry"
  | "degrade"
  | "recovery_required"
  | "user_action_required";

export type BotVaultGridReadinessMismatchCategory =
  | "local_ahead_of_observed_state"
  | "observed_state_incomplete"
  | "funding_verification_missing"
  | "reserve_bootstrap_incomplete"
  | "post_transfer_reconcile_failed"
  | "manual_intervention_required";

export type BotVaultGridReadinessBlocker = {
  reasonCode: string;
  statusCategory: BotVaultGridReadinessStatusCategory;
  recoveryHint: BotVaultGridReadinessRecoveryHint | null;
  recoveryAction: BotVaultGridReadinessRecoveryAction | null;
  mismatchCategory: BotVaultGridReadinessMismatchCategory | null;
  detail: string | null;
  step: string | null;
  metadata?: Record<string, unknown>;
};

export type BotVaultGridReadinessResult = {
  ready: boolean;
  reasonCode: string | null;
  statusCategory: BotVaultGridReadinessStatusCategory;
  recoveryHint: BotVaultGridReadinessRecoveryHint | null;
  recoveryAction: BotVaultGridReadinessRecoveryAction | null;
  mismatchCategory: BotVaultGridReadinessMismatchCategory | null;
  detail: string | null;
  blockers: BotVaultGridReadinessBlocker[];
};

export type BotVaultGridReadinessInput = {
  userId?: unknown;
  gridInstanceId?: unknown;
  botId?: unknown;
  botVault?: unknown;
  executionReadiness?: unknown;
  operationState?: unknown;
  minOrderQty?: unknown;
  minOrderNotionalUsd?: unknown;
  plannedOrderQty?: unknown;
  plannedOrderNotionalUsd?: unknown;
  requireOnchainActive?: boolean;
  requireExecutionLifecycle?: boolean;
  requireFunding?: boolean;
  requirePerpFunding?: boolean;
  requireOrderSize?: boolean;
};

export class BotVaultGridReadinessError extends Error {
  readonly readiness: BotVaultGridReadinessResult;

  constructor(readiness: BotVaultGridReadinessResult) {
    super(readiness.reasonCode ?? "bot_vault_grid_not_ready");
    this.name = "BotVaultGridReadinessError";
    this.readiness = readiness;
  }
}

function normalizeStatusCategory(value: unknown, fallback: BotVaultGridReadinessStatusCategory): BotVaultGridReadinessStatusCategory {
  switch (normalizeStringLower(value)) {
    case "pending":
    case "retryable":
    case "recovery_required":
    case "user_action_required":
    case "blocked":
    case "execution_ready":
    case "settled":
      return normalizeStringLower(value) as BotVaultGridReadinessStatusCategory;
    default:
      return fallback;
  }
}

function normalizeRecoveryHint(value: unknown): BotVaultGridReadinessRecoveryHint | null {
  switch (normalizeStringLower(value)) {
    case "none":
    case "retry_reconcile":
    case "degrade_to_observed_state":
    case "run_recovery":
    case "request_user_action":
      return normalizeStringLower(value) as BotVaultGridReadinessRecoveryHint;
    default:
      return null;
  }
}

function normalizeRecoveryAction(value: unknown): BotVaultGridReadinessRecoveryAction | null {
  switch (normalizeStringLower(value)) {
    case "none":
    case "retry":
    case "degrade":
    case "recovery_required":
    case "user_action_required":
      return normalizeStringLower(value) as BotVaultGridReadinessRecoveryAction;
    default:
      return null;
  }
}

function normalizeMismatchCategory(value: unknown): BotVaultGridReadinessMismatchCategory | null {
  switch (normalizeStringLower(value)) {
    case "local_ahead_of_observed_state":
    case "observed_state_incomplete":
    case "funding_verification_missing":
    case "reserve_bootstrap_incomplete":
    case "post_transfer_reconcile_failed":
    case "manual_intervention_required":
      return normalizeStringLower(value) as BotVaultGridReadinessMismatchCategory;
    default:
      return null;
  }
}

function deriveRecoveryHint(params: {
  recoveryHint?: unknown;
  recoveryAction?: unknown;
  mismatchCategory?: unknown;
}): BotVaultGridReadinessRecoveryHint | null {
  const explicit = normalizeRecoveryHint(params.recoveryHint);
  if (explicit) return explicit;

  const action = normalizeRecoveryAction(params.recoveryAction);
  if (action === "retry") return "retry_reconcile";
  if (action === "degrade") return "degrade_to_observed_state";
  if (action === "recovery_required") return "run_recovery";
  if (action === "user_action_required") return "request_user_action";

  const category = normalizeMismatchCategory(params.mismatchCategory);
  if (category === "local_ahead_of_observed_state") return "degrade_to_observed_state";
  if (category === "manual_intervention_required") return "request_user_action";
  if (category) return "retry_reconcile";
  return null;
}

function operationStatusCategory(state: string): BotVaultGridReadinessStatusCategory {
  if (state === "failed_final") return "recovery_required";
  if (state === "failed_retryable") return "retryable";
  return "pending";
}

function operationRecoveryHint(state: string): BotVaultGridReadinessRecoveryHint {
  if (state === "failed_final") return "run_recovery";
  return "retry_reconcile";
}

function buildBlocker(params: {
  reasonCode: string;
  statusCategory?: BotVaultGridReadinessStatusCategory;
  recoveryHint?: BotVaultGridReadinessRecoveryHint | null;
  recoveryAction?: BotVaultGridReadinessRecoveryAction | null;
  mismatchCategory?: BotVaultGridReadinessMismatchCategory | null;
  detail?: string | null;
  step?: string | null;
  metadata?: Record<string, unknown>;
}): BotVaultGridReadinessBlocker {
  return {
    reasonCode: params.reasonCode,
    statusCategory: params.statusCategory ?? "blocked",
    recoveryHint: params.recoveryHint ?? null,
    recoveryAction: params.recoveryAction ?? null,
    mismatchCategory: params.mismatchCategory ?? null,
    detail: params.detail ?? null,
    step: params.step ?? null,
    ...(params.metadata ? { metadata: params.metadata } : {})
  };
}

function readExecutionReadiness(input: BotVaultGridReadinessInput, botVault: Record<string, unknown>): Record<string, unknown> {
  const explicit = toRecord(input.executionReadiness);
  if (Object.keys(explicit).length > 0) return explicit;
  return readNestedRecord(botVault, "executionReadiness");
}

function readOperationState(input: BotVaultGridReadinessInput, botVault: Record<string, unknown>): Record<string, unknown> {
  const explicit = toRecord(input.operationState);
  if (Object.keys(explicit).length > 0) return explicit;
  return readNestedRecord(botVault, "operationState");
}

function readReconciliation(botVault: Record<string, unknown>, executionMetadata: Record<string, unknown>): Record<string, unknown> {
  const explicit = readNestedRecord(botVault, "reconciliation");
  if (Object.keys(explicit).length > 0) return explicit;
  return readNestedRecord(executionMetadata, "reconciliation");
}

function readPrimaryReconciliationIssue(reconciliation: Record<string, unknown>): Record<string, unknown> {
  const issues = Array.isArray(reconciliation.issues)
    ? reconciliation.issues.map(toRecord)
    : [];
  return issues.find((issue) => normalizeStringLower(issue.severity) === "blocking")
    ?? issues[0]
    ?? {};
}

function readContractVersion(botVault: Record<string, unknown>, executionMetadata: Record<string, unknown>): string {
  const direct = normalizeStringLower(botVault.contractVersion);
  if (direct) return direct;
  const metadataVersion = normalizeStringLower(executionMetadata.onchainContractVersion);
  return metadataVersion || "";
}

function readMetadataOperationBlocker(executionMetadata: Record<string, unknown>): BotVaultGridReadinessBlocker | null {
  const contractBalanceReconciliation = readNestedRecord(executionMetadata, "contractBalanceReconciliation");
  if (normalizeStringLower(contractBalanceReconciliation.state) === "pending_reconciliation") {
    return buildBlocker({
      reasonCode: readText(contractBalanceReconciliation.reasonCode) ?? "bot_vault_grid_contract_balance_reconciliation_pending",
      statusCategory: "pending",
      recoveryHint: "retry_reconcile",
      detail: readText(contractBalanceReconciliation.detail)
        ?? `expected=${normalizeString(contractBalanceReconciliation.expectedAmountAtomic)};actual=${normalizeString(contractBalanceReconciliation.actualBalanceAtomic)}`,
      step: readText(contractBalanceReconciliation.action) ?? "contract_balance_reconciliation",
      metadata: {
        expectedAmountUsd: readNumber(contractBalanceReconciliation.expectedAmountUsd),
        actualBalanceUsd: readNumber(contractBalanceReconciliation.actualBalanceUsd)
      }
    });
  }

  const fundingIntent = readNestedRecord(executionMetadata, "fundingIntent");
  const fundingActionStatus = normalizeStringLower(fundingIntent.actionStatus);
  if (PENDING_ACTION_STATUSES.has(fundingActionStatus)) {
    return buildBlocker({
      reasonCode: readText(fundingIntent.reasonCode) ?? `bot_vault_grid_funding_intent_${fundingActionStatus || "pending"}`,
      statusCategory: "pending",
      recoveryHint: "retry_reconcile",
      detail: readText(fundingIntent.detail) ?? readText(fundingIntent.error),
      step: "hyper_evm_deposit"
    });
  }

  for (const key of GRID_BLOCKING_METADATA_KEYS) {
    const metadata = readNestedRecord(executionMetadata, key);
    if (Object.keys(metadata).length === 0) continue;
    const state = normalizeStringLower(metadata.state);
    const stage = normalizeStringLower(metadata.stage);
    const postReconcileState = normalizeStringLower(metadata.postReconcileState);
    const statusCategory = normalizeStatusCategory(metadata.statusCategory, "pending");
    const isComplete = state === "complete" || state === "confirmed" || stage === "verified" || stage === "applied";
    const isPending = state === "pending"
      || state === "pending_reconciliation"
      || state === "not_started"
      || stage === "submitted"
      || stage === "observed"
      || postReconcileState === "pending";
    const isFailed = stage === "failed"
      || postReconcileState === "recovery_required"
      || statusCategory === "recovery_required";
    if (isComplete && !isPending && !isFailed) continue;
    return buildBlocker({
      reasonCode: readText(metadata.reasonCode)
        ?? readText(metadata.postReconcileReason)
        ?? readText(metadata.verificationBlockingReason)
        ?? `bot_vault_grid_${key}_blocked`,
      statusCategory: isFailed ? "recovery_required" : statusCategory,
      recoveryHint: isFailed ? "run_recovery" : "retry_reconcile",
      detail: readText(metadata.detail) ?? readText(metadata.error) ?? readText(metadata.lastError),
      step: key
    });
  }

  return null;
}

function readPerpFundingBlocker(params: {
  botVault: Record<string, unknown>;
  executionMetadata: Record<string, unknown>;
  executionReadiness: Record<string, unknown>;
}): BotVaultGridReadinessBlocker | null {
  const contractVersion = readContractVersion(params.botVault, params.executionMetadata);
  const marginAddFinalization = readNestedRecord(params.executionMetadata, "marginAddFinalization");
  const verificationState = normalizeStringLower(marginAddFinalization.verificationState);
  const hasMarginMetadata = Object.keys(marginAddFinalization).length > 0;
  const verified = marginAddFinalization.fundingVerified === true
    || marginAddFinalization.marginFundingVerified === true
    || verificationState === "funding_verified";

  if (verified) return null;
  if (!hasMarginMetadata && contractVersion !== "v4") return null;

  const failureClass = normalizeStringLower(marginAddFinalization.hypeReserveFailureClass);
  const statusCategory: BotVaultGridReadinessStatusCategory =
    failureClass === "recovery_required" || marginAddFinalization.hypeReserveRequiresRecovery === true
      ? "recovery_required"
      : failureClass === "user_action_required" || marginAddFinalization.hypeReserveNeedsUserAction === true
        ? "user_action_required"
        : failureClass === "retryable"
          ? "retryable"
          : "pending";

  return buildBlocker({
    reasonCode: readText(marginAddFinalization.verificationBlockingReason)
      ?? readText(marginAddFinalization.hypeReserveReasonCode)
      ?? readText(params.executionReadiness.reason)
      ?? "bot_vault_grid_perp_funding_not_confirmed",
    statusCategory,
    recoveryHint: statusCategory === "recovery_required"
      ? "run_recovery"
      : statusCategory === "user_action_required"
        ? "request_user_action"
        : "retry_reconcile",
    detail: readText(marginAddFinalization.hypeReserveError)
      ?? readText(params.executionReadiness.detail)
      ?? readText(marginAddFinalization.verificationState),
    step: "perp_funding"
  });
}

function orderSizeBlockers(input: BotVaultGridReadinessInput): BotVaultGridReadinessBlocker[] {
  if (input.requireOrderSize === false) return [];
  const blockers: BotVaultGridReadinessBlocker[] = [];
  const plannedQty = readPositiveNumber(input.plannedOrderQty);
  const plannedNotional = readPositiveNumber(input.plannedOrderNotionalUsd);
  const minQty = readPositiveNumber(input.minOrderQty);
  const minNotional = readPositiveNumber(input.minOrderNotionalUsd);
  const epsilon = 1e-9;

  if (plannedQty !== null && minQty !== null && plannedQty + epsilon < minQty) {
    blockers.push(buildBlocker({
      reasonCode: "bot_vault_grid_order_qty_below_minimum",
      statusCategory: "user_action_required",
      recoveryHint: "request_user_action",
      detail: `planned=${plannedQty};min=${minQty}`,
      step: "order_size",
      metadata: { plannedQty, minQty }
    }));
  }
  if (plannedNotional !== null && minNotional !== null && plannedNotional + epsilon < minNotional) {
    blockers.push(buildBlocker({
      reasonCode: "bot_vault_grid_order_notional_below_minimum",
      statusCategory: "user_action_required",
      recoveryHint: "request_user_action",
      detail: `planned=${plannedNotional};min=${minNotional}`,
      step: "order_size",
      metadata: { plannedNotionalUsd: plannedNotional, minOrderNotionalUsd: minNotional }
    }));
  }
  return blockers;
}

export function getBotVaultGridReadiness(input: BotVaultGridReadinessInput): BotVaultGridReadinessResult {
  const botVault = toRecord(input.botVault);
  const blockers: BotVaultGridReadinessBlocker[] = [];
  const addBlocker = (blocker: BotVaultGridReadinessBlocker | null): void => {
    if (blocker) blockers.push(blocker);
  };

  if (Object.keys(botVault).length === 0) {
    blockers.push(buildBlocker({
      reasonCode: "bot_vault_grid_vault_missing",
      statusCategory: "user_action_required",
      recoveryHint: "request_user_action",
      step: "configuration"
    }));
  } else {
    const expectedUserId = readId(input.userId);
    const expectedGridInstanceId = readId(input.gridInstanceId);
    const expectedBotId = readId(input.botId);
    const vaultUserId = readId(botVault.userId);
    const vaultGridInstanceId = readId(botVault.gridInstanceId);
    const vaultBotId = readId(botVault.botId);
    const executionMetadata = readNestedRecord(botVault, "executionMetadata");
    const executionReadiness = readExecutionReadiness(input, botVault);
    const operationState = readOperationState(input, botVault);
    const reconciliation = readReconciliation(botVault, executionMetadata);

    if (expectedUserId && vaultUserId && expectedUserId !== vaultUserId) {
      blockers.push(buildBlocker({
        reasonCode: "bot_vault_grid_user_mismatch",
        statusCategory: "blocked",
        recoveryHint: "request_user_action",
        detail: `expected=${expectedUserId};actual=${vaultUserId}`,
        step: "assignment"
      }));
    }
    if (expectedGridInstanceId && vaultGridInstanceId && expectedGridInstanceId !== vaultGridInstanceId) {
      blockers.push(buildBlocker({
        reasonCode: "bot_vault_grid_instance_mismatch",
        statusCategory: "blocked",
        recoveryHint: "request_user_action",
        detail: `expected=${expectedGridInstanceId};actual=${vaultGridInstanceId}`,
        step: "assignment"
      }));
    }
    if (expectedBotId && vaultBotId && expectedBotId !== vaultBotId) {
      blockers.push(buildBlocker({
        reasonCode: "bot_vault_grid_bot_mismatch",
        statusCategory: "blocked",
        recoveryHint: "request_user_action",
        detail: `expected=${expectedBotId};actual=${vaultBotId}`,
        step: "assignment"
      }));
    }

    if (Object.keys(operationState).length > 0) {
      const operationStateValue = normalizeStringLower(operationState.state);
      if (PENDING_OPERATION_STATES.has(operationStateValue)) {
        addBlocker(buildBlocker({
          reasonCode: readText(operationState.reasonCode) ?? "bot_vault_grid_operation_blocker",
          statusCategory: normalizeStatusCategory(operationState.statusCategory, operationStatusCategory(operationStateValue)),
          recoveryHint: normalizeRecoveryHint(operationState.recoveryHint) ?? operationRecoveryHint(operationStateValue),
          recoveryAction: normalizeRecoveryAction(operationState.recoveryAction),
          mismatchCategory: normalizeMismatchCategory(operationState.mismatchCategory),
          detail: readText(operationState.detail),
          step: readText(operationState.step) ?? "operation"
        }));
      }
    }

    const primaryIssue = readPrimaryReconciliationIssue(reconciliation);
    if (normalizeStringLower(reconciliation.status) === "blocking" || normalizeStringLower(primaryIssue.severity) === "blocking") {
      addBlocker(buildBlocker({
        reasonCode: readText(primaryIssue.code) ?? readText(reconciliation.reasonCode) ?? "bot_vault_grid_reconciliation_blocking",
        statusCategory: normalizeStatusCategory(primaryIssue.statusCategory ?? reconciliation.statusCategory, "blocked"),
        recoveryHint: deriveRecoveryHint({
          recoveryHint: primaryIssue.recoveryHint ?? reconciliation.recoveryHint,
          recoveryAction: primaryIssue.recoveryAction ?? reconciliation.recoveryAction,
          mismatchCategory: primaryIssue.mismatchCategory ?? reconciliation.mismatchCategory
        }) ?? "retry_reconcile",
        recoveryAction: normalizeRecoveryAction(primaryIssue.recoveryAction ?? reconciliation.recoveryAction),
        mismatchCategory: normalizeMismatchCategory(primaryIssue.mismatchCategory ?? reconciliation.mismatchCategory),
        detail: readText(primaryIssue.detail) ?? readText(reconciliation.detail),
        step: "reconciliation"
      }));
    }

    addBlocker(readMetadataOperationBlocker(executionMetadata));

    if (executionReadiness.ready === false) {
      const statusCategory = normalizeStatusCategory(executionReadiness.statusCategory, "blocked");
      addBlocker(buildBlocker({
        reasonCode: readText(executionReadiness.reason) ?? "bot_vault_grid_execution_not_ready",
        statusCategory,
        recoveryHint: deriveRecoveryHint({
          recoveryHint: executionReadiness.recoveryHint,
          recoveryAction: executionReadiness.recoveryAction,
          mismatchCategory: executionReadiness.mismatchCategory
        }) ?? (statusCategory === "recovery_required"
          ? "run_recovery"
          : statusCategory === "user_action_required"
            ? "request_user_action"
            : "retry_reconcile"),
        recoveryAction: normalizeRecoveryAction(executionReadiness.recoveryAction),
        mismatchCategory: normalizeMismatchCategory(executionReadiness.mismatchCategory),
        detail: readText(executionReadiness.detail) ?? readText(executionReadiness.reason),
        step: readText(executionReadiness.stage) ?? "execution_readiness"
      }));
    }

    if (input.requireFunding !== false) {
      const fundingStatus = normalizeStringLower(botVault.fundingStatus);
      const hypercoreFundingStatus = normalizeStringLower(botVault.hypercoreFundingStatus);
      if (!EVM_FUNDING_CONFIRMED_STATUSES.has(fundingStatus)) {
        blockers.push(buildBlocker({
          reasonCode: "bot_vault_grid_evm_funding_not_confirmed",
          statusCategory: "pending",
          recoveryHint: "retry_reconcile",
          detail: fundingStatus || null,
          step: "hyper_evm_deposit"
        }));
      }
      if (!HYPERCORE_FUNDING_CONFIRMED_STATUSES.has(hypercoreFundingStatus)) {
        blockers.push(buildBlocker({
          reasonCode: "bot_vault_grid_hypercore_funding_not_confirmed",
          statusCategory: "pending",
          recoveryHint: "retry_reconcile",
          detail: hypercoreFundingStatus || null,
          step: "hypercore_funding"
        }));
      }
    }

    if (input.requirePerpFunding !== false) {
      addBlocker(readPerpFundingBlocker({ botVault, executionMetadata, executionReadiness }));
    }

    if (input.requireOnchainActive !== false) {
      const status = normalizeStringUpper(botVault.status);
      if (status !== "ACTIVE") {
        blockers.push(buildBlocker({
          reasonCode: "bot_vault_grid_vault_not_active",
          statusCategory: "blocked",
          recoveryHint: "retry_reconcile",
          detail: status || null,
          step: "activation"
        }));
      }
    }

    if (input.requireExecutionLifecycle !== false) {
      const lifecycle = deriveBotVaultLifecycleState({
        status: botVault.status,
        executionStatus: botVault.executionStatus,
        executionLastError: botVault.executionLastError,
        executionMetadata
      });
      if (!lifecycle.canAcceptNewOrders) {
        blockers.push(buildBlocker({
          reasonCode: "bot_vault_grid_execution_lifecycle_not_ready",
          statusCategory: lifecycle.needsIntervention ? "recovery_required" : "blocked",
          recoveryHint: lifecycle.needsIntervention ? "run_recovery" : "retry_reconcile",
          detail: lifecycle.state,
          step: "execution_lifecycle",
          metadata: {
            status: lifecycle.status,
            executionStatus: lifecycle.executionStatus,
            mode: lifecycle.mode
          }
        }));
      }
    }
  }

  blockers.push(...orderSizeBlockers(input));

  const primary = blockers[0] ?? null;
  return primary
    ? {
        ready: false,
        reasonCode: primary.reasonCode,
        statusCategory: primary.statusCategory,
        recoveryHint: primary.recoveryHint,
        recoveryAction: primary.recoveryAction,
        mismatchCategory: primary.mismatchCategory,
        detail: primary.detail,
        blockers
      }
    : {
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

export function assertBotVaultGridReadiness(input: BotVaultGridReadinessInput): BotVaultGridReadinessResult {
  const readiness = getBotVaultGridReadiness(input);
  if (!readiness.ready) throw new BotVaultGridReadinessError(readiness);
  return readiness;
}

import { logger } from "../logger.js";
import {
  BOT_VAULT_RUNTIME_MODEL_V4,
  botVaultRuntimeActionType,
  botVaultRuntimeReasonCode,
  isBotVaultRuntimeModelRow,
  normalizeBotVaultStatus,
  resolveBotVaultRuntimeModel
} from "@mm/core";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VaultReconciliationStatus } from "../vaults/reconciliation.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import { resolveHyperEvmWriteRpcUrl, resolveOnchainAddressBook } from "../vaults/onchainAddressBook.js";
import { createOnchainPublicClient, readBotVaultState, readBotVaultV3State, readMasterVaultState } from "../vaults/onchainProvider.js";
import type { ExecutionLifecycleService } from "../vaults/executionLifecycle.service.js";
import { createOnchainActionService, type OnchainActionService } from "../vaults/onchainAction.service.js";
import { sendSerializedControllerTransaction } from "../vaults/controllerTransaction.js";
import { botVaultV3Abi } from "../vaults/onchainAbi.js";
import {
  buildBotVaultFundingLifecycleTransitionPatch,
  type BotVaultRuntimeMismatchCategory,
  type BotVaultRuntimeMismatchRecoveryAction,
  compareBotVaultFundingLifecycleStage,
  getBotVaultFundingLifecycleStage
} from "../vaults/botVaultRuntime.lifecycle.js";

const POLL_MS = Math.max(15, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_INTERVAL_SECONDS ?? "60")) * 1000;
const MASTER_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_MASTER_LIMIT ?? "100"));
const BOT_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_BOT_LIMIT ?? "200"));
const EPSILON = 0.000001;
const LOW_HYPE_STATE_KEY_PREFIX = "vault.agent_low_hype.v1:";
const erc20BalanceOfAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const botVaultV3FundedEventAbi = parseAbi([
  "event Funded(address indexed from, uint256 amount, uint256 principalDepositedAfter)"
]);
const BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS = BigInt(Math.max(
  128,
  Number(process.env.VAULT_ONCHAIN_V3_FUNDING_TX_LOOKBACK_BLOCKS ?? "50000")
));
const BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES = Math.max(
  1,
  Math.trunc(Number(process.env.VAULT_BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES ?? "15") || 15)
);
const BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS = BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES * 60_000;
const BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES = ["create_bot_vault_v3", "create_bot_vault_v4", "launch_bot_vault_from_funding_vault"] as const;
const BOT_VAULT_RUNTIME_FUND_ACTION_TYPES = ["fund_bot_vault_v3", "fund_bot_vault_v4", "fund_bot_vault_from_funding_vault"] as const;
const MONEY_FLOW_PENDING_ALERT_MS = Math.max(
  60,
  Math.trunc(Number(process.env.BOTVAULT_MONEY_FLOW_PENDING_ALERT_SECONDS ?? "600") || 600)
) * 1000;
const MONEY_FLOW_ALERT_SOURCE = "vault_onchain_reconciliation";
const MONEY_FLOW_ALERT_TYPES = [
  "botvault_deposit_pending_reconciliation",
  "botvault_withdraw_pending_reconciliation",
  "botvault_contract_balance_mismatch",
  "botvault_reconcile_job_degraded"
] as const;

function isGridExecutionActive(row: any): boolean {
  const state = String(row?.state ?? "").trim().toLowerCase();
  const stateJson = row?.stateJson && typeof row.stateJson === "object" && !Array.isArray(row.stateJson)
    ? row.stateJson as Record<string, unknown>
    : {};
  const provisioning = stateJson.provisioning && typeof stateJson.provisioning === "object" && !Array.isArray(stateJson.provisioning)
    ? stateJson.provisioning as Record<string, unknown>
    : {};
  return state === "running" || String(provisioning.phase ?? "").trim().toLowerCase() === "execution_active";
}

type VaultOnchainReconciliationIssueClass = "okay_to_swallow" | "recoverable_track" | "must_fail";

type BotVaultRuntimeReconcileService = {
  reconcileBotVaultById?: (params: {
    userId: string;
    botVaultId: string;
    persist?: boolean;
    throwOnPersistFailure?: boolean;
  }) => Promise<unknown>;
  reconcileBotVaultV3ById?: (params: {
    userId: string;
    botVaultId: string;
    persist?: boolean;
    throwOnPersistFailure?: boolean;
  }) => Promise<unknown>;
  reconcileBotVaultV4ById?: (params: {
    userId: string;
    botVaultId: string;
    persist?: boolean;
    throwOnPersistFailure?: boolean;
  }) => Promise<unknown>;
};

function stringifyJobError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function jobIssueMetadata(params: {
  issueClass: VaultOnchainReconciliationIssueClass;
  mismatchCategory?: BotVaultRuntimeMismatchCategory | null;
  recoveryAction?: BotVaultRuntimeMismatchRecoveryAction | null;
  retryable?: boolean;
  error?: unknown;
  [key: string]: unknown;
}): Record<string, unknown> {
  const {
    issueClass,
    mismatchCategory = null,
    recoveryAction = null,
    retryable,
    error,
    ...rest
  } = params;
  return {
    ...rest,
    issueClass,
    mismatchCategory,
    recoveryAction,
    retryable: retryable ?? recoveryAction === "retry",
    ...(error === undefined ? {} : { error: stringifyJobError(error) })
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSignal(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseDateMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function includesAnySignal(value: unknown, signals: readonly string[]): boolean {
  const normalized = normalizeSignal(value);
  return normalized.length > 0 && signals.some((signal) => normalized.includes(signal));
}

type PendingMoneyFlowState = {
  type: typeof MONEY_FLOW_ALERT_TYPES[number];
  severity: "warning" | "critical";
  title: string;
  message: string;
  pendingKind: "deposit" | "withdraw" | "contract_balance" | "reconcile_job";
  pendingSinceMs: number | null;
  reasonCode: string;
  recoveryHint: string;
  txHash: string | null;
  idempotencyKey: string | null;
  expectedBalanceUsd: number | null;
  actualBalanceUsd: number | null;
};

function toFiniteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPendingMoneyFlowState(row: unknown): PendingMoneyFlowState | null {
  const normalizedRow = toRecord(row);
  const metadata = toRecord(normalizedRow.executionMetadata);
  const contractBalanceReconciliation = toRecord(metadata.contractBalanceReconciliation);
  if (normalizeSignal(contractBalanceReconciliation.state) === "pending_reconciliation") {
    return {
      type: "botvault_contract_balance_mismatch",
      severity: "critical",
      title: "BotVault contract balance pending reconciliation",
      message: "BotVault contract USDC balance is below the expected settlement amount.",
      pendingKind: "contract_balance",
      pendingSinceMs: parseDateMs(contractBalanceReconciliation.pendingAt ?? contractBalanceReconciliation.updatedAt),
      reasonCode: String(contractBalanceReconciliation.reasonCode ?? "insufficient_contract_balance"),
      recoveryHint: "retry_reconcile",
      txHash: typeof contractBalanceReconciliation.txHash === "string" ? contractBalanceReconciliation.txHash : null,
      idempotencyKey: typeof contractBalanceReconciliation.idempotencyKey === "string" ? contractBalanceReconciliation.idempotencyKey : null,
      expectedBalanceUsd: toFiniteNumberOrNull(contractBalanceReconciliation.expectedAmountUsd),
      actualBalanceUsd: toFiniteNumberOrNull(contractBalanceReconciliation.actualBalanceUsd)
    };
  }

  const claimSpotToEvmTransfer = toRecord(metadata.claimSpotToEvmTransfer);
  if (["pending", "submitted", "pending_reconciliation"].includes(normalizeSignal(claimSpotToEvmTransfer.state))) {
    return {
      type: "botvault_withdraw_pending_reconciliation",
      severity: "warning",
      title: "BotVault claim transfer pending reconciliation",
      message: "Claim settlement is waiting for Spot-to-EVM transfer visibility.",
      pendingKind: "withdraw",
      pendingSinceMs: parseDateMs(claimSpotToEvmTransfer.pendingAt ?? claimSpotToEvmTransfer.updatedAt),
      reasonCode: String(claimSpotToEvmTransfer.errorCode ?? claimSpotToEvmTransfer.status ?? "claim_profit_pending_reconciliation"),
      recoveryHint: "retry_reconcile",
      txHash: typeof claimSpotToEvmTransfer.txHash === "string" ? claimSpotToEvmTransfer.txHash : null,
      idempotencyKey: typeof claimSpotToEvmTransfer.idempotencyKey === "string" ? claimSpotToEvmTransfer.idempotencyKey : null,
      expectedBalanceUsd: toFiniteNumberOrNull(claimSpotToEvmTransfer.expectedEvmBalanceAfterUsd ?? claimSpotToEvmTransfer.requiredAmountUsd),
      actualBalanceUsd: toFiniteNumberOrNull(claimSpotToEvmTransfer.evmBalanceBeforeUsd)
    };
  }

  const reduceMarginFinalization = toRecord(metadata.reduceMarginFinalization);
  if (includesAnySignal(reduceMarginFinalization.spotToEvmTransferStatus, [
    "transfer_pending_reconciliation",
    "transfer_submitted",
    "pending_timeout"
  ])) {
    return {
      type: "botvault_withdraw_pending_reconciliation",
      severity: "warning",
      title: "BotVault reduce-margin transfer pending reconciliation",
      message: "Reduce-margin settlement is waiting for Spot-to-EVM transfer visibility.",
      pendingKind: "withdraw",
      pendingSinceMs: parseDateMs(reduceMarginFinalization.updatedAt),
      reasonCode: String(reduceMarginFinalization.spotToEvmTransferStatus ?? "reduce_margin_pending_reconciliation"),
      recoveryHint: "retry_reconcile",
      txHash: typeof reduceMarginFinalization.spotToEvmTransferTxHash === "string" ? reduceMarginFinalization.spotToEvmTransferTxHash : null,
      idempotencyKey: typeof reduceMarginFinalization.idempotencyKey === "string" ? reduceMarginFinalization.idempotencyKey : null,
      expectedBalanceUsd: toFiniteNumberOrNull(reduceMarginFinalization.evmExpectedAfterUsd ?? reduceMarginFinalization.expectedEvmBalanceAfterUsd),
      actualBalanceUsd: toFiniteNumberOrNull(reduceMarginFinalization.evmBalanceAfterUsd ?? reduceMarginFinalization.evmBalanceBeforeUsd)
    };
  }

  if (includesAnySignal(metadata.initialCoreSpotDepositStatus, [
    "deposit_pending_reconciliation",
    "deposit_pending_timeout",
    "pending_timeout"
  ])) {
    return {
      type: "botvault_deposit_pending_reconciliation",
      severity: "warning",
      title: "BotVault deposit pending reconciliation",
      message: "HyperCore deposit receipt is not yet visible in the reconciled balance.",
      pendingKind: "deposit",
      pendingSinceMs: parseDateMs(metadata.initialCoreSpotDepositPendingAt ?? metadata.initialCoreSpotDepositLastCheckedAt),
      reasonCode: String(metadata.initialCoreSpotDepositStatus ?? "deposit_pending_reconciliation"),
      recoveryHint: "retry_reconcile",
      txHash: typeof metadata.initialCoreSpotDepositTxHash === "string" ? metadata.initialCoreSpotDepositTxHash : null,
      idempotencyKey: typeof metadata.initialCoreSpotDepositIdempotencyKey === "string" ? metadata.initialCoreSpotDepositIdempotencyKey : null,
      expectedBalanceUsd: toFiniteNumberOrNull(metadata.initialCoreSpotDepositAmountUsd),
      actualBalanceUsd: toFiniteNumberOrNull(metadata.initialCoreSpotDepositObservedAmountUsd)
    };
  }

  return null;
}

async function upsertMoneyFlowPlatformAlert(params: {
  db: any;
  row: any;
  pending: PendingMoneyFlowState;
  now: Date;
}): Promise<void> {
  if (typeof params.db.platformAlert?.findFirst !== "function" || typeof params.db.platformAlert?.create !== "function") return;
  const pendingSinceMs = params.pending.pendingSinceMs ?? params.now.getTime();
  const ageMs = params.now.getTime() - pendingSinceMs;
  if (!Number.isFinite(ageMs) || ageMs < MONEY_FLOW_PENDING_ALERT_MS) return;
  const userId = String(params.row.userId ?? "").trim() || null;
  const botId = String(params.row.botId ?? "").trim() || null;
  const metadata = {
    botVaultId: String(params.row.id ?? ""),
    gridInstanceId: params.row.gridInstanceId ? String(params.row.gridInstanceId) : null,
    vaultAddress: params.row.vaultAddress ? String(params.row.vaultAddress) : null,
    pendingKind: params.pending.pendingKind,
    pendingAgeSeconds: Math.trunc(ageMs / 1000),
    pendingSince: new Date(pendingSinceMs).toISOString(),
    reasonCode: params.pending.reasonCode,
    recoveryHint: params.pending.recoveryHint,
    txHash: params.pending.txHash,
    idempotencyKey: params.pending.idempotencyKey,
    expectedBalanceUsd: params.pending.expectedBalanceUsd,
    actualBalanceUsd: params.pending.actualBalanceUsd
  };
  const existing = await params.db.platformAlert.findFirst({
    where: {
      source: MONEY_FLOW_ALERT_SOURCE,
      type: params.pending.type,
      status: { in: ["open", "acknowledged"] },
      ...(userId ? { userId } : {}),
      ...(botId ? { botId } : {})
    },
    orderBy: [{ updatedAt: "desc" }]
  }).catch(() => null);
  if (existing?.id && typeof params.db.platformAlert.update === "function") {
    await params.db.platformAlert.update({
      where: { id: existing.id },
      data: {
        severity: params.pending.severity,
        title: params.pending.title,
        message: params.pending.message,
        metadata
      }
    }).catch(() => undefined);
    return;
  }
  await params.db.platformAlert.create({
    data: {
      severity: params.pending.severity,
      status: "open",
      type: params.pending.type,
      source: MONEY_FLOW_ALERT_SOURCE,
      title: params.pending.title,
      message: params.pending.message,
      userId,
      botId,
      metadata
    }
  }).catch(() => undefined);
}

async function resolveMoneyFlowPlatformAlerts(params: {
  db: any;
  row: any;
}): Promise<void> {
  if (typeof params.db.platformAlert?.updateMany !== "function") return;
  const userId = String(params.row.userId ?? "").trim() || null;
  const botId = String(params.row.botId ?? "").trim() || null;
  await params.db.platformAlert.updateMany({
    where: {
      source: MONEY_FLOW_ALERT_SOURCE,
      type: { in: [...MONEY_FLOW_ALERT_TYPES] },
      status: { in: ["open", "acknowledged"] },
      ...(userId ? { userId } : {}),
      ...(botId ? { botId } : {})
    },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedByUserId: null
    }
  }).catch(() => undefined);
}

async function upsertReconcileJobPlatformAlert(params: {
  db: any;
  severity: "warning" | "critical";
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (typeof params.db.platformAlert?.findFirst !== "function" || typeof params.db.platformAlert?.create !== "function") return;
  const existing = await params.db.platformAlert.findFirst({
    where: {
      source: MONEY_FLOW_ALERT_SOURCE,
      type: "botvault_reconcile_job_degraded",
      status: { in: ["open", "acknowledged"] }
    },
    orderBy: [{ updatedAt: "desc" }]
  }).catch(() => null);
  if (existing?.id && typeof params.db.platformAlert.update === "function") {
    await params.db.platformAlert.update({
      where: { id: existing.id },
      data: {
        severity: params.severity,
        title: params.title,
        message: params.message,
        metadata: params.metadata
      }
    }).catch(() => undefined);
    return;
  }
  await params.db.platformAlert.create({
    data: {
      severity: params.severity,
      status: "open",
      type: "botvault_reconcile_job_degraded",
      source: MONEY_FLOW_ALERT_SOURCE,
      title: params.title,
      message: params.message,
      metadata: params.metadata
    }
  }).catch(() => undefined);
}

async function resolveReconcileJobPlatformAlert(db: any): Promise<void> {
  if (typeof db.platformAlert?.updateMany !== "function") return;
  await db.platformAlert.updateMany({
    where: {
      source: MONEY_FLOW_ALERT_SOURCE,
      type: "botvault_reconcile_job_degraded",
      status: { in: ["open", "acknowledged"] }
    },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedByUserId: null
    }
  }).catch(() => undefined);
}

export function hasPendingBotVaultRuntimeReconciliation(row: unknown): boolean {
  const normalizedRow = toRecord(row);
  if (!isBotVaultRuntimeModelRow(normalizedRow)) return false;
  const metadata = toRecord(normalizedRow.executionMetadata);
  const fundingLifecycle = toRecord(metadata.fundingLifecycle);
  const lifecycleStage = normalizeSignal(fundingLifecycle.stage);
  if (
    lifecycleStage
    && lifecycleStage !== "execution_ready"
    && lifecycleStage !== "settled"
    && lifecycleStage !== "deployed"
  ) {
    return true;
  }

  const fundingIntent = toRecord(metadata.fundingIntent);
  if (["prepared", "submitted", "confirmed", "requested", "timed_out"].includes(normalizeSignal(fundingIntent.actionStatus))) {
    return true;
  }

  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  if (includesAnySignal(marginAddFinalization.verificationState, [
    "transfer_submitted",
    "transfer_observed",
    "hype_reserve_pending",
    "hype_reserve_retryable",
    "post_reconcile_pending"
  ])) {
    return true;
  }

  if (includesAnySignal(metadata.initialCoreSpotDepositStatus, [
    "deposit_pending_reconciliation",
    "deposit_pending_timeout",
    "pending_timeout"
  ])) {
    return true;
  }

  const contractBalanceReconciliation = toRecord(metadata.contractBalanceReconciliation);
  if (normalizeSignal(contractBalanceReconciliation.state) === "pending_reconciliation") return true;

  const reduceMarginFinalization = toRecord(metadata.reduceMarginFinalization);
  const reduceMarginStage = normalizeSignal(reduceMarginFinalization.stage);
  const reduceMarginPostReconcileState = normalizeSignal(reduceMarginFinalization.postReconcileState);
  if (
    reduceMarginStage
    && !["verified", "applied", "not_required"].includes(reduceMarginStage)
    && reduceMarginStage !== "failed"
  ) {
    return true;
  }
  if (["pending", "recovery_required"].includes(reduceMarginPostReconcileState)) return true;
  if (includesAnySignal(reduceMarginFinalization.spotToEvmTransferStatus, [
    "transfer_pending_reconciliation",
    "transfer_submitted",
    "transfer_pending_timeout",
    "pending_timeout"
  ])) {
    return true;
  }

  const lifecycleOverrideState = normalizeSignal(metadata.lifecycleOverrideState);
  const settlementStage = normalizeSignal(metadata.settlementStage);
  if (["withdraw_pending", "settling"].includes(lifecycleOverrideState)) return true;
  if (["perp_to_spot_pending", "spot_to_evm_pending"].includes(settlementStage)) return true;

  for (const key of ["claimSettlement", "closeSettlement", "recoverySettlement"]) {
    const settlement = toRecord(metadata[key]);
    const postProcessing = toRecord(settlement.postProcessing);
    if (normalizeSignal(postProcessing.state) === "pending") return true;
  }

  return false;
}

function readClosedRecoveryCompensationUsd(event: { amount?: unknown; metadata?: unknown }): number {
  const metadata = toRecord(event.metadata);
  if (String(metadata.sourceType ?? "") !== "admin_closed_vault_compensation") return 0;
  if (metadata.creditToMasterVaultBalance !== true) return 0;
  const amount = Number(event.amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw as `0x${string}` : null;
}

function normalizeTxHash(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(raw) ? raw as `0x${string}` : null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  try {
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function usdToAtomic(value: unknown): bigint | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return BigInt(Math.round(parsed * 1_000_000));
}

function parseIsoDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readBotVaultV3FundingIntentTimeout(params: {
  row: {
    vaultModel?: unknown;
    executionMetadata?: unknown;
    fundingStatus?: unknown;
    hypercoreFundingStatus?: unknown;
    principalAllocated?: unknown;
    status?: unknown;
  };
  chainStatus: string;
  principalAllocated: number;
}): {
  actionKey: string | null;
  actionStatus: string;
  timeoutAt: string;
  timedOutAt: string;
  pendingMinutes: number;
  reason: string;
  detail: string;
} | null {
  if (getBotVaultFundingLifecycleStage(params.row) !== "funding_requested") return null;

  const metadata = toRecord(params.row.executionMetadata);
  const fundingIntent = toRecord(metadata.fundingIntent);
  const actionStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
  if (!["prepared", "submitted", "confirmed", "requested"].includes(actionStatus)) return null;

  const fundingStatus = String(params.row.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(params.row.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const hasOnchainFundingEvidence =
    params.principalAllocated > EPSILON
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || hypercoreFundingStatus === "pending"
    || hypercoreFundingStatus === "funded"
    || hypercoreFundingStatus === "withdrawn"
    || ["FUNDED", "ACTIVE", "PAUSED", "CLOSE_ONLY", "CLOSED"].includes(params.chainStatus);
  if (hasOnchainFundingEvidence) return null;

  const pendingSince = parseIsoDate(fundingIntent.lastBoundAt)
    ?? parseIsoDate(fundingIntent.requestedAt)
    ?? parseIsoDate(toRecord(metadata.fundingLifecycle).updatedAt);
  if (!pendingSince) return null;

  const timeoutAt = parseIsoDate(fundingIntent.timeoutAt)
    ?? new Date(pendingSince.getTime() + BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS);
  const now = new Date();
  if (timeoutAt.getTime() > now.getTime()) return null;

  const sourceKey = String(fundingIntent.sourceKey ?? "").trim();
  const pendingMinutes = Math.max(
    BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES,
    Math.trunc((now.getTime() - pendingSince.getTime()) / 60_000)
  );
  const reason = `${resolveBotVaultRuntimeModel(params.row) ?? BOT_VAULT_RUNTIME_MODEL_V4}_funding_intent_timeout:${actionStatus}`;
  return {
    actionKey: String(fundingIntent.actionKey ?? "").trim() || null,
    actionStatus,
    timeoutAt: timeoutAt.toISOString(),
    timedOutAt: now.toISOString(),
    pendingMinutes,
    reason,
    detail: sourceKey
      ? `${sourceKey} pending for ${pendingMinutes}m without funding confirmation`
      : `funding intent pending for ${pendingMinutes}m without funding confirmation`
  };
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deriveLowHypeState(balanceWei: string | null, thresholdHype: number, stale: boolean): "ok" | "low" | "unavailable" {
  if (!balanceWei) return "unavailable";
  if (stale) return "unavailable";
  const formatted = Number(formatUnits(BigInt(balanceWei), 18));
  if (!Number.isFinite(formatted)) return "unavailable";
  return formatted <= Math.max(0, thresholdHype) + EPSILON ? "low" : "ok";
}

function hasFundingReadyForExecution(row: {
  vaultModel?: unknown;
  fundingStatus?: unknown;
  hypercoreFundingStatus?: unknown;
  executionMetadata?: unknown;
}): boolean {
  if (!isBotVaultRuntimeModelRow(row)) return true;
  return getBotVaultFundingLifecycleStage(row) === "execution_ready";
}

function normalizeExecutionStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function deriveV3ReconciledLifecycleState(params: {
  chainStatus: string;
  principalReturned: number;
  usdcBalanceUsd: number | null;
  row: {
    fundingStatus?: unknown;
    hypercoreFundingStatus?: unknown;
    executionStatus?: unknown;
    executionMetadata?: unknown;
    status?: unknown;
  };
}) {
  const economicallyClosed = params.chainStatus === "CLOSED"
    || (
      params.chainStatus === "CLOSE_ONLY"
      && params.usdcBalanceUsd !== null
      && params.usdcBalanceUsd <= EPSILON
      && params.principalReturned > EPSILON
    );
  if (economicallyClosed) {
    return {
      economicallyClosed: true,
      fundingStatus: "settled",
      hypercoreFundingStatus: "withdrawn",
      executionStatus: "closed",
      targetStage: "settled" as const
    } as const;
  }
  return {
    economicallyClosed: false,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    targetStage: "hyper_evm_confirmed" as const
  } as const;
}

function shouldQueueBotVaultV3AutoActivate(metadata: unknown): boolean {
  const record = toRecord(metadata);
  const activateStatus = String(record.autoActivateStatus ?? "").trim().toLowerCase();
  const hypercoreStatus = String(record.autoHypercoreFundingStatus ?? "").trim().toLowerCase();
  if (hypercoreStatus === "confirmed") return false;
  if (activateStatus === "submitted" && hypercoreStatus === "submitted") return false;
  return true;
}

async function recoverBotVaultV3FundingTxHash(params: {
  client: any;
  botVaultAddress: `0x${string}`;
  actionMetadata?: unknown;
  principalAllocated?: unknown;
  botVaultId?: string;
  reason?: string;
}): Promise<`0x${string}` | null> {
  const latestBlock = await params.client.getBlockNumber().catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_tx_recovery_block_read_failed", jobIssueMetadata({
      issueClass: "okay_to_swallow",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      error
    }));
    return null;
  });
  if (typeof latestBlock !== "bigint") return null;

  const fromBlock = latestBlock > BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS
    ? latestBlock - BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS
    : 0n;
  const logs = await params.client.getLogs({
    address: params.botVaultAddress,
    event: botVaultV3FundedEventAbi[0],
    fromBlock,
    toBlock: latestBlock
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_tx_recovery_logs_failed", jobIssueMetadata({
      issueClass: "okay_to_swallow",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
      error
    }));
    return [];
  });
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const metadata = toRecord(params.actionMetadata);
  const expectedAmountAtomic = readBigInt(metadata.amountAtomic);
  const expectedPrincipalAfterAtomic = usdToAtomic(params.principalAllocated);
  let bestMatch: {
    txHash: `0x${string}`;
    score: number;
    blockNumber: bigint;
    logIndex: number;
  } | null = null;

  for (const log of logs) {
    const txHash = normalizeTxHash(log.transactionHash);
    if (!txHash) continue;

    const args = toRecord(log.args);
    const amountAtomic = readBigInt(args.amount);
    const principalAfterAtomic = readBigInt(args.principalDepositedAfter);
    let score = 0;

    if (expectedAmountAtomic !== null) {
      if (amountAtomic !== expectedAmountAtomic) continue;
      score += 4;
    }
    if (expectedPrincipalAfterAtomic !== null && principalAfterAtomic === expectedPrincipalAfterAtomic) {
      score += 2;
    }
    if (score === 0 && logs.length !== 1) continue;

    const candidate = {
      txHash,
      score,
      blockNumber: BigInt(log.blockNumber ?? 0n),
      logIndex: Number(log.logIndex ?? 0)
    };
    if (
      !bestMatch
      || candidate.score > bestMatch.score
      || (
        candidate.score === bestMatch.score
        && (
          candidate.blockNumber > bestMatch.blockNumber
          || (candidate.blockNumber === bestMatch.blockNumber && candidate.logIndex > bestMatch.logIndex)
        )
      )
    ) {
      bestMatch = candidate;
    }
  }

  return bestMatch?.txHash ?? null;
}

async function reconcileBotVaultV3FundingAction(params: {
  db: any;
  onchainActionService?: Pick<OnchainActionService, "markActionConfirmedByTxHash" | "submitActionTxHash"> | null;
  client: any;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
  runtimeModel?: unknown;
  principalAllocated?: unknown;
  recoverBotVaultV3FundingTxHash?: typeof recoverBotVaultV3FundingTxHash;
  reason?: string;
}): Promise<`0x${string}` | null> {
  if (!params.onchainActionService || typeof params.db.onchainAction?.findFirst !== "function") return null;
  const runtimeModel = resolveBotVaultRuntimeModel(params.runtimeModel) ?? BOT_VAULT_RUNTIME_MODEL_V4;
  const fundingActionType = botVaultRuntimeActionType({ runtimeModel, action: "fund" });

  const action = await params.db.onchainAction.findFirst({
    where: {
      botVaultId: params.botVaultId,
      actionType: {
        in: [...BOT_VAULT_RUNTIME_FUND_ACTION_TYPES]
      },
      status: {
        in: ["prepared", "submitted", "failed"]
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userId: true,
      txHash: true,
      metadata: true
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_action_read_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      actionType: fundingActionType,
      error
    }));
    return null;
  });
  if (!action) return null;

  const existingTxHash = normalizeTxHash(action.txHash);
  if (existingTxHash) {
    await params.onchainActionService.markActionConfirmedByTxHash({
      txHash: existingTxHash,
      status: "confirmed"
    }).catch((error: unknown) => {
      logger.warn("vault_onchain_reconciliation_v3_funding_action_confirm_failed", jobIssueMetadata({
        issueClass: "recoverable_track",
        mismatchCategory: "funding_verification_missing",
        recoveryAction: "retry",
        reason: params.reason,
        botVaultId: params.botVaultId,
        vaultAddress: params.botVaultAddress,
        actionId: action.id,
        txHash: existingTxHash,
        error
      }));
    });
    return existingTxHash;
  }

  if (typeof params.onchainActionService.submitActionTxHash !== "function") return null;
  const recoverFundingTxHash = params.recoverBotVaultV3FundingTxHash ?? recoverBotVaultV3FundingTxHash;
  const recoveredTxHash = await recoverFundingTxHash({
    client: params.client,
    botVaultAddress: params.botVaultAddress,
    botVaultId: params.botVaultId,
    reason: params.reason,
    actionMetadata: action.metadata,
    principalAllocated: params.principalAllocated
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_tx_recovery_failed", jobIssueMetadata({
      issueClass: "okay_to_swallow",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      actionId: action.id,
      error
    }));
    return null;
  });
  if (!recoveredTxHash) return null;

  await params.onchainActionService.submitActionTxHash({
    userId: String(action.userId),
    actionId: String(action.id),
    txHash: recoveredTxHash
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_action_submit_backfill_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "funding_verification_missing",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      actionId: action.id,
      txHash: recoveredTxHash,
      error
    }));
  });
  await params.onchainActionService.markActionConfirmedByTxHash({
    txHash: recoveredTxHash,
    status: "confirmed"
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_v3_funding_action_confirm_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "funding_verification_missing",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      vaultAddress: params.botVaultAddress,
      actionId: action.id,
      txHash: recoveredTxHash,
      error
    }));
  });
  return recoveredTxHash;
}

async function autoAdvanceBotVaultV3HypercoreFunding(params: {
  mode: string;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
}): Promise<{
  activateTxHash: `0x${string}` | null;
  depositTxHash: `0x${string}` | null;
  depositedAmountAtomic: string;
  hypercoreFunded: boolean;
} | null> {
  const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
    logger.warn("vault_onchain_reconciliation_v3_hypercore_advance_missing_private_key", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "manual_intervention_required",
      recoveryAction: "user_action_required",
      retryable: false,
      botVaultId: params.botVaultId,
      botVaultAddress: params.botVaultAddress
    }));
    return null;
  }
  const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
  const addressBook = resolveOnchainAddressBook({ mode: params.mode as any, contractVersion: "v3" });
  const rpcUrl = resolveHyperEvmWriteRpcUrl(addressBook.rpcUrl);
  const account = privateKeyToAccount(privateKey);
  const chain = defineChain({
    id: addressBook.chainId,
    name: addressBook.chainId === 999 ? "HyperEVM" : `EVM-${addressBook.chainId}`,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
      default: {
        http: [rpcUrl]
      }
    }
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  });
  const readStatus = async () => Number(await publicClient.readContract({
    address: params.botVaultAddress,
    abi: botVaultV3Abi,
    functionName: "status"
  }));
  const readUsdcBalance = async () => BigInt(await publicClient.readContract({
    address: addressBook.usdcAddress,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: [params.botVaultAddress]
  }));

  let activateTxHash: `0x${string}` | null = null;
  let depositTxHash: `0x${string}` | null = null;
  const statusBefore = await readStatus();
  if (statusBefore === 1) {
    try {
      activateTxHash = await sendSerializedControllerTransaction({
        account,
        chain,
        publicClient,
        walletClient
      }, {
        to: params.botVaultAddress,
        data: encodeFunctionData({
          abi: botVaultV3Abi,
          functionName: "activate",
          args: []
        })
      });
      const activateReceipt = await publicClient.waitForTransactionReceipt({
        hash: activateTxHash,
        confirmations: 1
      });
      if (activateReceipt.status !== "success") throw new Error("bot_vault_v3_activate_tx_failed");
    } catch (error) {
      if (!String(error ?? "").toLowerCase().includes("invalid_transition")) throw error;
      activateTxHash = null;
    }
  }

  const balanceBeforeDeposit = await readUsdcBalance();
  if (balanceBeforeDeposit > 0n) {
    depositTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: params.botVaultAddress,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "depositUsdcToHyperCore",
        args: [balanceBeforeDeposit]
      })
    });
    const depositReceipt = await publicClient.waitForTransactionReceipt({
      hash: depositTxHash,
      confirmations: 1
    });
    if (depositReceipt.status !== "success") throw new Error("bot_vault_v3_deposit_hypercore_tx_failed");
  }

  const balanceAfterDeposit = await readUsdcBalance();
  return {
    activateTxHash,
    depositTxHash,
    depositedAmountAtomic: balanceBeforeDeposit.toString(),
    hypercoreFunded: balanceAfterDeposit === 0n
  };
}

function mapBotVaultV3Status(statusIndex: number): "ACTIVE" | "PAUSED" | "CLOSE_ONLY" | "CLOSED" | "ERROR" {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "ACTIVE";
  if (statusIndex === 2) return "ACTIVE";
  if (statusIndex === 3) return "PAUSED";
  if (statusIndex === 4) return "CLOSE_ONLY";
  if (statusIndex === 5) return "CLOSED";
  return "ERROR";
}

async function markGridProvisioningExecutionActive(params: {
  db: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  reason: string;
}) {
  const now = new Date().toISOString();
  const botVault = await params.db.botVault.findUnique({
    where: { id: String(params.botVaultId) },
    select: {
      executionMetadata: true
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_grid_execution_active_bot_vault_read_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId ?? null,
      error
    }));
    return null;
  });
  if (botVault) {
    const botVaultMetadata = toRecord(botVault.executionMetadata);
    const botVaultProvisioning = toRecord(botVaultMetadata.provisioning);
    await params.db.botVault.update({
      where: { id: String(params.botVaultId) },
      data: {
        executionMetadata: {
          ...botVaultMetadata,
          provisioning: {
            ...botVaultProvisioning,
            phase: "execution_active",
            reason: params.reason,
            completedAt: now
          }
        }
      }
    }).catch((error: unknown) => {
      logger.warn("vault_onchain_reconciliation_grid_execution_active_bot_vault_update_failed", jobIssueMetadata({
        issueClass: "recoverable_track",
        mismatchCategory: "funding_verification_missing",
        recoveryAction: "retry",
        reason: params.reason,
        botVaultId: params.botVaultId,
        gridInstanceId: params.gridInstanceId ?? null,
        error
      }));
    });
  }
  if (!params.gridInstanceId) return;
  const instance = await params.db.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: { id: true, botId: true, state: true, stateJson: true }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_grid_execution_active_instance_read_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId ?? null,
      error
    }));
    return null;
  });
  if (!instance) return;
  if (isGridExecutionActive(instance)) return;
  const stateJson = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  const executionProvider = toRecord(stateJson.executionProvider);
  await params.db.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "running",
      stateJson: {
        ...stateJson,
        executionProvider: {
          ...executionProvider,
          lastError: null,
          lastErrorAt: null
        },
        provisioning: {
          phase: "execution_active",
          reason: params.reason,
          completedAt: now
        }
      }
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_grid_execution_active_instance_update_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "funding_verification_missing",
      recoveryAction: "retry",
      reason: params.reason,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId ?? null,
      error
    }));
  });
  if (instance.botId) {
    await params.db.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "running",
        lastError: null
      }
    }).catch((error: unknown) => {
      logger.warn("vault_onchain_reconciliation_grid_execution_active_bot_update_failed", jobIssueMetadata({
        issueClass: "recoverable_track",
        mismatchCategory: "funding_verification_missing",
        recoveryAction: "retry",
        reason: params.reason,
        botVaultId: params.botVaultId,
        gridInstanceId: params.gridInstanceId ?? null,
        botId: String(instance.botId),
        error
      }));
    });
  }
}

async function markGridProvisioningSubmittedHypercoreFunding(params: {
  db: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  txHash?: string | null;
  allocationUsd?: number | null;
  runtimeModel?: unknown;
}) {
  if (!params.gridInstanceId) return;
  const now = new Date().toISOString();
  const pendingReason = botVaultRuntimeReasonCode({
    runtimeModel: resolveBotVaultRuntimeModel(params.runtimeModel) ?? BOT_VAULT_RUNTIME_MODEL_V4,
    suffix: "hypercore_transfer_pending"
  });
  const instance = await params.db.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: { id: true, botId: true, stateJson: true }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_grid_hypercore_pending_instance_read_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      reason: pendingReason,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId ?? null,
      error
    }));
    return null;
  });
  if (!instance) return;
  const stateJson = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  await params.db.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "created",
      stateJson: {
        ...stateJson,
        provisioning: {
          phase: "submitted_waiting_hypercore_funding_indexer",
          reason: pendingReason,
          allocationUsd: params.allocationUsd ?? 0,
          completedAt: now,
          txHash: params.txHash ?? null
        }
      }
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_reconciliation_grid_hypercore_pending_instance_update_failed", jobIssueMetadata({
      issueClass: "recoverable_track",
      mismatchCategory: "funding_verification_missing",
      recoveryAction: "retry",
      reason: pendingReason,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId ?? null,
      error
    }));
  });
  if (instance.botId) {
    await params.db.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "stopped",
        lastError: null
      }
    }).catch((error: unknown) => {
      logger.warn("vault_onchain_reconciliation_grid_hypercore_pending_bot_update_failed", jobIssueMetadata({
          issueClass: "recoverable_track",
          mismatchCategory: "funding_verification_missing",
          recoveryAction: "retry",
          reason: pendingReason,
        botVaultId: params.botVaultId,
        gridInstanceId: params.gridInstanceId ?? null,
        botId: String(instance.botId),
        error
      }));
    });
  }
}

export type VaultOnchainReconciliationStatus = {
  enabled: boolean;
  mode: string;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastDriftCount: number;
  lastStatus: VaultReconciliationStatus;
  totalCycles: number;
  totalDrifts: number;
  totalFailedCycles: number;
};

export function createVaultOnchainReconciliationJob(
  db: any,
  deps?: {
    onchainActionService?: Pick<OnchainActionService, "markActionConfirmedByTxHash" | "submitActionTxHash"> | null;
    executionLifecycleService?: Pick<ExecutionLifecycleService, "startExecution"> | null;
    botVaultRuntimeService?: BotVaultRuntimeReconcileService | null;
    readMasterVaultState?: typeof readMasterVaultState;
    readBotVaultState?: typeof readBotVaultState;
    readBotVaultV3State?: typeof readBotVaultV3State;
    recoverBotVaultV3FundingTxHash?: typeof recoverBotVaultV3FundingTxHash;
    readNativeBalance?: ((client: any, address: `0x${string}`) => Promise<bigint>) | null;
    dispatchAgentLowHypeNotification?: ((payload: {
      userId: string;
      masterVaultId: string;
      masterVaultAddress?: string | null;
      agentWalletAddress: string;
      hypeBalance: string | null;
      lowHypeThreshold: number;
      lowHypeState: "ok" | "low" | "unavailable";
      updatedAt?: string | null;
    }) => Promise<void>) | null;
  }
) {
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const executionLifecycleService = deps?.executionLifecycleService ?? null;
  const botVaultRuntimeService = deps?.botVaultRuntimeService ?? null;
  const readMasterVaultStateFn = deps?.readMasterVaultState ?? readMasterVaultState;
  const readBotVaultStateFn = deps?.readBotVaultState ?? readBotVaultState;
  const readBotVaultV3StateFn = deps?.readBotVaultV3State ?? deps?.readBotVaultState ?? readBotVaultV3State;
  const recoverBotVaultV3FundingTxHashFn = deps?.recoverBotVaultV3FundingTxHash ?? recoverBotVaultV3FundingTxHash;
  const readNativeBalance = deps?.readNativeBalance ?? ((client: any, address: `0x${string}`) => client.getBalance({ address }));
  const dispatchAgentLowHypeNotification = deps?.dispatchAgentLowHypeNotification ?? null;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastMode = "offchain_shadow";
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastDriftCount = 0;
  let totalCycles = 0;
  let totalDrifts = 0;
  let totalFailedCycles = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (running) return { enabled: false, mode: lastMode, drifts: 0 };
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const mode = await getEffectiveVaultExecutionMode(db);
      lastMode = mode;
      if (!isOnchainMode(mode)) {
        lastDriftCount = 0;
        lastError = null;
        lastErrorAt = null;
        return { enabled: false, mode, drifts: 0 };
      }

      const addressBook = resolveOnchainAddressBook(mode);
      const client = createOnchainPublicClient(addressBook);

      const masters = await db.masterVault.findMany({
        where: { onchainAddress: { not: null } },
        select: {
          id: true,
          userId: true,
          onchainAddress: true,
          freeBalance: true,
          reservedBalance: true,
          agentWallet: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        },
        take: MASTER_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      const bots = await db.botVault.findMany({
        where: { vaultAddress: { not: null } },
	        select: {
	          id: true,
	          botId: true,
	          userId: true,
	          vaultModel: true,
          vaultAddress: true,
          gridInstanceId: true,
          executionMetadata: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          feePaidTotal: true,
          highWaterMark: true,
          status: true,
          executionStatus: true,
          fundingStatus: true,
          hypercoreFundingStatus: true
        },
        take: BOT_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      let driftCount = 0;
      let criticalPersistenceFailures = 0;

      for (const row of masters) {
        const address = String(row.onchainAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const onchain = await readMasterVaultStateFn(client, address).catch((error: unknown) => {
          logger.warn("vault_onchain_reconciliation_master_state_read_failed", jobIssueMetadata({
            issueClass: "recoverable_track",
            mismatchCategory: "observed_state_incomplete",
            recoveryAction: "retry",
            reason,
            masterVaultId: row.id,
            onchainAddress: address,
            error
          }));
          return null;
        });
        if (!onchain) continue;
        const agentWallet = normalizeAddress(row.agentWallet);
        const lowHypeThreshold = readPositiveNumber(row.agentHypeWarnThreshold, 0.05);
        let agentBalanceWei = typeof row.agentLastBalanceWei === "string" && row.agentLastBalanceWei.trim()
          ? row.agentLastBalanceWei.trim()
          : null;
        let agentBalanceFormatted = typeof row.agentLastBalanceFormatted === "string" && row.agentLastBalanceFormatted.trim()
          ? row.agentLastBalanceFormatted.trim()
          : null;
        let agentLastBalanceAt = row.agentLastBalanceAt instanceof Date ? row.agentLastBalanceAt : null;
        let agentBalanceStale = true;
        if (agentWallet) {
          try {
            const balanceWei = await readNativeBalance(client, agentWallet);
            agentBalanceWei = balanceWei.toString();
            agentBalanceFormatted = formatUnits(balanceWei, 18);
            agentLastBalanceAt = new Date();
            agentBalanceStale = false;
            await db.masterVault.update({
              where: { id: row.id },
              data: {
                agentLastBalanceAt,
                agentLastBalanceWei: agentBalanceWei,
                agentLastBalanceFormatted: agentBalanceFormatted
              }
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_agent_balance_persist_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                masterVaultId: row.id,
                agentWallet,
                error
              }));
            });
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_agent_balance_read_failed", jobIssueMetadata({
              issueClass: "recoverable_track",
              mismatchCategory: "observed_state_incomplete",
              recoveryAction: "retry",
              reason,
              masterVaultId: row.id,
              agentWallet,
              error
            }));
            agentBalanceStale = true;
          }
        }
        const lowHypeState = deriveLowHypeState(agentBalanceWei, lowHypeThreshold, agentBalanceStale);
        const notificationStateKey = `${LOW_HYPE_STATE_KEY_PREFIX}${row.id}`;
        if (dispatchAgentLowHypeNotification && agentWallet && lowHypeState === "low") {
          const existingState = typeof db.globalSetting?.findUnique === "function"
            ? await db.globalSetting.findUnique({
                where: { key: notificationStateKey },
                select: { value: true }
              }).catch((error: unknown) => {
                logger.warn("vault_onchain_reconciliation_agent_low_hype_state_read_failed", jobIssueMetadata({
                  issueClass: "recoverable_track",
                  mismatchCategory: "observed_state_incomplete",
                  recoveryAction: "retry",
                  reason,
                  masterVaultId: row.id,
                  agentWallet,
                  settingKey: notificationStateKey,
                  error
                }));
                return null;
              })
            : null;
          const previousState = typeof existingState?.value?.state === "string" ? String(existingState.value.state) : null;
          if (previousState !== "low") {
            await dispatchAgentLowHypeNotification({
              userId: String(row.userId),
              masterVaultId: String(row.id),
              masterVaultAddress: String(row.onchainAddress ?? "").trim() || null,
              agentWalletAddress: agentWallet,
              hypeBalance: agentBalanceFormatted,
              lowHypeThreshold,
              lowHypeState,
              updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_agent_low_hype_notify_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                masterVaultId: row.id,
                agentWallet,
                error
              }));
            });
          }
        }
        if (typeof db.globalSetting?.upsert === "function" && agentWallet) {
          await db.globalSetting.upsert({
            where: { key: notificationStateKey },
            update: {
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            },
            create: {
              key: notificationStateKey,
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            }
          }).catch((error: unknown) => {
            logger.warn("vault_onchain_reconciliation_agent_low_hype_state_persist_failed", jobIssueMetadata({
              issueClass: "recoverable_track",
              mismatchCategory: "observed_state_incomplete",
              recoveryAction: "retry",
              reason,
              masterVaultId: row.id,
              agentWallet,
              settingKey: notificationStateKey,
              error
            }));
          });
        }
        const compensationEvents = typeof db.cashEvent?.findMany === "function"
          ? await db.cashEvent.findMany({
              where: {
                masterVaultId: row.id,
                eventType: "ADJUSTMENT"
              },
              select: {
                amount: true,
                metadata: true
              }
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_master_compensation_read_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                masterVaultId: row.id,
                onchainAddress: address,
                error
              }));
              return null;
            })
          : [];
        if (!Array.isArray(compensationEvents)) continue;
        const offchainCompensationUsd = compensationEvents.reduce(
          (sum, event) => sum + readClosedRecoveryCompensationUsd(event),
          0
        );
        const expectedFreeBalance = onchain.freeBalance + offchainCompensationUsd;

        const freeDiff = Math.abs(Number(row.freeBalance ?? 0) - expectedFreeBalance);
        const reservedDiff = Math.abs(Number(row.reservedBalance ?? 0) - onchain.reservedBalance);
        if (freeDiff <= EPSILON && reservedDiff <= EPSILON) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", jobIssueMetadata({
          issueClass: "recoverable_track",
          mismatchCategory: "local_ahead_of_observed_state",
          recoveryAction: "retry",
          reason,
          entityType: "master_vault",
          masterVaultId: row.id,
          onchainAddress: address,
          dbFreeBalance: Number(row.freeBalance ?? 0),
          dbReservedBalance: Number(row.reservedBalance ?? 0),
          chainFreeBalance: onchain.freeBalance,
          chainReservedBalance: onchain.reservedBalance,
          offchainCompensationUsd,
          expectedFreeBalance
        }));

        await db.masterVault.update({
          where: { id: row.id },
          data: {
            freeBalance: expectedFreeBalance,
            reservedBalance: onchain.reservedBalance,
            availableUsd: expectedFreeBalance
          }
        }).catch((error: unknown) => {
          criticalPersistenceFailures += 1;
          logger.warn("vault_onchain_reconciliation_master_repair_failed", jobIssueMetadata({
            issueClass: "must_fail",
            mismatchCategory: "local_ahead_of_observed_state",
            recoveryAction: "retry",
            reason,
            masterVaultId: row.id,
            onchainAddress: address,
            error
          }));
        });
      }

      for (const row of bots) {
        const address = String(row.vaultAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const isV3 = isBotVaultRuntimeModelRow(row);
        const runtimeModel = resolveBotVaultRuntimeModel(row) ?? BOT_VAULT_RUNTIME_MODEL_V4;
        const onchain = isV3
          ? await readBotVaultV3StateFn(client, address).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_bot_state_read_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                vaultModel: row.vaultModel ?? null,
                error
              }));
              return null;
            })
          : await readBotVaultStateFn(client, address).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_bot_state_read_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                vaultModel: row.vaultModel ?? null,
                error
              }));
              return null;
            });
        if (!onchain) continue;

        if (onchainActionService && typeof db.onchainAction?.findFirst === "function") {
          const submittedCreateAction = await db.onchainAction.findFirst({
            where: {
              botVaultId: row.id,
              status: "submitted",
              actionType: {
                in: ["create_bot_vault", ...BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES]
              },
              txHash: {
                not: null
              }
            },
            orderBy: [{ updatedAt: "desc" }],
            select: {
              id: true,
              txHash: true,
              actionType: true
            }
          }).catch((error: unknown) => {
            logger.warn("vault_onchain_reconciliation_create_action_read_failed", jobIssueMetadata({
              issueClass: "recoverable_track",
              mismatchCategory: "observed_state_incomplete",
              recoveryAction: "retry",
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              error
            }));
            return null;
          });

          if (submittedCreateAction?.txHash) {
            await onchainActionService.markActionConfirmedByTxHash({
              txHash: String(submittedCreateAction.txHash)
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_confirm_action_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "funding_verification_missing",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                actionId: submittedCreateAction.id,
                actionType: submittedCreateAction.actionType,
                txHash: submittedCreateAction.txHash,
                error
              }));
            });
          }
        }

        const normalizedDbStatus = normalizeBotVaultStatus(row.status);
        const dbStatus = normalizedDbStatus === "STOPPED" ? "PAUSED" : normalizedDbStatus;
        const chainStatus = isV3
          ? mapBotVaultV3Status(onchain.status)
          : onchain.status === 0
            ? "ACTIVE"
            : onchain.status === 1
              ? "PAUSED"
              : onchain.status === 2
                ? "CLOSE_ONLY"
                : onchain.status === 3
                ? "CLOSED"
                  : "ERROR";
        const v3UsdcBalanceRaw = isV3
          ? await client.readContract({
              address: addressBook.usdcAddress,
              abi: erc20BalanceOfAbi,
              functionName: "balanceOf",
              args: [address]
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_v3_usdc_balance_read_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "observed_state_incomplete",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                tokenAddress: addressBook.usdcAddress,
                error
              }));
              return null;
            })
          : null;
        const v3UsdcBalanceUsd = typeof v3UsdcBalanceRaw === "bigint"
          ? Number(formatUnits(v3UsdcBalanceRaw, 6))
          : null;
        const v3Lifecycle = isV3
          ? deriveV3ReconciledLifecycleState({
              chainStatus,
              principalReturned: onchain.principalReturned,
              usdcBalanceUsd: v3UsdcBalanceUsd,
              row
            })
          : null;
        if (isV3 && typeof db.botVault?.update === "function") {
          const fundingIntentTimeout = readBotVaultV3FundingIntentTimeout({
            row,
            chainStatus,
            principalAllocated: onchain.principalAllocated
          });
          if (fundingIntentTimeout) {
            logger.warn("vault_onchain_reconciliation_v3_funding_timeout", jobIssueMetadata({
              issueClass: "must_fail",
              mismatchCategory: "funding_verification_missing",
              recoveryAction: "retry",
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              actionKey: fundingIntentTimeout.actionKey,
              actionStatus: fundingIntentTimeout.actionStatus,
              pendingMinutes: fundingIntentTimeout.pendingMinutes,
              timeoutAt: fundingIntentTimeout.timeoutAt
            }));
            const existingMetadata = toRecord(row.executionMetadata);
            const fundingIntent = toRecord(existingMetadata.fundingIntent);
            const lifecyclePatch = buildBotVaultFundingLifecycleTransitionPatch({
              row,
              targetStage: "recovery_required",
              source: "vault_onchain_reconciliation",
              reason: fundingIntentTimeout.reason,
              detail: fundingIntentTimeout.detail,
              occurredAt: fundingIntentTimeout.timedOutAt,
              metadataPatch: {
                fundingIntent: {
                  ...fundingIntent,
                  actionStatus: "timed_out",
                  verificationState: "timed_out",
                  timedOutAt: fundingIntentTimeout.timedOutAt,
                  timeoutAt: fundingIntentTimeout.timeoutAt,
                  timeoutReason: fundingIntentTimeout.reason,
                  lastError: `${fundingIntentTimeout.reason}:${fundingIntentTimeout.pendingMinutes}m`
                }
              }
            });
            await db.botVault.update({
              where: { id: row.id },
              data: lifecyclePatch
            }).catch((error: unknown) => {
              criticalPersistenceFailures += 1;
              logger.warn("vault_onchain_reconciliation_v3_funding_timeout_persist_failed", jobIssueMetadata({
                issueClass: "must_fail",
                mismatchCategory: "funding_verification_missing",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                actionKey: fundingIntentTimeout.actionKey,
                actionStatus: fundingIntentTimeout.actionStatus,
                timeoutReason: fundingIntentTimeout.reason,
                error
              }));
            });
            if (typeof db.onchainAction?.updateMany === "function") {
              await db.onchainAction.updateMany({
                where: {
                  botVaultId: row.id,
                  actionType: {
                    in: [...BOT_VAULT_RUNTIME_FUND_ACTION_TYPES]
                  },
                  status: {
                    in: ["prepared", "submitted"]
                  },
                  ...(fundingIntentTimeout.actionKey ? { actionKey: fundingIntentTimeout.actionKey } : {})
                },
                data: {
                  status: "failed"
                }
              }).catch((error: unknown) => {
                logger.warn("vault_onchain_reconciliation_v3_funding_timeout_action_mark_failed", jobIssueMetadata({
                  issueClass: "recoverable_track",
                  mismatchCategory: "funding_verification_missing",
                  recoveryAction: "retry",
                  reason,
                  botVaultId: row.id,
                  vaultAddress: address,
                  actionKey: fundingIntentTimeout.actionKey,
                  actionStatus: fundingIntentTimeout.actionStatus,
                  error
                }));
              });
            }
          }
        }

        const v3FundingConfirmed = isV3 && (onchain.status >= 1 || onchain.principalAllocated > EPSILON);
        if (v3FundingConfirmed) {
          const currentV3Stage = getBotVaultFundingLifecycleStage(row);
          const nextObservedV3Stage = v3Lifecycle?.targetStage ?? "hyper_evm_confirmed";
          const reconciledV3Stage = currentV3Stage === "failed" || currentV3Stage === "recovery_required"
            ? nextObservedV3Stage
            : compareBotVaultFundingLifecycleStage(currentV3Stage, nextObservedV3Stage) >= 0
              ? currentV3Stage
              : nextObservedV3Stage;
          const needsHypercoreAdvance =
            reconciledV3Stage !== "hypercore_funded"
            && reconciledV3Stage !== "perp_margin_transferred"
            && reconciledV3Stage !== "execution_ready"
            && reconciledV3Stage !== "settled";
          await reconcileBotVaultV3FundingAction({
            db,
            onchainActionService,
              client,
              botVaultId: String(row.id),
              botVaultAddress: address,
              runtimeModel,
              principalAllocated: onchain.principalAllocated,
            recoverBotVaultV3FundingTxHash: recoverBotVaultV3FundingTxHashFn,
            reason
          }).catch((error: unknown) => {
            logger.warn("vault_onchain_reconciliation_v3_funding_action_reconcile_failed", jobIssueMetadata({
              issueClass: "recoverable_track",
              mismatchCategory: "funding_verification_missing",
              recoveryAction: "retry",
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              error
            }));
          });
          if (typeof db.botVault?.update === "function") {
            const lifecyclePatch = buildBotVaultFundingLifecycleTransitionPatch({
              row,
              targetStage: reconciledV3Stage,
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            });
            const preservedHypercoreFundingStatus =
              String(row.hypercoreFundingStatus ?? "").trim().toLowerCase() === "funded"
              && String(lifecyclePatch.hypercoreFundingStatus ?? "").trim().toLowerCase() === "pending"
                ? "funded"
                : lifecyclePatch.hypercoreFundingStatus;
            await db.botVault.update({
              where: { id: row.id },
              data: {
                principalAllocated: onchain.principalAllocated,
                allocatedUsd: onchain.principalAllocated,
                principalReturned: onchain.principalReturned,
                realizedPnlNet: onchain.realizedPnlNet,
                realizedNetUsd: onchain.realizedPnlNet,
                feePaidTotal: onchain.feePaidTotal,
                highWaterMark: onchain.highWaterMark,
                ...lifecyclePatch,
                hypercoreFundingStatus: preservedHypercoreFundingStatus,
                status: chainStatus,
                ...(v3Lifecycle?.economicallyClosed
                  ? {
                      endedAt: new Date(),
                      closedAt: new Date()
                    }
                  : {})
              }
            }).catch((error: unknown) => {
              criticalPersistenceFailures += 1;
              logger.warn("vault_onchain_reconciliation_v3_funding_state_persist_failed", jobIssueMetadata({
                issueClass: "must_fail",
                mismatchCategory: "funding_verification_missing",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                chainStatus,
                targetStage: reconciledV3Stage,
                error
              }));
            });
          }

          if (needsHypercoreAdvance) {
            await markGridProvisioningSubmittedHypercoreFunding({
              db,
              botVaultId: String(row.id),
              gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
              txHash: String(toRecord(row.executionMetadata).autoHypercoreFundingTxHash ?? toRecord(row.executionMetadata).autoActivateTxHash ?? ""),
              allocationUsd: onchain.principalAllocated,
              runtimeModel
            });
          }

          if (typeof db.onchainAction?.updateMany === "function") {
            await db.onchainAction.updateMany({
              where: {
                botVaultId: row.id,
                actionType: {
                  in: [...BOT_VAULT_RUNTIME_FUND_ACTION_TYPES]
                },
                txHash: null,
                status: {
                  in: ["prepared", "submitted"]
                }
              },
              data: {
                status: "failed"
              }
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_v3_unresolved_funding_actions_mark_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "funding_verification_missing",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                error
              }));
            });
          }

          if (needsHypercoreAdvance && shouldQueueBotVaultV3AutoActivate(row.executionMetadata)) {
            const advancement = await autoAdvanceBotVaultV3HypercoreFunding({
              mode,
              botVaultId: String(row.id),
              botVaultAddress: address
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_v3_hypercore_advance_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "funding_verification_missing",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                error
              }));
              return null;
            });
            if (typeof db.botVault?.update === "function") {
              const postFundingRow = {
                ...row,
                  fundingStatus: "hyper_evm_confirmed_onchain",
                hypercoreFundingStatus: row.hypercoreFundingStatus,
                executionStatus: normalizeExecutionStatus(row.executionStatus) || "created",
                status: chainStatus,
                executionMetadata: buildBotVaultFundingLifecycleTransitionPatch({
                  row,
                  targetStage: reconciledV3Stage,
                  source: "vault_onchain_reconciliation",
                  reason: "onchain_funding_confirmed",
                  detail: chainStatus
                }).executionMetadata
              };
              const lifecyclePatch = buildBotVaultFundingLifecycleTransitionPatch({
                row: postFundingRow,
                targetStage: advancement?.hypercoreFunded ? "hypercore_funded" : "hyper_evm_confirmed",
                source: "vault_onchain_reconciliation",
                reason: advancement?.hypercoreFunded ? "hypercore_deposit_confirmed" : "hypercore_deposit_pending",
                detail: String(advancement?.depositTxHash ?? advancement?.activateTxHash ?? "")
              });
              await db.botVault.update({
                where: { id: row.id },
                data: {
                  ...lifecyclePatch,
                  executionMetadata: {
                    ...toRecord(row.executionMetadata),
                    fundingLifecycle: toRecord(lifecyclePatch.executionMetadata).fundingLifecycle,
                    autoActivateStatus: advancement?.activateTxHash ? "confirmed" : "skipped",
                    autoActivateSubmittedAt: advancement?.activateTxHash ? new Date().toISOString() : null,
                    autoActivateTxHash: advancement?.activateTxHash ?? null,
                    autoHypercoreFundingStatus: advancement?.hypercoreFunded ? "confirmed" : "pending",
                    autoHypercoreFundingSubmittedAt: advancement?.depositTxHash ? new Date().toISOString() : null,
                    autoHypercoreFundingTxHash: advancement?.depositTxHash ?? null,
                    autoHypercoreFundingAmountAtomic: advancement?.depositedAmountAtomic ?? "0",
                    lastAction: advancement?.depositTxHash
                      ? `onchain_${runtimeModel}_deposit_hypercore_confirmed`
                      : advancement?.activateTxHash
                        ? `onchain_${runtimeModel}_activate_confirmed`
                        : `onchain_${runtimeModel}_hypercore_advance_skipped`
                  }
                }
              }).catch((error: unknown) => {
                criticalPersistenceFailures += 1;
                logger.warn("vault_onchain_reconciliation_v3_hypercore_advance_persist_failed", jobIssueMetadata({
                  issueClass: "must_fail",
                  mismatchCategory: "funding_verification_missing",
                  recoveryAction: "retry",
                  reason,
                  botVaultId: row.id,
                  vaultAddress: address,
                  activateTxHash: advancement?.activateTxHash ?? null,
                  depositTxHash: advancement?.depositTxHash ?? null,
                  hypercoreFunded: advancement?.hypercoreFunded ?? false,
                  error
                }));
              });
            }
          }
        }

	        const pendingMoneyFlow = isV3 ? readPendingMoneyFlowState(row) : null;
	        if (pendingMoneyFlow) {
	          await upsertMoneyFlowPlatformAlert({
	            db,
	            row,
	            pending: pendingMoneyFlow,
	            now: lastStartedAt ?? new Date()
	          });
	        } else if (isV3) {
	          await resolveMoneyFlowPlatformAlerts({ db, row });
	        }

	        if (isV3 && botVaultRuntimeService && hasPendingBotVaultRuntimeReconciliation(row)) {
          const reconcileById =
            botVaultRuntimeService.reconcileBotVaultById
            ?? botVaultRuntimeService.reconcileBotVaultV4ById
            ?? botVaultRuntimeService.reconcileBotVaultV3ById;
          if (typeof reconcileById === "function") {
            await reconcileById.call(botVaultRuntimeService, {
              userId: String(row.userId),
              botVaultId: String(row.id),
              persist: true,
              throwOnPersistFailure: false
            }).catch((error: unknown) => {
              logger.warn("vault_onchain_reconciliation_runtime_pending_reconcile_failed", jobIssueMetadata({
                issueClass: "recoverable_track",
                mismatchCategory: "post_transfer_reconcile_failed",
                recoveryAction: "retry",
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                error
              }));
            });
          }
        }

        const effectiveDbStatus = v3FundingConfirmed ? chainStatus : dbStatus;
        const effectiveV3Stage = v3FundingConfirmed
          ? (() => {
              const currentStage = getBotVaultFundingLifecycleStage(row);
              const nextObservedStage = v3Lifecycle?.targetStage ?? "hyper_evm_confirmed";
              if (currentStage === "failed" || currentStage === "recovery_required") return nextObservedStage;
              return compareBotVaultFundingLifecycleStage(currentStage, nextObservedStage) >= 0
                ? currentStage
                : nextObservedStage;
            })()
          : null;
        const effectiveFundingStatus = v3FundingConfirmed
          ? String(buildBotVaultFundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).fundingStatus ?? row.fundingStatus ?? "")
          : String(row.fundingStatus ?? "");
        const effectiveHypercoreFundingStatus = v3FundingConfirmed
          ? String(buildBotVaultFundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).hypercoreFundingStatus ?? row.hypercoreFundingStatus ?? "")
          : String(row.hypercoreFundingStatus ?? "");
        const effectiveExecutionStatus = v3FundingConfirmed
          ? normalizeExecutionStatus(buildBotVaultFundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).executionStatus ?? row.executionStatus)
          : normalizeExecutionStatus(row.executionStatus);
        const shouldAutoStart = executionLifecycleService
          && effectiveDbStatus === "ACTIVE"
          && chainStatus === "ACTIVE"
          && hasFundingReadyForExecution({
            vaultModel: row.vaultModel,
            fundingStatus: effectiveFundingStatus,
            hypercoreFundingStatus: effectiveHypercoreFundingStatus
          })
          && ["", "created", "funded"].includes(effectiveExecutionStatus);
        if (shouldAutoStart) {
          try {
            await executionLifecycleService.startExecution({
              userId: String(row.userId),
              botVaultId: String(row.id),
              sourceKey: `bot_vault:${row.id}:onchain_reconciliation_autostart`,
              reason: "bot_vault_onchain_reconciliation_autostart",
              metadata: {
                sourceType: "onchain_reconciliation_autostart"
              }
            });
            if (typeof db.gridBotInstance?.findUnique === "function" && typeof db.gridBotInstance?.update === "function") {
              await markGridProvisioningExecutionActive({
                db,
                botVaultId: String(row.id),
                gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
                reason: v3FundingConfirmed
                  ? `${runtimeModel}_funding_reconciled_onchain`
                  : "bot_vault_onchain_reconciliation_autostart"
              });
            }
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_autostart_failed", jobIssueMetadata({
              issueClass: "recoverable_track",
              mismatchCategory: "funding_verification_missing",
              recoveryAction: "retry",
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              error
            }));
          }
        }

        const diffs = {
          principalAllocated: Math.abs(Number(row.principalAllocated ?? 0) - onchain.principalAllocated),
          principalReturned: Math.abs(Number(row.principalReturned ?? 0) - onchain.principalReturned),
          realizedPnlNet: Math.abs(Number(row.realizedPnlNet ?? 0) - onchain.realizedPnlNet),
          feePaidTotal: Math.abs(Number(row.feePaidTotal ?? 0) - onchain.feePaidTotal),
          highWaterMark: Math.abs(Number(row.highWaterMark ?? 0) - onchain.highWaterMark)
        };

        const hasNumericDrift = Object.values(diffs).some((value) => value > EPSILON);
        const hasStatusDrift = dbStatus !== chainStatus;
        if (!hasNumericDrift && !hasStatusDrift) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", jobIssueMetadata({
          issueClass: "recoverable_track",
          mismatchCategory: "local_ahead_of_observed_state",
          recoveryAction: "retry",
          reason,
          entityType: "bot_vault",
          botVaultId: row.id,
          vaultAddress: address,
          dbStatus,
          chainStatus,
          dbPrincipalAllocated: Number(row.principalAllocated ?? 0),
          chainPrincipalAllocated: onchain.principalAllocated,
          dbPrincipalReturned: Number(row.principalReturned ?? 0),
          chainPrincipalReturned: onchain.principalReturned,
          dbRealizedPnlNet: Number(row.realizedPnlNet ?? 0),
          chainRealizedPnlNet: onchain.realizedPnlNet,
          dbFeePaidTotal: Number(row.feePaidTotal ?? 0),
          chainFeePaidTotal: onchain.feePaidTotal,
          dbHighWaterMark: Number(row.highWaterMark ?? 0),
          chainHighWaterMark: onchain.highWaterMark
        }));

        await db.botVault.update({
          where: { id: row.id },
          data: {
            principalAllocated: onchain.principalAllocated,
            principalReturned: onchain.principalReturned,
            realizedPnlNet: onchain.realizedPnlNet,
            realizedNetUsd: onchain.realizedPnlNet,
            feePaidTotal: onchain.feePaidTotal,
            highWaterMark: onchain.highWaterMark,
            status: chainStatus
          }
        }).catch((error: unknown) => {
          criticalPersistenceFailures += 1;
          logger.warn("vault_onchain_reconciliation_bot_repair_failed", jobIssueMetadata({
            issueClass: "must_fail",
            mismatchCategory: "local_ahead_of_observed_state",
            recoveryAction: "retry",
            reason,
            botVaultId: row.id,
            vaultAddress: address,
            error
          }));
        });
      }

      lastDriftCount = driftCount;
      totalDrifts += driftCount;
      if (criticalPersistenceFailures > 0) {
        lastError = `vault_onchain_reconciliation_critical_persistence_failures:${criticalPersistenceFailures}`;
        lastErrorAt = new Date();
        totalFailedCycles += 1;
        await upsertReconcileJobPlatformAlert({
          db,
          severity: "critical",
          title: "BotVault reconciliation job degraded",
          message: "Vault onchain reconciliation completed with critical persistence failures.",
          metadata: {
            reason,
            mode,
            drifts: driftCount,
            criticalPersistenceFailures,
            lastError
          }
        });
        logger.warn("vault_onchain_reconciliation_cycle_degraded", jobIssueMetadata({
          issueClass: "must_fail",
          mismatchCategory: "local_ahead_of_observed_state",
          recoveryAction: "retry",
          reason,
          mode,
          drifts: driftCount,
          criticalPersistenceFailures
        }));
      } else {
        lastError = null;
        lastErrorAt = null;
        await resolveReconcileJobPlatformAlert(db);
      }

      if (driftCount > 0) {
        logger.info("vault_onchain_reconciliation_cycle", {
          reason,
          mode,
          drifts: driftCount
        });
      }

      return { enabled: true, mode, drifts: driftCount };
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      await upsertReconcileJobPlatformAlert({
        db,
        severity: "critical",
        title: "BotVault reconciliation job blocked",
        message: "Vault onchain reconciliation cycle failed before completion.",
        metadata: {
          reason,
          mode: lastMode,
          error: lastError
        }
      });
      logger.warn("vault_onchain_reconciliation_cycle_failed", jobIssueMetadata({
        issueClass: "must_fail",
        mismatchCategory: "observed_state_incomplete",
        recoveryAction: "retry",
        reason,
        error: lastError
      }));
      return { enabled: false, mode: lastMode, drifts: 0 };
    } finally {
      running = false;
      lastFinishedAt = new Date();
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): VaultOnchainReconciliationStatus {
    return {
      enabled: isOnchainMode((lastMode as any) ?? "offchain_shadow"),
      mode: lastMode,
      running,
      pollMs: POLL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastDriftCount,
      lastStatus: lastError ? "blocked" : lastDriftCount > 0 ? "drift_detected" : "clean",
      totalCycles,
      totalDrifts,
      totalFailedCycles
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}

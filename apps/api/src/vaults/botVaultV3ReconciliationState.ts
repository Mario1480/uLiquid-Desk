import {
  classifyBotVaultV4Status,
  deriveBotVaultV4RecoveryHint,
  normalizeBotVaultV4MismatchCategory,
  normalizeBotVaultV4MismatchRecoveryAction,
  normalizeBotVaultV4RecoveryHint,
  normalizeBotVaultV4StatusCategory,
  type BotVaultV4MismatchCategory,
  type BotVaultV4MismatchClassification,
  type BotVaultV4MismatchRecoveryAction,
  type BotVaultV4RecoveryHint,
  type BotVaultV4StatusCategory
} from "./botVaultV3.lifecycle.js";

export type BotVaultV3OnchainSnapshot = {
  status: string;
  principalAllocated: number;
  principalReturned: number;
  availableUsd: number;
  feePaidTotal: number;
};

export type BotVaultV3ReconciliationIssue = {
  code: string;
  severity: "warning" | "blocking";
  statusCategory: BotVaultV4StatusCategory;
  mismatchCategory: BotVaultV4MismatchCategory | null;
  recoveryAction: BotVaultV4MismatchRecoveryAction | null;
  recoveryHint: BotVaultV4RecoveryHint | null;
  field: string | null;
  sourceOfTruth: "onchain" | "execution" | "local_settlement" | "derived";
  detail: string;
  autoRecoverable: boolean;
  autoRecovered: boolean;
  dbValue: number | string | null;
  observedValue: number | string | null;
  expectedValue: number | string | null;
};

export type BotVaultV3ExecutionStateSnapshot = {
  state: "ok" | "unavailable" | "skipped";
  coreSpotUsd: number | null;
  perpAvailableMarginUsd: number | null;
  perpEquityUsd: number | null;
  totalVisibleUsd: number | null;
  detail: string | null;
};

export type BotVaultV3Reconciliation = {
  status: "ok" | "warning" | "blocking";
  statusCategory: BotVaultV4StatusCategory;
  checkedAt: string | null;
  detail: string | null;
  autoApplied: boolean;
  issues: BotVaultV3ReconciliationIssue[];
  sourceOfTruth: {
    principalAllocated: "onchain";
    principalReturned: "onchain";
    availableUsd: "onchain";
    claimedProfitUsd: "local_settlement";
    feePaidTotal: "onchain";
    fundingLifecycle: "derived";
    hypercoreFundingLifecycle: "derived";
    executionBalances: "execution";
  };
  onchainSnapshot: BotVaultV3OnchainSnapshot | null;
  executionSnapshot: BotVaultV3ExecutionStateSnapshot;
};

function roundUsd(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStoredBotVaultV3ExecutionSnapshot(value: unknown): BotVaultV3ExecutionStateSnapshot {
  const raw = toRecord(value);
  const stateRaw = String(raw.state ?? "").trim().toLowerCase();
  const state = stateRaw === "ok" || stateRaw === "unavailable" || stateRaw === "skipped"
    ? stateRaw as BotVaultV3ExecutionStateSnapshot["state"]
    : "skipped";
  const coreSpotUsd = raw.coreSpotUsd == null ? null : roundUsd(toNonNegativeNumber(raw.coreSpotUsd), 6);
  const perpAvailableMarginUsd = raw.perpAvailableMarginUsd == null ? null : roundUsd(toNonNegativeNumber(raw.perpAvailableMarginUsd), 6);
  const perpEquityUsd = raw.perpEquityUsd == null ? null : roundUsd(toNonNegativeNumber(raw.perpEquityUsd), 6);
  const totalVisibleUsd = raw.totalVisibleUsd == null
    ? roundUsd((coreSpotUsd ?? 0) + (perpEquityUsd ?? 0), 6)
    : roundUsd(toNonNegativeNumber(raw.totalVisibleUsd), 6);
  return {
    state,
    coreSpotUsd,
    perpAvailableMarginUsd,
    perpEquityUsd,
    totalVisibleUsd,
    detail: toNullableString(raw.detail)
  };
}

function normalizeStoredBotVaultV3ReconciliationIssue(value: unknown): BotVaultV3ReconciliationIssue | null {
  const raw = toRecord(value);
  const code = String(raw.code ?? "").trim();
  if (!code) return null;
  const severityRaw = String(raw.severity ?? "").trim().toLowerCase();
  const severity = severityRaw === "blocking" ? "blocking" : "warning";
  const mismatchCategory = normalizeBotVaultV4MismatchCategory(raw.mismatchCategory);
  const recoveryAction = normalizeBotVaultV4MismatchRecoveryAction(raw.recoveryAction);
  const recoveryHint = normalizeBotVaultV4RecoveryHint(raw.recoveryHint)
    ?? deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
  const detail = String(raw.detail ?? code);
  const statusCategory = normalizeBotVaultV4StatusCategory(raw.statusCategory)
    ?? classifyBotVaultV4Status({
      reason: code,
      detail,
      mismatchCategory,
      recoveryAction,
      issueSeverity: severity
    }).category;
  const sourceRaw = String(raw.sourceOfTruth ?? "").trim().toLowerCase();
  const sourceOfTruth = sourceRaw === "onchain"
    || sourceRaw === "execution"
    || sourceRaw === "local_settlement"
    || sourceRaw === "derived"
    ? sourceRaw as BotVaultV3ReconciliationIssue["sourceOfTruth"]
    : "derived";
  return {
    code,
    severity,
    statusCategory,
    mismatchCategory,
    recoveryAction,
    recoveryHint,
    field: toNullableString(raw.field),
    sourceOfTruth,
    detail,
    autoRecoverable: raw.autoRecoverable === true,
    autoRecovered: raw.autoRecovered === true,
    dbValue: typeof raw.dbValue === "number" || typeof raw.dbValue === "string" ? raw.dbValue : null,
    observedValue: typeof raw.observedValue === "number" || typeof raw.observedValue === "string" ? raw.observedValue : null,
    expectedValue: typeof raw.expectedValue === "number" || typeof raw.expectedValue === "string" ? raw.expectedValue : null
  };
}

export function readBotVaultV3Reconciliation(executionMetadata: unknown): BotVaultV3Reconciliation | null {
  const metadata = toRecord(executionMetadata);
  const raw = toRecord(metadata.botVaultRuntimeReconciliation).status
    ? toRecord(metadata.botVaultRuntimeReconciliation)
    : toRecord(metadata.botVaultV4Reconciliation).status
      ? toRecord(metadata.botVaultV4Reconciliation)
      : toRecord(metadata.botVaultV3Reconciliation);
  if (Object.keys(raw).length === 0) return null;
  const statusRaw = String(raw.status ?? "").trim().toLowerCase();
  const status = statusRaw === "blocking" || statusRaw === "warning" || statusRaw === "ok"
    ? statusRaw as BotVaultV3Reconciliation["status"]
    : "warning";
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map(normalizeStoredBotVaultV3ReconciliationIssue).filter((item): item is BotVaultV3ReconciliationIssue => Boolean(item))
    : [];
  const onchain = toRecord(raw.onchainSnapshot);
  const onchainSnapshot = Object.keys(onchain).length === 0
    ? null
    : {
        status: String(onchain.status ?? "UNKNOWN"),
        principalAllocated: roundUsd(toNonNegativeNumber(onchain.principalAllocated), 6),
        principalReturned: roundUsd(toNonNegativeNumber(onchain.principalReturned), 6),
        availableUsd: roundUsd(toNonNegativeNumber(onchain.availableUsd), 6),
        feePaidTotal: roundUsd(toNonNegativeNumber(onchain.feePaidTotal), 6)
      };
  const primaryIssue = issues.find((issue) => issue.severity === "blocking") ?? issues[0] ?? null;
  const statusCategory = normalizeBotVaultV4StatusCategory(raw.statusCategory)
    ?? classifyBotVaultV4Status({
      reconciliationStatus: status,
      issueSeverity: primaryIssue?.severity ?? null,
      reason: primaryIssue?.code ?? raw.detail ?? `bot_vault_v3_reconciliation_${status}`,
      detail: primaryIssue?.detail ?? raw.detail,
      mismatchCategory: primaryIssue?.mismatchCategory ?? null,
      recoveryAction: primaryIssue?.recoveryAction ?? null,
      fallbackCategory: status === "ok" ? "execution_ready" : status === "warning" ? "pending" : "blocked"
    }).category;
  return {
    status,
    statusCategory,
    checkedAt: toNullableString(raw.checkedAt),
    detail: toNullableString(raw.detail),
    autoApplied: raw.autoApplied === true,
    issues,
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
    onchainSnapshot,
    executionSnapshot: normalizeStoredBotVaultV3ExecutionSnapshot(raw.executionSnapshot)
  };
}

export function buildBotVaultV3ReconciliationIssue(params: {
  code: string;
  severity: "warning" | "blocking";
  statusCategory?: BotVaultV4StatusCategory | null;
  mismatch?: BotVaultV4MismatchClassification | null;
  mismatchCategory?: BotVaultV4MismatchCategory | null;
  recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
  field?: string | null;
  sourceOfTruth: "onchain" | "execution" | "local_settlement" | "derived";
  detail: string;
  autoRecoverable?: boolean;
  autoRecovered?: boolean;
  dbValue?: number | string | null;
  observedValue?: number | string | null;
  expectedValue?: number | string | null;
}): BotVaultV3ReconciliationIssue {
  const mismatchCategory = params.mismatch?.category ?? params.mismatchCategory ?? null;
  const recoveryAction = params.mismatch?.recoveryAction ?? params.recoveryAction ?? null;
  const recoveryHint = deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
  const statusCategory = params.statusCategory
    ?? classifyBotVaultV4Status({
      reason: params.code,
      detail: params.detail,
      mismatch: params.mismatch ?? null,
      mismatchCategory,
      recoveryAction,
      issueSeverity: params.severity
    }).category;
  return {
    code: params.code,
    severity: params.severity,
    statusCategory,
    mismatchCategory,
    recoveryAction,
    recoveryHint,
    field: params.field ?? null,
    sourceOfTruth: params.sourceOfTruth,
    detail: params.detail,
    autoRecoverable: params.autoRecoverable === true,
    autoRecovered: params.autoRecovered === true,
    dbValue: params.dbValue ?? null,
    observedValue: params.observedValue ?? null,
    expectedValue: params.expectedValue ?? null
  };
}

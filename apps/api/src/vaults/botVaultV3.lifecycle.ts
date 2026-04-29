export type BotVaultV3FundingLifecycleStage =
  | "deployed"
  | "funding_requested"
  | "hyper_evm_confirmed"
  | "hypercore_funded"
  | "perp_margin_transferred"
  | "hype_reserve_ready"
  | "execution_ready"
  | "failed"
  | "recovery_required"
  | "settled";

export type BotVaultV3FundingLifecycleTransition = {
  from: BotVaultV3FundingLifecycleStage | null;
  to: BotVaultV3FundingLifecycleStage;
  source: string;
  reason: string;
  detail: string | null;
  synthetic: boolean;
  occurredAt: string;
};

export type BotVaultV3FundingLifecycleState = {
  stage: BotVaultV3FundingLifecycleStage;
  updatedAt: string | null;
  failureReason: string | null;
  recoveryReason: string | null;
  history: BotVaultV3FundingLifecycleTransition[];
};

export type BotVaultV4MismatchCategory =
  | "local_ahead_of_observed_state"
  | "observed_state_incomplete"
  | "funding_verification_missing"
  | "reserve_bootstrap_incomplete"
  | "post_transfer_reconcile_failed"
  | "manual_intervention_required";

export type BotVaultV4MismatchRecoveryAction =
  | "none"
  | "retry"
  | "degrade"
  | "recovery_required"
  | "user_action_required";

export type BotVaultV4MismatchClassification = {
  category: BotVaultV4MismatchCategory;
  recoveryAction: BotVaultV4MismatchRecoveryAction;
  reason: string;
  detail: string | null;
};

export type BotVaultV4StatusCategory =
  | "pending"
  | "retryable"
  | "recovery_required"
  | "user_action_required"
  | "blocked"
  | "execution_ready"
  | "settled";

export type BotVaultV4StatusDescriptor = {
  category: BotVaultV4StatusCategory;
  reason: string;
  detail: string | null;
  mismatchCategory: BotVaultV4MismatchCategory | null;
  recoveryAction: BotVaultV4MismatchRecoveryAction | null;
};

const USD_EPSILON = 0.000001;

export const BOT_VAULT_V3_FUNDING_LIFECYCLE_ORDER: BotVaultV3FundingLifecycleStage[] = [
  "deployed",
  "funding_requested",
  "hyper_evm_confirmed",
  "hypercore_funded",
  "perp_margin_transferred",
  "hype_reserve_ready",
  "execution_ready",
  "settled"
];

const BOT_VAULT_V3_FUNDING_PROGRESS_INDEX = new Map(
  BOT_VAULT_V3_FUNDING_LIFECYCLE_ORDER.map((stage, index) => [stage, index])
);

const LEGAL_TRANSITIONS: Record<BotVaultV3FundingLifecycleStage, BotVaultV3FundingLifecycleStage[]> = {
  deployed: ["funding_requested", "failed", "recovery_required", "settled"],
  funding_requested: ["hyper_evm_confirmed", "failed", "recovery_required", "settled"],
  hyper_evm_confirmed: ["hypercore_funded", "failed", "recovery_required", "settled"],
  hypercore_funded: ["perp_margin_transferred", "failed", "recovery_required", "settled"],
  perp_margin_transferred: ["hype_reserve_ready", "failed", "recovery_required", "settled"],
  hype_reserve_ready: ["execution_ready", "failed", "recovery_required", "settled"],
  execution_ready: ["hype_reserve_ready", "perp_margin_transferred", "failed", "recovery_required", "settled"],
  failed: ["funding_requested", "recovery_required", "settled"],
  recovery_required: [
    "funding_requested",
    "hyper_evm_confirmed",
    "hypercore_funded",
    "perp_margin_transferred",
    "hype_reserve_ready",
    "execution_ready",
    "failed",
    "settled"
  ],
  settled: []
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

export function normalizeBotVaultV4MismatchCategory(value: unknown): BotVaultV4MismatchCategory | null {
  const category = String(value ?? "").trim().toLowerCase();
  switch (category) {
    case "local_ahead_of_observed_state":
    case "observed_state_incomplete":
    case "funding_verification_missing":
    case "reserve_bootstrap_incomplete":
    case "post_transfer_reconcile_failed":
    case "manual_intervention_required":
      return category;
    default:
      return null;
  }
}

export function normalizeBotVaultV4MismatchRecoveryAction(value: unknown): BotVaultV4MismatchRecoveryAction | null {
  const action = String(value ?? "").trim().toLowerCase();
  switch (action) {
    case "none":
    case "retry":
    case "degrade":
    case "recovery_required":
    case "user_action_required":
      return action;
    default:
      return null;
  }
}

export function normalizeBotVaultV4StatusCategory(value: unknown): BotVaultV4StatusCategory | null {
  const category = String(value ?? "").trim().toLowerCase();
  switch (category) {
    case "pending":
    case "retryable":
    case "recovery_required":
    case "user_action_required":
    case "blocked":
    case "execution_ready":
    case "settled":
      return category;
    default:
      return null;
  }
}

function deriveBotVaultV4MismatchCategory(params: {
  reason: string;
  detail: string | null;
  failureClass: string | null;
  defaultCategory: BotVaultV4MismatchCategory | null;
}): BotVaultV4MismatchCategory | null {
  const haystack = `${params.reason} ${params.detail ?? ""} ${params.failureClass ?? ""}`.toLowerCase();
  if (
    haystack.includes("user_action")
    || haystack.includes("manual")
    || haystack.includes("hypercore_exit_gas_usdc_missing")
    || haystack.includes("hypercore_exit_gas_budget_too_low")
    || haystack.includes("hypercore_exit_gas_order_not_allowed")
    || haystack.includes("hypercore_exit_corewriter_missing")
    || haystack.includes("hypercore_exit_gas_market_client_missing")
    || haystack.includes("hypercore_exit_gas_market_missing")
    || haystack.includes("core_spot_usdc_missing")
    || haystack.includes("budget_too_low")
    || haystack.includes("order_not_allowed")
    || haystack.includes("corewriter_missing")
    || haystack.includes("market_client_missing")
    || haystack.includes("market_missing")
    || haystack.includes("unknown_failure")
  ) {
    return "manual_intervention_required";
  }
  if (haystack.includes("post_reconcile")) return "post_transfer_reconcile_failed";
  if (haystack.includes("hype_reserve")) return "reserve_bootstrap_incomplete";
  if (
    haystack.includes("counterevidence")
    || haystack.includes("local_ahead")
    || haystack.includes("downgraded")
    || haystack.includes("recovery_required")
  ) {
    return "local_ahead_of_observed_state";
  }
  if (
    haystack.includes("funding_verification")
    || haystack.includes("funding_verified")
    || haystack.includes("margin_funding")
    || haystack.includes("perp_margin")
    || haystack.includes("transfer_not")
    || haystack.includes("transfer_observed")
    || haystack.includes("final_state")
    || haystack.includes("perp_state")
    || haystack.includes("pause")
  ) {
    return "funding_verification_missing";
  }
  if (params.defaultCategory) return params.defaultCategory;
  if (
    haystack.includes("unavailable")
    || haystack.includes("unverified")
    || haystack.includes("visibility_pending")
    || haystack.includes("pending")
    || haystack.includes("not_visible")
    || haystack.includes("snapshot_missing")
    || haystack.includes("read")
  ) {
    return "observed_state_incomplete";
  }
  return null;
}

function deriveBotVaultV4MismatchRecoveryAction(params: {
  category: BotVaultV4MismatchCategory;
  reason: string;
  detail: string | null;
  failureClass: string | null;
}): BotVaultV4MismatchRecoveryAction {
  const haystack = `${params.reason} ${params.detail ?? ""} ${params.failureClass ?? ""}`.toLowerCase();
  if (params.category === "manual_intervention_required") {
    return haystack.includes("user_action")
      || haystack.includes("hypercore_exit_gas_usdc_missing")
      || haystack.includes("hypercore_exit_gas_budget_too_low")
      || haystack.includes("core_spot_usdc_missing")
      || haystack.includes("budget_too_low")
      ? "user_action_required"
      : "recovery_required";
  }
  if (params.category === "post_transfer_reconcile_failed") {
    return haystack.includes("recovery_required") ? "recovery_required" : "retry";
  }
  if (params.category === "reserve_bootstrap_incomplete") {
    if (params.failureClass === "user_action_required") return "user_action_required";
    if (params.failureClass === "recovery_required") return "recovery_required";
    return "retry";
  }
  if (params.category === "local_ahead_of_observed_state") {
    return haystack.includes("execution_ready_counterevidence") || haystack.includes("downgraded")
      ? "degrade"
      : "recovery_required";
  }
  if (params.category === "observed_state_incomplete" || params.category === "funding_verification_missing") {
    return "retry";
  }
  return "none";
}

/**
 * Small v4 mismatch model used by reconcile, readiness and recovery status.
 * Read failures classify as `observed_state_incomplete` with `retry`; only
 * content counterevidence uses `degrade`, `recovery_required` or user action.
 */
export function classifyBotVaultV4Mismatch(params: {
  reason: unknown;
  detail?: unknown;
  failureClass?: unknown;
  defaultCategory?: BotVaultV4MismatchCategory | null;
}): BotVaultV4MismatchClassification | null {
  const reason = toNullableString(params.reason);
  const detail = toNullableString(params.detail);
  const failureClass = toNullableString(params.failureClass);
  const defaultCategory = normalizeBotVaultV4MismatchCategory(params.defaultCategory);
  if (!reason && !detail && !failureClass && !defaultCategory) return null;
  const category = deriveBotVaultV4MismatchCategory({
    reason: reason ?? "",
    detail,
    failureClass,
    defaultCategory
  });
  if (!category) return null;
  return {
    category,
    recoveryAction: deriveBotVaultV4MismatchRecoveryAction({
      category,
      reason: reason ?? "",
      detail,
      failureClass
    }),
    reason: reason ?? category,
    detail
  };
}

export function classifyBotVaultV4Status(params: {
  ready?: boolean | null;
  lifecycleStage?: unknown;
  readinessStage?: unknown;
  reconciliationStatus?: unknown;
  issueSeverity?: unknown;
  reason?: unknown;
  detail?: unknown;
  mismatch?: BotVaultV4MismatchClassification | null;
  mismatchCategory?: unknown;
  recoveryAction?: unknown;
  fallbackCategory?: unknown;
}): BotVaultV4StatusDescriptor {
  const ready = params.ready === true ? true : params.ready === false ? false : null;
  const lifecycleStage = normalizeStage(params.lifecycleStage);
  const readinessStage =
    typeof params.readinessStage === "string" ? params.readinessStage.trim().toLowerCase() : null;
  const reconciliationStatus =
    typeof params.reconciliationStatus === "string"
      ? params.reconciliationStatus.trim().toLowerCase()
      : null;
  const issueSeverity =
    typeof params.issueSeverity === "string" ? params.issueSeverity.trim().toLowerCase() : null;
  const reason = toNullableString(params.reason);
  const detail = toNullableString(params.detail);
  const mismatchCategory =
    params.mismatch?.category ?? normalizeBotVaultV4MismatchCategory(params.mismatchCategory);
  const recoveryAction =
    params.mismatch?.recoveryAction ??
    normalizeBotVaultV4MismatchRecoveryAction(params.recoveryAction);
  const fallbackCategory = normalizeBotVaultV4StatusCategory(params.fallbackCategory);
  const haystack = [
    reason,
    detail,
    mismatchCategory,
    recoveryAction,
    readinessStage,
    reconciliationStatus
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  let category: BotVaultV4StatusCategory;

  if (lifecycleStage === "settled" || haystack.includes("settled")) {
    category = "settled";
  } else if (ready === true) {
    category = "execution_ready";
  } else if (
    recoveryAction === "user_action_required" ||
    haystack.includes("user_action_required") ||
    haystack.includes("agent_setup_required") ||
    haystack.includes("core_spot_usdc_missing") ||
    haystack.includes("budget_too_low")
  ) {
    category = "user_action_required";
  } else if (
    recoveryAction === "recovery_required" ||
    recoveryAction === "degrade" ||
    mismatchCategory === "manual_intervention_required" ||
    lifecycleStage === "recovery_required" ||
    lifecycleStage === "failed" ||
    haystack.includes("recovery_required")
  ) {
    category = "recovery_required";
  } else if (
    recoveryAction === "retry" ||
    haystack.includes("retryable") ||
    haystack.includes("retry") ||
    haystack.includes("unavailable") ||
    haystack.includes("visibility_pending") ||
    haystack.includes("not_visible") ||
    haystack.includes("snapshot_missing") ||
    haystack.includes("read_failure")
  ) {
    category = "retryable";
  } else if (
    reconciliationStatus === "blocking" ||
    issueSeverity === "blocking" ||
    readinessStage === "blocked" ||
    haystack.includes("blocked") ||
    haystack.includes("close_only") ||
    haystack.includes("closed") ||
    haystack.includes("contradiction")
  ) {
    category = "blocked";
  } else if (ready !== false && lifecycleStage === "execution_ready") {
    category = "execution_ready";
  } else if (fallbackCategory) {
    category = fallbackCategory;
  } else if (
    readinessStage === "configuration" ||
    readinessStage === "funding" ||
    readinessStage === "transfer" ||
    readinessStage === "verification" ||
    reconciliationStatus === "warning" ||
    haystack.includes("pending") ||
    haystack.includes("not_confirmed") ||
    haystack.includes("not_started") ||
    lifecycleStage === "deployed" ||
    lifecycleStage === "funding_requested" ||
    lifecycleStage === "hyper_evm_confirmed" ||
    lifecycleStage === "hypercore_funded" ||
    lifecycleStage === "perp_margin_transferred" ||
    lifecycleStage === "hype_reserve_ready"
  ) {
    category = "pending";
  } else {
    category = "blocked";
  }

  return {
    category,
    reason: reason ?? category,
    detail,
    mismatchCategory,
    recoveryAction
  };
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeExecutionStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeFundingStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeChainStatus(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeContractVersion(value: unknown): "v3" | "v4" {
  return String(value ?? "").trim().toLowerCase() === "v4" ? "v4" : "v3";
}

function normalizeStage(value: unknown): BotVaultV3FundingLifecycleStage | null {
  const stage = String(value ?? "").trim().toLowerCase();
  switch (stage) {
    case "deployed":
    case "funding_requested":
    case "hyper_evm_confirmed":
    case "hypercore_funded":
    case "perp_margin_transferred":
    case "hype_reserve_ready":
    case "execution_ready":
    case "failed":
    case "recovery_required":
    case "settled":
      return stage;
    default:
      return null;
  }
}

function normalizeTransition(value: unknown): BotVaultV3FundingLifecycleTransition | null {
  const record = toRecord(value);
  const to = normalizeStage(record.to);
  if (!to) return null;
  const from = normalizeStage(record.from);
  const source = toNullableString(record.source);
  const reason = toNullableString(record.reason);
  const occurredAt = toNullableString(record.occurredAt);
  if (!source || !reason || !occurredAt) return null;
  return {
    from,
    to,
    source,
    reason,
    detail: toNullableString(record.detail),
    synthetic: record.synthetic === true,
    occurredAt
  };
}

function isEconomicallyClosed(row: Record<string, unknown>): boolean {
  const fundingStatus = normalizeFundingStatus(row.fundingStatus);
  const hypercoreFundingStatus = normalizeFundingStatus(row.hypercoreFundingStatus);
  const executionStatus = normalizeExecutionStatus(row.executionStatus);
  const chainStatus = normalizeChainStatus(row.status);
  if (fundingStatus === "settled" || hypercoreFundingStatus === "withdrawn" || executionStatus === "closed") {
    return true;
  }
  return (
    chainStatus === "CLOSED"
    || (
      chainStatus === "CLOSE_ONLY"
      && toNonNegativeNumber(row.availableUsd) <= USD_EPSILON
      && toNonNegativeNumber(row.principalReturned) > USD_EPSILON
    )
  );
}

function deriveLegacyStage(row: Record<string, unknown>): BotVaultV3FundingLifecycleStage {
  const metadata = toRecord(row.executionMetadata);
  const fundingIntent = toRecord(metadata.fundingIntent);
  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  const contractVersion = normalizeContractVersion(metadata.onchainContractVersion);
  const fundingStatus = normalizeFundingStatus(row.fundingStatus);
  const hypercoreFundingStatus = normalizeFundingStatus(row.hypercoreFundingStatus);
  const chainStatus = normalizeChainStatus(row.status);
  const fundingIntentStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
  const fundingIntentTimeoutReason = toNullableString(fundingIntent.timeoutReason);
  const fundingIntentTimedOutAt = toNullableString(fundingIntent.timedOutAt);
  const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
  const verificationBlockingReason = toNullableString(marginAddFinalization.verificationBlockingReason);
  const hypeReserveState = String(
    marginAddFinalization.hypeReserveState
    ?? metadata.hypeReserveState
    ?? ""
  ).trim().toLowerCase();
  const autoHypercoreFundingStatus = String(metadata.autoHypercoreFundingStatus ?? "").trim().toLowerCase();
  const hasFundingRequested =
    fundingStatus === "hyper_evm_funding_requested"
    || fundingIntentStatus === "prepared"
    || fundingIntentStatus === "submitted"
    || fundingIntentStatus === "confirmed";
  const hasOnchainFundingEvidence =
    fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || hypercoreFundingStatus === "pending"
    || hypercoreFundingStatus === "funded"
    || hypercoreFundingStatus === "withdrawn"
    || chainStatus === "FUNDED"
    || chainStatus === "PAUSED"
    || chainStatus === "CLOSE_ONLY"
    || chainStatus === "CLOSED";

  if (isEconomicallyClosed(row)) return "settled";
  if (fundingIntentStatus === "failed" && !hasOnchainFundingEvidence) return "failed";
  if ((fundingIntentStatus === "timed_out" || fundingIntentTimeoutReason || fundingIntentTimedOutAt) && !hasOnchainFundingEvidence) {
    return "recovery_required";
  }
  if (verificationState === "funding_verified") {
    if (contractVersion === "v4") {
      return hypeReserveState === "ready" ? "execution_ready" : "hype_reserve_ready";
    }
    return "execution_ready";
  }
  if (contractVersion === "v4" && hypeReserveState === "ready") {
    return "hype_reserve_ready";
  }
  if (hypercoreFundingStatus === "funded") {
    return "hypercore_funded";
  }
  if (verificationState === "transfer_observed" || verificationState === "transfer_submitted") {
    return verificationBlockingReason ? "recovery_required" : "perp_margin_transferred";
  }
  if (
    autoHypercoreFundingStatus === "confirmed"
    || toNullableString(metadata.autoHypercoreFundingTxHash)
    || toNullableString(marginAddFinalization.depositTxHash)
    || hypercoreFundingStatus === "pending"
  ) {
    return "hypercore_funded";
  }
  if (hasOnchainFundingEvidence) return "hyper_evm_confirmed";
  if (hasFundingRequested) return "funding_requested";
  return "deployed";
}

export function createBotVaultV3FundingLifecycleMetadata(
  stage: BotVaultV3FundingLifecycleStage,
  occurredAt: Date | string = new Date()
): { fundingLifecycle: BotVaultV3FundingLifecycleState } {
  const iso = occurredAt instanceof Date ? occurredAt.toISOString() : String(occurredAt);
  return {
    fundingLifecycle: {
      stage,
      updatedAt: iso,
      failureReason: null,
      recoveryReason: null,
      history: []
    }
  };
}

export function readBotVaultV3FundingLifecycleState(row: unknown): BotVaultV3FundingLifecycleState {
  const normalizedRow = toRecord(row);
  const metadata = toRecord(normalizedRow.executionMetadata);
  const lifecycle = toRecord(metadata.fundingLifecycle);
  const stage = normalizeStage(lifecycle.stage) ?? deriveLegacyStage(normalizedRow);
  const history = Array.isArray(lifecycle.history)
    ? lifecycle.history.map(normalizeTransition).filter((item): item is BotVaultV3FundingLifecycleTransition => Boolean(item))
    : [];
  return {
    stage,
    updatedAt: toNullableString(lifecycle.updatedAt),
    failureReason: toNullableString(lifecycle.failureReason),
    recoveryReason: toNullableString(lifecycle.recoveryReason),
    history
  };
}

export function getBotVaultV3FundingLifecycleStage(row: unknown): BotVaultV3FundingLifecycleStage {
  return readBotVaultV3FundingLifecycleState(row).stage;
}

export function getBotVaultV3FundingLifecycleProgressIndex(stage: BotVaultV3FundingLifecycleStage): number {
  return BOT_VAULT_V3_FUNDING_PROGRESS_INDEX.get(stage) ?? -1;
}

export function compareBotVaultV3FundingLifecycleStage(
  left: BotVaultV3FundingLifecycleStage,
  right: BotVaultV3FundingLifecycleStage
): number {
  return getBotVaultV3FundingLifecycleProgressIndex(left) - getBotVaultV3FundingLifecycleProgressIndex(right);
}

export function hasBotVaultV3FundingReadiness(row: unknown): boolean {
  return getBotVaultV3FundingLifecycleStage(row) === "execution_ready";
}

export function findBotVaultV3FundingLifecyclePath(
  from: BotVaultV3FundingLifecycleStage,
  to: BotVaultV3FundingLifecycleStage
): BotVaultV3FundingLifecycleStage[] | null {
  if (from === to) return [from];
  if (from === "execution_ready" && to === "perp_margin_transferred") {
    return ["execution_ready", "hype_reserve_ready", "perp_margin_transferred"];
  }
  if (from === "execution_ready" && to === "hype_reserve_ready") {
    return ["execution_ready", "hype_reserve_ready"];
  }
  if (from === "hype_reserve_ready" && to === "perp_margin_transferred") {
    return ["hype_reserve_ready", "perp_margin_transferred"];
  }

  const fromProgress = BOT_VAULT_V3_FUNDING_PROGRESS_INDEX.get(from);
  const toProgress = BOT_VAULT_V3_FUNDING_PROGRESS_INDEX.get(to);
  if (fromProgress != null && toProgress != null) {
    if (toProgress < fromProgress) return null;
    return BOT_VAULT_V3_FUNDING_LIFECYCLE_ORDER.slice(fromProgress, toProgress + 1);
  }

  const queue: Array<{ stage: BotVaultV3FundingLifecycleStage; path: BotVaultV3FundingLifecycleStage[] }> = [
    { stage: from, path: [from] }
  ];
  const visited = new Set<BotVaultV3FundingLifecycleStage>([from]);

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    for (const candidate of LEGAL_TRANSITIONS[next.stage] ?? []) {
      if (visited.has(candidate)) continue;
      const path = [...next.path, candidate];
      if (candidate === to) return path;
      visited.add(candidate);
      queue.push({ stage: candidate, path });
    }
  }

  return null;
}

export function assertBotVaultV3FundingLifecycleTransition(
  from: BotVaultV3FundingLifecycleStage,
  to: BotVaultV3FundingLifecycleStage
): void {
  if (!findBotVaultV3FundingLifecyclePath(from, to)) {
    throw new Error(`bot_vault_v3_illegal_funding_lifecycle_transition:${from}->${to}`);
  }
}

function resolveLegacyExecutionStatusForStage(stage: BotVaultV3FundingLifecycleStage, current: unknown): string {
  const normalizedCurrent = normalizeExecutionStatus(current);
  if (stage === "settled") return "closed";
  if (["running", "paused", "close_only", "closed", "error"].includes(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return "created";
}

function buildLegacyStatusPatch(
  stage: BotVaultV3FundingLifecycleStage,
  row: Record<string, unknown>
): Record<string, unknown> {
  if (stage === "failed" || stage === "recovery_required") {
    return {};
  }

  switch (stage) {
    case "deployed":
      return {
        fundingStatus: "deployed",
        hypercoreFundingStatus: "not_funded",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "funding_requested":
      return {
        fundingStatus: "hyper_evm_funding_requested",
        hypercoreFundingStatus: "not_funded",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "hyper_evm_confirmed":
      return {
        fundingStatus: "hyper_evm_confirmed_onchain",
        hypercoreFundingStatus: "not_funded",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "hypercore_funded":
      return {
        fundingStatus: "hyper_evm_confirmed_onchain",
        hypercoreFundingStatus: "pending",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "perp_margin_transferred":
      return {
        fundingStatus: "hyper_evm_confirmed_onchain",
        hypercoreFundingStatus: "pending",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "hype_reserve_ready":
      return {
        fundingStatus: "hyper_evm_confirmed_onchain",
        hypercoreFundingStatus: "pending",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "execution_ready":
      return {
        fundingStatus: "hyper_evm_confirmed_onchain",
        hypercoreFundingStatus: "funded",
        executionStatus: resolveLegacyExecutionStatusForStage(stage, row.executionStatus)
      };
    case "settled":
      return {
        fundingStatus: "settled",
        hypercoreFundingStatus: "withdrawn",
        executionStatus: "closed"
      };
    default:
      return {};
  }
}

export function buildBotVaultV3FundingLifecycleTransitionPatch(params: {
  row: unknown;
  targetStage: BotVaultV3FundingLifecycleStage;
  source: string;
  reason: string;
  detail?: string | null;
  occurredAt?: Date | string;
  metadataPatch?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const row = toRecord(params.row);
  const metadata = toRecord(row.executionMetadata);
  const current = readBotVaultV3FundingLifecycleState(row);
  const occurredAtIso = params.occurredAt instanceof Date
    ? params.occurredAt.toISOString()
    : toNullableString(params.occurredAt) ?? new Date().toISOString();

  const path = findBotVaultV3FundingLifecyclePath(current.stage, params.targetStage);
  if (!path) {
    throw new Error(`bot_vault_v3_illegal_funding_lifecycle_transition:${current.stage}->${params.targetStage}`);
  }

  const history = [...current.history];
  let previous = current.stage;
  for (let index = 1; index < path.length; index += 1) {
    const next = path[index];
    history.push({
      from: previous,
      to: next,
      source: params.source,
      reason: params.reason,
      detail: index === path.length - 1 ? toNullableString(params.detail) : "recovered_intermediate_transition",
      synthetic: index !== path.length - 1,
      occurredAt: occurredAtIso
    });
    previous = next;
  }

  let failureReason = current.failureReason;
  if (current.stage === "failed" && params.targetStage !== "failed") {
    failureReason = null;
  }
  if (params.targetStage === "failed") {
    failureReason = params.reason;
  }

  let recoveryReason = current.recoveryReason;
  if (current.stage === "recovery_required" && params.targetStage !== "recovery_required") {
    recoveryReason = null;
  }
  if (params.targetStage === "recovery_required") {
    recoveryReason = params.reason;
  }

  const lifecycleState: BotVaultV3FundingLifecycleState = {
    stage: params.targetStage,
    updatedAt: occurredAtIso,
    failureReason,
    recoveryReason,
    history
  };

  return {
    ...buildLegacyStatusPatch(params.targetStage, row),
    executionMetadata: {
      ...metadata,
      ...(params.metadataPatch ?? {}),
      fundingLifecycle: lifecycleState
    }
  };
}

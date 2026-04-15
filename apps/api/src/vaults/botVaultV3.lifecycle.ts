export type BotVaultV3FundingLifecycleStage =
  | "deployed"
  | "funding_requested"
  | "hyper_evm_confirmed"
  | "hypercore_funded"
  | "perp_margin_transferred"
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

const USD_EPSILON = 0.000001;

export const BOT_VAULT_V3_FUNDING_LIFECYCLE_ORDER: BotVaultV3FundingLifecycleStage[] = [
  "deployed",
  "funding_requested",
  "hyper_evm_confirmed",
  "hypercore_funded",
  "perp_margin_transferred",
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
  perp_margin_transferred: ["execution_ready", "failed", "recovery_required", "settled"],
  execution_ready: ["perp_margin_transferred", "failed", "recovery_required", "settled"],
  failed: ["funding_requested", "recovery_required", "settled"],
  recovery_required: [
    "funding_requested",
    "hyper_evm_confirmed",
    "hypercore_funded",
    "perp_margin_transferred",
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

function normalizeStage(value: unknown): BotVaultV3FundingLifecycleStage | null {
  const stage = String(value ?? "").trim().toLowerCase();
  switch (stage) {
    case "deployed":
    case "funding_requested":
    case "hyper_evm_confirmed":
    case "hypercore_funded":
    case "perp_margin_transferred":
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
  const fundingStatus = normalizeFundingStatus(row.fundingStatus);
  const hypercoreFundingStatus = normalizeFundingStatus(row.hypercoreFundingStatus);
  const executionStatus = normalizeExecutionStatus(row.executionStatus);
  const chainStatus = normalizeChainStatus(row.status);
  const fundingIntentStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
  const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
  const verificationBlockingReason = toNullableString(marginAddFinalization.verificationBlockingReason);
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
  if (executionStatus === "running" || executionStatus === "paused" || executionStatus === "close_only") {
    return "execution_ready";
  }
  if (hypercoreFundingStatus === "funded" || verificationState === "funding_verified") {
    return "execution_ready";
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
    return ["execution_ready", "perp_margin_transferred"];
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

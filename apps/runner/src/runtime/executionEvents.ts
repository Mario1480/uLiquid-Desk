type RunnerExecutionDomain = "prediction_copier" | "grid";

export type NormalizedExecutionResult = {
  status: "executed" | "blocked" | "noop" | "failed";
  reason: string;
  orderId: string | null;
  metadata: Record<string, unknown>;
};

export type NormalizedCloseOutcome = {
  closed: boolean;
  outcome: "closed" | "not_closed" | "failed";
  reason: string | null;
  source: "paper" | "venue" | "history" | "unknown";
  orderId?: string | null;
  closedQty?: number | null;
  metadata: Record<string, unknown>;
};

export type NormalizedReconciliationResult = {
  reconciled: boolean;
  outcome: "reconciled" | "noop" | "failed";
  reason: string | null;
  closedCount: number;
  metadata: Record<string, unknown>;
};

type RunnerExecutionMetaParams = {
  domain: RunnerExecutionDomain;
  stage: string;
  symbol?: string | null;
  instanceId?: string | null;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
};

function normalizeSymbol(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function toRunnerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildRunnerExecutionMeta(params: RunnerExecutionMetaParams): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    domain: params.domain,
    stage: params.stage
  };

  const symbol = normalizeSymbol(params.symbol);
  if (symbol) meta.symbol = symbol;
  if (params.instanceId) meta.instanceId = params.instanceId;
  if (params.reason) meta.reason = params.reason;
  if (params.error !== undefined) meta.error = toRunnerErrorMessage(params.error);
  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      if (value !== undefined) meta[key] = value;
    }
  }
  return meta;
}

export function createNormalizedExecutionResult(params: {
  status: NormalizedExecutionResult["status"];
  reason: string;
  orderId?: string | null;
  metadata?: Record<string, unknown> | null;
}): NormalizedExecutionResult {
  return {
    status: params.status,
    reason: params.reason,
    orderId: params.orderId ?? null,
    metadata: params.metadata ?? {}
  };
}

export function createNormalizedCloseOutcome(params: {
  closed: boolean;
  reason?: string | null;
  source: NormalizedCloseOutcome["source"];
  orderId?: string | null;
  closedQty?: number | null;
  metadata?: Record<string, unknown> | null;
}): NormalizedCloseOutcome {
  const outcome: NormalizedCloseOutcome["outcome"] = params.closed
    ? "closed"
    : params.reason
      ? "failed"
      : "not_closed";
  return {
    closed: params.closed,
    outcome,
    reason: params.reason ?? null,
    source: params.source,
    orderId: params.orderId ?? null,
    closedQty: params.closedQty ?? null,
    metadata: params.metadata ?? {}
  };
}

export function mergeNormalizedCloseOutcomeMetadata(
  outcome: NormalizedCloseOutcome,
  metadata: Record<string, unknown> | null | undefined
): NormalizedCloseOutcome {
  if (!metadata || Object.keys(metadata).length === 0) return outcome;
  return {
    ...outcome,
    metadata: {
      ...outcome.metadata,
      ...metadata
    }
  };
}

export function createNormalizedReconciliationResult(params: {
  reconciled: boolean;
  reason?: string | null;
  closedCount?: number | null;
  metadata?: Record<string, unknown> | null;
}): NormalizedReconciliationResult {
  const outcome: NormalizedReconciliationResult["outcome"] = params.reconciled
    ? "reconciled"
    : params.reason
      ? "failed"
      : "noop";
  return {
    reconciled: params.reconciled,
    outcome,
    reason: params.reason ?? null,
    closedCount: Math.max(0, Number(params.closedCount ?? 0)),
    metadata: params.metadata ?? {}
  };
}

export function buildExecutionVenueMeta(params: {
  executionVenue: string;
  marketDataVenue?: string | null;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    executionVenue: params.executionVenue
  };
  if (params.marketDataVenue !== undefined) {
    meta.marketDataVenue = params.marketDataVenue ?? null;
  }
  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      if (value !== undefined) meta[key] = value;
    }
  }
  return meta;
}

export function buildPredictionCopierTradeMeta(params: {
  stage: string;
  symbol: string;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return buildRunnerExecutionMeta({
    domain: "prediction_copier",
    stage: params.stage,
    symbol: params.symbol,
    reason: params.reason ?? null,
    error: params.error,
    extra: params.extra ?? null
  });
}

export function buildGridExecutionMeta(params: {
  stage: string;
  symbol?: string | null;
  instanceId: string;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return buildRunnerExecutionMeta({
    domain: "grid",
    stage: params.stage,
    symbol: params.symbol ?? null,
    instanceId: params.instanceId,
    reason: params.reason ?? null,
    error: params.error,
    extra: params.extra ?? null
  });
}

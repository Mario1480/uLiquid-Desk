import { resolveRequiredQtyForVenueMinimums } from "@mm/futures-engine";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOpenPlannerPosition(position: {
  side?: "long" | "short" | null;
  qty?: number | null;
} | null | undefined): boolean {
  return Boolean(position && Number.isFinite(Number(position.qty)) && Number(position.qty) > 0);
}

function hasSeedDiagnosticsReadError(context: Record<string, unknown> | null | undefined): boolean {
  if (!context) return false;
  return [
    context.positionsReadError,
    context.openOrdersReadError,
    context.accountStateReadError,
    context.plannerPositionReadError,
    context.plannerPositionAdapterReadError,
    context.recentFillsReadError
  ].some((value) => String(value ?? "").trim().length > 0);
}

export function shouldMarkInitialSeedExecuted(params: {
  currentStateJson: Record<string, unknown>;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
    entryPrice?: number | null;
  } | null | undefined;
}): boolean {
  return params.currentStateJson.initialSeedPending === true && hasOpenPlannerPosition(params.plannerPosition);
}

export function shouldRetryInitialSeedSubmission(params: {
  currentStateJson: Record<string, unknown>;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
    entryPrice?: number | null;
  } | null | undefined;
  pendingSeedContext?: Record<string, unknown> | null;
  now?: Date;
  staleAfterMs?: number;
}): boolean {
  if (params.currentStateJson.initialSeedPending !== true) return false;
  if (hasOpenPlannerPosition(params.plannerPosition)) return false;

  const context = params.pendingSeedContext ?? asRecord(params.currentStateJson.initialSeedLastContext);
  if (hasSeedDiagnosticsReadError(context)) return false;
  const submitResult = asRecord(context?.submitResult);
  const submitOrderId = String(submitResult?.orderId ?? "").trim();
  const submitCandidateOrderId = String(submitResult?.candidateOrderId ?? "").trim();
  const submitTxHash = String(submitResult?.txHash ?? "").trim();

  const plannerPosition = asRecord(context?.plannerPosition);
  if (Number(plannerPosition?.qty ?? 0) > 0) return false;

  const matchingVenueOrders = Number(asRecord(context?.venueOpenOrders)?.matchingCount ?? NaN);
  if (Number.isFinite(matchingVenueOrders) && matchingVenueOrders > 0) return false;

  const matchingPositions = Number(asRecord(context?.positions)?.matchingCount ?? NaN);
  if (Number.isFinite(matchingPositions) && matchingPositions > 0) return false;

  const matchingRecentFills = Number(asRecord(context?.recentFills)?.matchingCount ?? NaN);
  if (Number.isFinite(matchingRecentFills) && matchingRecentFills > 0) return false;

  const terminalOrderStatus = String(context?.terminalOrderStatus ?? "").trim().toUpperCase();
  if (terminalOrderStatus === "REJECTED" || terminalOrderStatus === "EXPIRED" || terminalOrderStatus === "CANCELED") {
    return true;
  }

  if (submitOrderId || submitCandidateOrderId || submitTxHash) {
    const staleAfterMs = Math.max(1_000, Math.trunc(Number(params.staleAfterMs ?? 120_000)));
    const submittedAtRaw = String(
      params.currentStateJson.initialSeedAt
      ?? context?.capturedAt
      ?? context?.submittedAt
      ?? ""
    ).trim();
    const submittedAtMs = Date.parse(submittedAtRaw);
    if (!params.now || !Number.isFinite(submittedAtMs)) return false;
    return params.now.getTime() - submittedAtMs >= staleAfterMs;
  }

  return true;
}

export function resolveInitialSeedAttemptSeq(stateJson: Record<string, unknown>): number {
  const parsed = Number(stateJson.initialSeedAttemptSeq ?? 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.trunc(parsed));
}

export function buildInitialSeedClientOrderId(params: {
  instanceId: string;
  seedSide: "buy" | "sell";
  attemptSeq: number;
}): string {
  const side = params.seedSide === "sell" ? "sell" : "buy";
  const attemptSeq = Math.max(1, Math.trunc(Number(params.attemptSeq ?? 1)));
  return `grid-${params.instanceId}-seed-${side}-${attemptSeq}`;
}

export function buildFinalInitialSeedFailureState(params: {
  currentStateJson: Record<string, unknown>;
  now: Date;
  error: unknown;
  initialSeedContext: Record<string, unknown>;
  seedAttemptSeq: number;
}): Record<string, unknown> {
  const seedAttemptSeq = Math.max(1, Math.trunc(Number(params.seedAttemptSeq ?? 1)));
  return {
    ...params.currentStateJson,
    initialSeedPending: false,
    initialSeedNeedsReseed: false,
    initialSeedClientOrderId: null,
    initialSeedAttemptSeq: seedAttemptSeq + 1,
    initialSeedFailedAt: params.now.toISOString(),
    initialSeedLastError: String(params.error),
    initialSeedRetryCategory: String(params.initialSeedContext.retryCategory ?? "final_failure"),
    initialSeedRetryReasonCode: String(params.initialSeedContext.retryReasonCode ?? "final_failure"),
    initialSeedFailureFinal: true,
    initialSeedLastContext: {
      ...params.initialSeedContext,
      stage: "failed_final"
    }
  };
}

export function resolveRestartRecoveryGuardReason(params: {
  currentStateJson: Record<string, unknown>;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
    entryPrice?: number | null;
  } | null | undefined;
  openOrdersCount: number;
  reconciliationResult?: {
    drifts?: Array<{ kind?: string | null }>;
    newFills?: unknown[];
  } | null;
}): string | null {
  if (params.currentStateJson.initialSeedExecuted === true) return null;
  if (params.currentStateJson.initialSeedPending === true) return null;
  if (params.openOrdersCount > 0) return null;
  if (hasOpenPlannerPosition(params.plannerPosition)) return null;

  if ((params.reconciliationResult?.drifts ?? []).some((row) => row.kind === "live_open_missing_local")) {
    return "grid_restart_live_orders_reconciliation_required";
  }
  if ((params.reconciliationResult?.newFills?.length ?? 0) > 0) {
    return "grid_restart_fill_reconciliation_pending";
  }
  return null;
}

export function resolveInitialSeedOrderQty(params: {
  seedNotionalUsdRaw: number;
  markPrice: number;
  minQty: number | null;
  qtyStep: number | null;
  minNotional: number | null;
}): number {
  const markPrice = Math.max(Number(params.markPrice ?? NaN), 1e-9);
  if (!Number.isFinite(markPrice) || markPrice <= 0) return 0;
  return resolveRequiredQtyForVenueMinimums({
    qty: Number(params.seedNotionalUsdRaw ?? 0) / markPrice,
    price: markPrice,
    minQty: params.minQty,
    qtyStep: params.qtyStep,
    minNotional: params.minNotional,
    minNotionalStepBuffer: 1
  });
}

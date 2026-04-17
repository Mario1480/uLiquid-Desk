import type { TradeIntent } from "@mm/futures-core";
import { deriveBotVaultLifecycleState } from "@mm/core";
import {
  buildSharedExecutionVenue,
  resolveRequiredQtyForVenueMinimums,
  resolveVenueMinNotional,
  roundUpToStep
} from "@mm/futures-engine";
import {
  buildHyperliquidReadKey,
  buildOrderReferenceIdentity,
  collectCanonicalOrderReferenceKeys,
  collectOrderReferenceCandidates,
  collectOrderReferenceSet,
  executeHyperliquidRead,
  isConfirmedFuturesActionResult,
  isConfirmedPlaceOrderResult,
  type CancelOrderResult,
  type PlaceOrderResult,
  type SupportedFuturesAdapter
} from "@mm/futures-exchange";
import {
  archiveGridBotInstanceTerminal,
  applyBotVaultHypercoreAccountingFee,
  cancelPaperOrderForRunner,
  closePaperPositionForRunner,
  createGridBotFillEventEntry,
  createGridBotOrderMapEntry,
  findLatestBotOrderSince,
  findGridBotOrderMapByOrderRef,
  listGridBotFillEvents,
  listPaperPositionsForRunner,
  listGridBotOpenOrders,
  loadBotTradeState,
  placePaperPositionForRunner,
  placePaperLimitOrderForRunner,
  setPaperPositionProtectionForRunner,
  loadGridBotInstanceByBotId,
  type GridBotInstanceRuntime,
  seedGridBotVaultMatchingStateForGridInstance,
  simulatePaperGridLimitFillsForRunner,
  upsertBotTradeState,
  upsertBotOrderEntry,
  updateGridBotOrderMapStatus,
  updateGridBotInstancePlannerState,
  updateBotVaultExecutionRuntime,
  writeRiskEvent
} from "../db.js";
import { runGridPlan, type GridPlanRequest, type GridPlannerIntent } from "../grid/pythonGridClient.js";
import { syncGridFillEvents } from "../grid/fillSync.js";
import {
  coerceGateSummary,
  defaultGateSummary
} from "../runtime/decisionTrace.js";
import {
  buildExecutionVenueMeta,
  buildGridExecutionMeta,
  createNormalizedCloseOutcome,
  mergeNormalizedCloseOutcomeMetadata,
  type NormalizedCloseOutcome
} from "../runtime/executionEvents.js";
import { buildRunnerPaperExecutionContext } from "../runtime/paperExecution.js";
import { recordTradeExitHistory } from "../runtime/predictionTradeReconciliation.js";
import {
  buildModeBlockedResult,
  buildModeNoopResult,
  toOrderMarkPrice
} from "./modeUtils.js";
import {
  fetchBinancePerpMarkPrice,
  getOrCreateRunnerFuturesAdapter,
  normalizeComparableSymbol,
  normalizeVaultExecutionState,
  readMarkPriceDiagnosticFromAdapter
} from "./futuresVenueRuntime.js";
import {
  getOrCreateHyperliquidExecutionMonitor,
  type ReconciliationResult
} from "./hyperliquidExecutionMonitor.js";
import { executeRunnerSharedExecutionPipeline } from "./sharedExecution.js";
import {
  categorizeExecutionRetry,
  clearPendingGridExecution,
  createPendingGridExecution,
  getGridOrderResubmissionGuard,
  listPendingGridExecutions,
  mergeGridExecutionRecoveryState,
  recordGridOrderSubmissionAttempt,
  recordGridFillSyncRecoveryState,
  reconcileGridOpenOrdersAgainstVenue,
  recoverGridPendingExecutions,
  snapshotVenueOrdersForRecovery,
  upsertPendingGridExecution,
  type ExecutionRetryCategory,
} from "./recovery.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";

export { resolveVenueMinNotional };
const GRID_NOISE_RISK_EVENT_THROTTLE_MS = 120_000;
const GRID_NOISE_RISK_EVENT_CACHE_MAX = 2_000;
const HYPERCORE_ACCOUNTING_FEE_USD = 1;
const gridNoiseRiskEventCache = new Map<string, number>();

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

type PlannerFillEventInput = {
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  side?: "buy" | "sell" | null;
  fillPrice?: number | null;
  fillQty?: number | null;
  fillTs?: Date | string | null;
  gridIndex?: number | null;
};

export function resolvePlannerFillEventsForExecution(params: {
  currentStateJson: Record<string, unknown>;
  paperFillEvents: PlannerFillEventInput[];
  liveFillEvents: PlannerFillEventInput[];
}): {
  plannerFillEvents: Array<{
    exchangeOrderId?: string | null;
    clientOrderId?: string | null;
    side?: "buy" | "sell" | null;
    fillPrice: number;
    fillQty: number;
    fillTs: string;
    gridIndex?: number | null;
  }>;
  latestProcessedFillTs: string | null;
} {
  const plannerFillEvents: Array<{
    exchangeOrderId?: string | null;
    clientOrderId?: string | null;
    side?: "buy" | "sell" | null;
    fillPrice: number;
    fillQty: number;
    fillTs: string;
    gridIndex?: number | null;
  }> = [];
  let latestProcessedFillTs = String(params.currentStateJson.lastProcessedGridFillTs ?? "").trim() || null;

  for (const fill of [...params.paperFillEvents, ...params.liveFillEvents]) {
    const fillPrice = Number(fill.fillPrice ?? NaN);
    const fillQty = Number(fill.fillQty ?? NaN);
    const fillDate = fill.fillTs instanceof Date ? fill.fillTs : new Date(String(fill.fillTs ?? ""));
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) continue;
    if (!Number.isFinite(fillQty) || fillQty <= 0) continue;
    if (Number.isNaN(fillDate.getTime())) continue;
    const fillTs = fillDate.toISOString();
    plannerFillEvents.push({
      exchangeOrderId: fill.exchangeOrderId ?? null,
      clientOrderId: fill.clientOrderId ?? null,
      side: fill.side === "sell" ? "sell" : "buy",
      fillPrice,
      fillQty,
      fillTs,
      gridIndex: Number.isFinite(Number(fill.gridIndex)) ? Math.max(0, Math.trunc(Number(fill.gridIndex))) : null
    });
    if (!latestProcessedFillTs || fillTs > latestProcessedFillTs) {
      latestProcessedFillTs = fillTs;
    }
  }

  return {
    plannerFillEvents,
    latestProcessedFillTs
  };
}

export async function refreshTradeStateForVaultReconciliation(params: {
  executionExchange: string;
  liveFillEvents: PlannerFillEventInput[];
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  resolvePlannerPosition: () => Promise<{
    position: PlannerPositionSnapshot;
    source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
    degraded: boolean;
    readError: string | null;
  }>;
  syncTradeState: (plannerPosition: PlannerPositionSnapshot) => Promise<Awaited<ReturnType<typeof loadBotTradeState>>>;
}): Promise<{
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  plannerPositionResolution: {
    position: PlannerPositionSnapshot;
    source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
    degraded: boolean;
    readError: string | null;
  } | null;
}> {
  if (params.executionExchange === "paper" || params.liveFillEvents.length === 0) {
    return {
      tradeState: params.tradeState,
      plannerPositionResolution: null
    };
  }

  const plannerPositionResolution = await params.resolvePlannerPosition();
  return {
    tradeState: await params.syncTradeState(plannerPositionResolution.position),
    plannerPositionResolution
  };
}

export function extractHyperliquidLiveOrderRefs(params: {
  orderId?: string | null;
  raw?: unknown;
}): {
  clientOrderId: string | null;
  exchangeOrderRefs: string[];
} {
  const raw = params.raw && typeof params.raw === "object" && !Array.isArray(params.raw)
    ? params.raw as Record<string, unknown>
    : {};
  const clientOrderId = String(
    raw.clientOid
    ?? raw.clientOrderId
    ?? raw.clOrdId
    ?? ""
  ).trim() || null;
  const canonicalIdentity = buildOrderReferenceIdentity({
    clientOrderId,
    exchangeOrderId: params.orderId,
    cloid: String(raw.cloid ?? "").trim() || null
  });
  const exchangeOrderRefs = new Set<string>([
    ...collectOrderReferenceSet([
      params.orderId,
      raw.oid,
      raw.orderId,
      raw.order_id,
      raw.cloid
    ]),
    ...canonicalIdentity.keys,
    ...collectCanonicalOrderReferenceKeys([
      { value: params.orderId, hint: "exchange" },
      { value: raw.oid, hint: "exchange" },
      { value: raw.orderId, hint: "exchange" },
      { value: raw.order_id, hint: "exchange" },
      { value: raw.cloid, hint: "cloid" }
    ])
  ]);
  return {
    clientOrderId,
    exchangeOrderRefs: [...exchangeOrderRefs]
  };
}

export function liveOrderMatchesLocalOpenOrder(params: {
  openOrders: Array<{
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
  clientOrderId?: string | null;
  exchangeOrderRefs?: string[];
}): boolean {
  const targetKeys = collectCanonicalOrderReferenceKeys([
    { value: params.clientOrderId, hint: "client_or_cloid" },
    ...((Array.isArray(params.exchangeOrderRefs) ? params.exchangeOrderRefs : []).map((value) => ({
      value,
      hint: "exchange" as const
    }))),
    ...((Array.isArray(params.exchangeOrderRefs) ? params.exchangeOrderRefs : []).map((value) => ({
      value,
      hint: "client_or_cloid" as const
    })))
  ]);
  if (targetKeys.size === 0) return false;
  return params.openOrders.some((row) => {
    const localIdentity = buildOrderReferenceIdentity({
      clientOrderId: row.clientOrderId,
      exchangeOrderId: row.exchangeOrderId
    });
    for (const key of localIdentity.keys) {
      if (targetKeys.has(key)) return true;
    }
    return false;
  });
}

function isEntryLikeIntentType(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "entry" || normalized === "rebalance";
}

function selectCancelableEntryOrders(
  openOrders: Array<{
    exchangeOrderId?: string | null;
    clientOrderId?: string | null;
    reduceOnly?: boolean | null;
    intentType?: string | null;
    side?: "buy" | "sell" | null;
    price?: number | null;
    qty?: number | null;
  }>
): Array<{
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  reduceOnly?: boolean | null;
  intentType?: string | null;
  side?: "buy" | "sell" | null;
  price?: number | null;
  qty?: number | null;
}> {
  return openOrders.filter((row) => row.reduceOnly !== true && isEntryLikeIntentType(row.intentType));
}

function shouldThrottleGridNoiseRiskEvent(botId: string, signature: string, now: Date): boolean {
  const key = `${botId}:${signature}`;
  const nowMs = now.getTime();
  const lastAt = gridNoiseRiskEventCache.get(key) ?? 0;
  if (nowMs - lastAt < GRID_NOISE_RISK_EVENT_THROTTLE_MS) {
    return true;
  }
  gridNoiseRiskEventCache.set(key, nowMs);

  if (gridNoiseRiskEventCache.size > GRID_NOISE_RISK_EVENT_CACHE_MAX) {
    for (const [cacheKey, cacheTs] of gridNoiseRiskEventCache) {
      if (nowMs - cacheTs <= GRID_NOISE_RISK_EVENT_THROTTLE_MS * 2) continue;
      gridNoiseRiskEventCache.delete(cacheKey);
      if (gridNoiseRiskEventCache.size <= GRID_NOISE_RISK_EVENT_CACHE_MAX) break;
    }
  }
  return false;
}

export function resolveGridRiskNoopReason(params: {
  riskBlockingActive: boolean;
  hasOpenPosition: boolean;
}): "grid_entry_blocked_by_risk" | "grid_no_order_changes" {
  if (params.riskBlockingActive && !params.hasOpenPosition) {
    return "grid_entry_blocked_by_risk";
  }
  return "grid_no_order_changes";
}

export function resolveGridOrderResubmitGuardReason(params: {
  currentStateJson: Record<string, unknown> | null | undefined;
  clientOrderId?: string | null;
}): string | null {
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  if (!clientOrderId) return null;
  const guard = getGridOrderResubmissionGuard(params.currentStateJson, clientOrderId);
  if (!guard?.blockedAt) return null;
  return guard.blockReason ?? "grid_order_resubmit_limit_reached";
}

function readMarkPrice(signal: Parameters<ExecutionMode["execute"]>[0]): number | null {
  const fromIntent = toOrderMarkPrice(signal.legacyIntent);
  if (fromIntent && fromIntent > 0) return fromIntent;
  const metadata = signal.metadata as Record<string, unknown> | null;
  const candidates: unknown[] = [
    metadata?.markPrice,
    metadata?.lastPr,
    metadata?.last,
    metadata?.price,
    metadata?.close,
    metadata?.indexPrice,
    metadata?.lastPrice,
    metadata?.mark
  ];
  const ticker = metadata?.ticker;
  if (ticker && typeof ticker === "object" && !Array.isArray(ticker)) {
    const row = ticker as Record<string, unknown>;
    candidates.push(row.markPrice, row.lastPr, row.last, row.price, row.close, row.indexPrice, row.lastPrice, row.mark);
  }
  for (const candidate of candidates) {
    const parsed = Number(candidate ?? NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function summarizeVaultReconciliation(result: ReconciliationResult) {
  const blockingReason = resolveVaultReconciliationBlockReason(result);
  return {
    status: result.status,
    blockingReason,
    lastUpdatedAt: result.at,
    liveOpenOrdersCount: result.liveOpenOrders.length,
    trackedOrdersCount: result.orders.length,
    recentFillCount: result.recentFills.length,
    newFillCount: result.newFills.length,
    driftCount: result.drifts.length,
    criticalDriftCount: result.drifts.filter((row) => row.severity === "critical").length,
    alertCount: result.alerts.length,
    drifts: result.drifts.slice(0, 10),
    alerts: result.alerts.slice(0, 10),
    statusChanges: result.statusChanges.slice(0, 10),
    expectations: result.expectations,
    snapshot: result.snapshot
      ? {
          capturedAt: result.snapshot.capturedAt,
          equityUsd: result.snapshot.equityUsd,
          availableMarginUsd: result.snapshot.availableMarginUsd,
          coreUsdcSpotBalanceUsd: result.snapshot.coreUsdcSpotBalanceUsd,
          totalPositionNotionalUsd: result.snapshot.totalPositionNotionalUsd,
          positions: result.snapshot.positions
        }
      : null
  };
}

function toNullableIso(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toPositiveNumberOrNullLoose(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildVaultBalanceExpectation(params: {
  currentStateJson: Record<string, unknown>;
  openOrdersCount: number;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
  } | null;
  pendingExecutions: ReturnType<typeof listPendingGridExecutions>;
}) {
  const isIdleRuntime =
    params.openOrdersCount === 0
    && !hasOpenPlannerPosition(params.plannerPosition)
    && params.pendingExecutions.length === 0;
  if (!isIdleRuntime) return null;

  const closeOnlySpotToEvmDoneAt = toNullableIso(params.currentStateJson.closeOnlySpotToEvmDoneAt);
  if (closeOnlySpotToEvmDoneAt) {
    return {
      phase: "close_only_spot_to_evm_pending" as const,
      startedAt: closeOnlySpotToEvmDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.closeOnlySpotToEvmAmountUsd)
    };
  }

  const closeOnlyPerpToSpotDoneAt = toNullableIso(params.currentStateJson.closeOnlyPerpToSpotDoneAt);
  if (closeOnlyPerpToSpotDoneAt) {
    return {
      phase: "close_only_perp_to_spot_pending" as const,
      startedAt: closeOnlyPerpToSpotDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.closeOnlyPerpToSpotAmountUsd)
    };
  }

  const initialPerpTransferDoneAt = toNullableIso(params.currentStateJson.initialPerpTransferDoneAt);
  if (initialPerpTransferDoneAt) {
    return {
      phase: "initial_perp_funding_pending" as const,
      startedAt: initialPerpTransferDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(
        params.currentStateJson.initialPerpTransferAmountUsd
        ?? params.currentStateJson.initialPerpTransferRequestedAmountUsd
      )
    };
  }

  const initialCoreSpotTransferDoneAt = toNullableIso(params.currentStateJson.initialCoreSpotTransferDoneAt);
  if (initialCoreSpotTransferDoneAt) {
    return {
      phase: "initial_core_spot_funding_pending" as const,
      startedAt: initialCoreSpotTransferDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.initialCoreSpotTransferAmountUsd)
    };
  }

  return null;
}

export function resolveVaultReconciliationBlockReason(result: Pick<ReconciliationResult, "drifts" | "status">): string | null {
  const criticalDrifts = result.drifts.filter((row) => row.severity === "critical");
  if (criticalDrifts.length === 0 && result.status !== "critical") return null;
  if (criticalDrifts.some((row) => row.scope === "positions")) {
    return "grid_vault_position_reconciliation_required";
  }
  if (criticalDrifts.some((row) => row.scope === "balances")) {
    return "grid_vault_balance_reconciliation_required";
  }
  if (criticalDrifts.some((row) => row.scope === "executions")) {
    return "grid_vault_execution_reconciliation_required";
  }
  return "grid_vault_reconciliation_required";
}

export function computeInitialSeedSide(params: {
  mode: "long" | "short" | "neutral" | "cross";
  markPrice: number;
  lowerPrice: number;
  upperPrice: number;
  crossSideConfig?: GridBotInstanceRuntime["crossSideConfig"] | null;
}): "buy" | "sell" {
  if (params.mode === "long") return "buy";
  if (params.mode === "short") return "sell";
  if (params.mode === "cross" && params.crossSideConfig) {
    const longMidpoint = (Number(params.crossSideConfig.long.lowerPrice) + Number(params.crossSideConfig.long.upperPrice)) / 2;
    const shortMidpoint = (Number(params.crossSideConfig.short.lowerPrice) + Number(params.crossSideConfig.short.upperPrice)) / 2;
    if (Number(params.markPrice) <= longMidpoint) return "buy";
    if (Number(params.markPrice) >= shortMidpoint) return "sell";
    return Math.abs(Number(params.markPrice) - longMidpoint) <= Math.abs(shortMidpoint - Number(params.markPrice))
      ? "buy"
      : "sell";
  }
  const midpoint = (Number(params.lowerPrice) + Number(params.upperPrice)) / 2;
  return Number(params.markPrice) <= midpoint ? "buy" : "sell";
}

export function buildGridPlanRequest(params: {
  instance: Pick<
    GridBotInstanceRuntime,
    | "id"
    | "mode"
    | "gridMode"
    | "allocationMode"
    | "budgetSplitPolicy"
    | "longBudgetPct"
    | "shortBudgetPct"
    | "lowerPrice"
    | "upperPrice"
    | "gridCount"
    | "crossSideConfig"
    | "activeOrderWindowSize"
    | "recenterDriftLevels"
    | "investUsd"
    | "leverage"
    | "slippagePct"
    | "triggerPrice"
    | "tpPct"
    | "slPrice"
    | "extraMarginUsd"
    | "initialSeedEnabled"
    | "initialSeedPct"
  >;
  markPrice: number;
  openOrders: GridPlanRequest["openOrders"];
  position: GridPlanRequest["position"];
  stateJson: Record<string, unknown>;
  fillEvents: Array<Record<string, unknown>>;
  venueConstraints: NonNullable<GridPlanRequest["venueConstraints"]>;
  feeBufferPct: number;
  mmrPct: number | undefined;
  liqDistanceMinPct: number | undefined;
}): GridPlanRequest {
  return {
    instanceId: params.instance.id,
    mode: params.instance.mode,
    gridMode: params.instance.gridMode,
    allocationMode: params.instance.allocationMode,
    budgetSplitPolicy: params.instance.budgetSplitPolicy,
    longBudgetPct: params.instance.longBudgetPct,
    shortBudgetPct: params.instance.shortBudgetPct,
    lowerPrice: params.instance.lowerPrice,
    upperPrice: params.instance.upperPrice,
    gridCount: params.instance.gridCount,
    crossSideConfig: params.instance.crossSideConfig ?? undefined,
    activeOrderWindowSize: params.instance.activeOrderWindowSize,
    recenterDriftLevels: params.instance.recenterDriftLevels,
    investUsd: params.instance.investUsd,
    leverage: params.instance.leverage,
    slippagePct: params.instance.slippagePct,
    triggerPrice: params.instance.triggerPrice,
    tpPct: params.instance.tpPct,
    slPrice: params.instance.slPrice,
    trailingEnabled: false,
    markPrice: params.markPrice,
    openOrders: params.openOrders,
    position: params.position,
    stateJson: params.stateJson,
    fillEvents: params.fillEvents,
    venueConstraints: params.venueConstraints,
    feeBufferPct: params.feeBufferPct,
    mmrPct: params.mmrPct,
    extraMarginUsd: params.instance.extraMarginUsd,
    liqDistanceMinPct: params.liqDistanceMinPct,
    initialSeedEnabled: params.instance.initialSeedEnabled,
    initialSeedPct: params.instance.initialSeedPct
  };
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

  if (submitOrderId) {
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

// Vault restart recovery favors verified venue state over optimistic local flat assumptions.
// Unknown live orders or fresh restart fills must be reconciled before the runner seeds again.
export function resolveRestartRecoveryGuardReason(params: {
  currentStateJson: Record<string, unknown>;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
    entryPrice?: number | null;
  } | null | undefined;
  openOrdersCount: number;
  reconciliationResult?: Pick<ReconciliationResult, "drifts" | "newFills"> | null;
}): string | null {
  if (params.currentStateJson.initialSeedExecuted === true) return null;
  if (params.currentStateJson.initialSeedPending === true) return null;
  if (params.openOrdersCount > 0) return null;
  if (hasOpenPlannerPosition(params.plannerPosition)) return null;

  if ((params.reconciliationResult?.drifts ?? []).some((row) => row.kind === "live_open_missing_local")) {
    return "grid_restart_live_orders_reconciliation_required";
  }
  if ((params.reconciliationResult?.newFills.length ?? 0) > 0) {
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

export function normalizeGridOrderIntentForVenueConstraints(params: {
  plannerIntent: GridPlannerIntent;
  minQty: number | null;
  qtyStep: number | null;
  minNotional: number | null;
}): GridPlannerIntent | null {
  if (params.plannerIntent.type !== "place_order" && params.plannerIntent.type !== "replace_order") {
    return params.plannerIntent;
  }
  const qty = Number(params.plannerIntent.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const price = Number(params.plannerIntent.price ?? NaN);
  const minNotional = Number(params.minNotional ?? NaN);
  const nextQty = resolveRequiredQtyForVenueMinimums({
    qty,
    price,
    minQty: params.minQty,
    qtyStep: params.qtyStep,
    minNotional: params.plannerIntent.reduceOnly === true ? null : params.minNotional
  });
  if (!Number.isFinite(nextQty) || nextQty <= 0) return null;

  if (
    params.plannerIntent.reduceOnly !== true
    && Number.isFinite(price)
    && price > 0
    && Number.isFinite(minNotional)
    && minNotional > 0
    && nextQty * price + 1e-9 < minNotional
  ) {
    return null;
  }

  return {
    ...params.plannerIntent,
    qty: nextQty
  };
}

export function stabilizeHyperliquidVaultGridIntents(params: {
  intents: GridPlannerIntent[];
  isHyperliquidVault: boolean;
  botVaultState: string;
  hasFreshGridFills: boolean;
  openOrders: Array<{
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
}): GridPlannerIntent[] {
  if (!params.isHyperliquidVault || params.botVaultState !== "active" || params.hasFreshGridFills) {
    return params.intents;
  }

  const stableOpenClientOrderIds = new Set(
    params.openOrders
      .map((row) => String(row.clientOrderId ?? "").trim())
      .filter(Boolean)
  );
  const stableOpenExchangeOrderIds = new Set(
    params.openOrders
      .map((row) => String(row.exchangeOrderId ?? "").trim())
      .filter(Boolean)
  );

  return params.intents.filter((intent) => {
    if (intent.type === "set_protection") return true;
    if (intent.type === "cancel_order" || intent.type === "replace_order") return false;
    if (intent.type !== "place_order") return true;
    if (stableOpenClientOrderIds.size === 0 && stableOpenExchangeOrderIds.size === 0) return true;

    const clientOrderId = String(intent.clientOrderId ?? "").trim();
    const exchangeOrderId = String(intent.exchangeOrderId ?? "").trim();
    if (clientOrderId && stableOpenClientOrderIds.has(clientOrderId)) return false;
    if (exchangeOrderId && stableOpenExchangeOrderIds.has(exchangeOrderId)) return false;
    return true;
  });
}

export function findBlockingPendingGridCancel(params: {
  plannerIntent: GridPlannerIntent;
  pendingExecutions: Array<{
    actionType?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
}): {
  clientOrderId: string | null;
  exchangeOrderId: string | null;
} | null {
  const targetClientOrderId = String(params.plannerIntent.clientOrderId ?? "").trim();
  const targetExchangeOrderId = String(params.plannerIntent.exchangeOrderId ?? "").trim();
  for (const pending of params.pendingExecutions) {
    if (String(pending.actionType ?? "").trim().toLowerCase() !== "cancel_order") continue;
    const pendingClientOrderId = String(pending.clientOrderId ?? "").trim();
    const pendingExchangeOrderId = String(pending.exchangeOrderId ?? "").trim();
    if (
      (targetClientOrderId && pendingClientOrderId === targetClientOrderId)
      || (targetExchangeOrderId && pendingExchangeOrderId === targetExchangeOrderId)
    ) {
      return {
        clientOrderId: pendingClientOrderId || null,
        exchangeOrderId: pendingExchangeOrderId || null
      };
    }
  }
  return null;
}

function parseGridClientOrderIdForRecovery(instanceId: string, clientOrderId: string): {
  gridLeg: "long" | "short";
  gridIndex: number;
} | null {
  const match = new RegExp(`^grid-${instanceId}-(long|short)-(\\d+)$`).exec(String(clientOrderId ?? "").trim());
  if (!match) return null;
  const gridIndex = Number(match[2]);
  if (!Number.isFinite(gridIndex) || gridIndex < 0) return null;
  return {
    gridLeg: match[1] === "short" ? "short" : "long",
    gridIndex: Math.trunc(gridIndex)
  };
}

function toPlannerPosition(tradeState: Awaited<ReturnType<typeof loadBotTradeState>>) {
  if (!tradeState.openSide || !Number.isFinite(Number(tradeState.openQty)) || Number(tradeState.openQty) <= 0) {
    return null;
  }
  return {
    side: tradeState.openSide,
    qty: Number(tradeState.openQty),
    entryPrice: Number.isFinite(Number(tradeState.openEntryPrice)) ? Number(tradeState.openEntryPrice) : null
  };
}

function shouldAllowGridMaintenanceEntriesUnderMinInvestmentGate(params: {
  currentStateJson: Record<string, unknown>;
  hasOpenPosition: boolean;
  openOrdersCount: number;
}): boolean {
  if (!params.hasOpenPosition) return false;
  if (params.openOrdersCount > 0) return true;
  return params.currentStateJson.initialSeedExecuted === true;
}

export function filterGridIntentsForRiskGate(params: {
  intents: GridPlannerIntent[];
  currentStateJson: Record<string, unknown>;
  openOrdersCount: number;
  hasOpenPosition: boolean;
  entryBlockedByLiq: boolean;
  entryBlockedByMinInvestment: boolean;
  autoMarginRiskBlocked: boolean;
}): GridPlannerIntent[] {
  const riskBlockingActive =
    params.entryBlockedByLiq
    || params.entryBlockedByMinInvestment
    || params.autoMarginRiskBlocked;
  if (!riskBlockingActive) return params.intents;

  const allowMaintenanceEntries =
    !params.entryBlockedByLiq
    && !params.autoMarginRiskBlocked
    && params.entryBlockedByMinInvestment
    && shouldAllowGridMaintenanceEntriesUnderMinInvestmentGate({
      currentStateJson: params.currentStateJson,
      hasOpenPosition: params.hasOpenPosition,
      openOrdersCount: params.openOrdersCount
    });

  return params.intents.filter((intent) => {
    if (intent.type === "cancel_order" || intent.type === "set_protection") return true;
    if (intent.reduceOnly === true && params.hasOpenPosition) return true;
    if (!allowMaintenanceEntries) return false;
    return intent.type === "place_order" || intent.type === "replace_order";
  });
}

async function syncGridTradeStateWithPlannerPosition(params: {
  botId: string;
  symbol: string;
  now: Date;
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  plannerPosition: PlannerPositionSnapshot;
}): Promise<Awaited<ReturnType<typeof loadBotTradeState>>> {
  const plannerPosition = params.plannerPosition;
  const nextOpenSide =
    plannerPosition && plannerPosition.side === "short"
      ? "short"
      : plannerPosition && plannerPosition.side === "long"
        ? "long"
        : null;
  const nextOpenQty =
    plannerPosition && Number.isFinite(Number(plannerPosition.qty)) && Number(plannerPosition.qty) > 0
      ? Number(plannerPosition.qty)
      : null;
  const nextOpenEntryPrice =
    plannerPosition && Number.isFinite(Number(plannerPosition.entryPrice))
      ? Number(plannerPosition.entryPrice)
      : null;
  const currentOpenTs = params.tradeState.openTs ?? null;
  const nextOpenTs = nextOpenSide ? (currentOpenTs ?? params.now) : null;
  const unchanged =
    params.tradeState.openSide === nextOpenSide
    && (params.tradeState.openQty ?? null) === nextOpenQty
    && (params.tradeState.openEntryPrice ?? null) === nextOpenEntryPrice
    && (currentOpenTs?.toISOString() ?? null) === (nextOpenTs?.toISOString() ?? null);
  if (unchanged) return params.tradeState;

  await upsertBotTradeState({
    botId: params.botId,
    symbol: params.symbol,
    dailyResetUtc: params.tradeState.dailyResetUtc,
    dailyTradeCount: params.tradeState.dailyTradeCount,
    openSide: nextOpenSide,
    openQty: nextOpenQty,
    openEntryPrice: nextOpenEntryPrice,
    openTs: nextOpenTs
  });
  return {
    ...params.tradeState,
    openSide: nextOpenSide,
    openQty: nextOpenQty,
    openEntryPrice: nextOpenEntryPrice,
    openTs: nextOpenTs
  };
}

async function toPlannerPositionFromPaper(params: {
  exchangeAccountId: string;
  symbol: string;
}): Promise<{
  side?: "long" | "short" | null;
  qty?: number | null;
  entryPrice?: number | null;
} | null> {
  const rows = await listPaperPositionsForRunner({
    exchangeAccountId: params.exchangeAccountId,
    symbol: params.symbol
  });
  const row = rows[0];
  if (!row) return null;
  if (!Number.isFinite(Number(row.size)) || Number(row.size) <= 0) return null;
  return {
    side: row.side === "short" ? "short" : "long",
    qty: Number(row.size),
    entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null
  };
}

async function toPlannerPositionFromAdapter(params: {
  adapter: SupportedFuturesAdapter;
  symbol: string;
}): Promise<{
  side?: "long" | "short" | null;
  qty?: number | null;
  entryPrice?: number | null;
} | null> {
  const positions = await params.adapter.getPositions();
  const row = positions.find((entry: any) =>
    normalizeComparableSymbol(String(entry?.symbol ?? "")) === normalizeComparableSymbol(params.symbol)
    && Number(entry?.size ?? 0) > 0
  );
  if (!row) return null;
  const qty = Number(row.size ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return {
    side: String(row.side ?? "").trim().toLowerCase() === "short" ? "short" : "long",
    qty,
    entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null
  };
}

async function resolveExchangeSymbolForDiagnostics(
  adapter: SupportedFuturesAdapter | null,
  symbol: string
): Promise<string | null> {
  if (!adapter) return null;
  const adapterAny = adapter as any;
  if (typeof adapterAny.toExchangeSymbol !== "function") return symbol;
  try {
    return await adapterAny.toExchangeSymbol(symbol);
  } catch {
    return null;
  }
}

type PlannerPositionSnapshot = {
  side?: "long" | "short" | null;
  qty?: number | null;
  entryPrice?: number | null;
} | null;

export async function resolvePlannerPositionForExecution(params: {
  adapter: SupportedFuturesAdapter | null;
  symbol: string;
  executionExchange: string;
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  openOrdersCount: number;
  currentStateJson: Record<string, unknown>;
}): Promise<{
  position: PlannerPositionSnapshot;
  source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
  degraded: boolean;
  readError: string | null;
}> {
  const tradeStatePosition = toPlannerPosition(params.tradeState);
  if (params.executionExchange === "paper") {
    throw new Error("paper_planner_position_requires_exchange_account_context");
  }
  if (!params.adapter) {
    return {
      position: tradeStatePosition,
      source: "trade_state",
      degraded: false,
      readError: null
    };
  }
  try {
    return {
      position: await toPlannerPositionFromAdapter({
        adapter: params.adapter,
        symbol: params.symbol
      }),
      source: "adapter",
      degraded: false,
      readError: null
    };
  } catch (error) {
    const isFreshHyperliquidBootstrap =
      params.executionExchange === "hyperliquid"
      && params.openOrdersCount === 0
      && params.currentStateJson.initialSeedExecuted !== true
      && params.currentStateJson.initialSeedNeedsReseed !== true
      && !hasOpenPlannerPosition(tradeStatePosition);
    if (!isFreshHyperliquidBootstrap) {
      throw error;
    }
    return {
      position: tradeStatePosition,
      source: tradeStatePosition ? "trade_state_fallback" : "empty_hyperliquid_bootstrap_fallback",
      degraded: true,
      readError: String(error)
    };
  }
}

function toOrderIntentFromPlanner(
  botSymbol: string,
  plannerIntent: GridPlannerIntent
): Extract<TradeIntent, { type: "open" }> | null {
  if (plannerIntent.type !== "place_order" && plannerIntent.type !== "replace_order") return null;
  const side = plannerIntent.side === "sell" ? "short" : "long";
  const qty = Number(plannerIntent.qty ?? NaN);
  const price = Number(plannerIntent.price ?? NaN);
  const orderType: "market" | "limit" = Number.isFinite(price) && price > 0 ? "limit" : "market";

  return {
    type: "open",
    symbol: botSymbol,
    side,
    order: {
      type: orderType,
      qty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      reduceOnly: plannerIntent.reduceOnly === true
    }
  };
}

async function executeMappedIntentViaAdapter(params: {
  adapter: SupportedFuturesAdapter;
  botSymbol: string;
  intent: Extract<TradeIntent, { type: "open" }>;
  clientOrderId?: string | null;
}): Promise<PlaceOrderResult> {
  const order = params.intent.order ?? {};
  const qty = Number(order.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("grid_adapter_fallback_invalid_qty");
  }

  const adapterAny = params.adapter as any;
  const canonicalSymbol = typeof adapterAny.toCanonicalSymbol === "function"
    ? (adapterAny.toCanonicalSymbol(params.botSymbol) ?? params.botSymbol)
    : params.botSymbol;
  const orderType: "market" | "limit" = order.type === "limit" ? "limit" : "market";
  const price = Number(order.price ?? NaN);
  const takeProfitPrice = toPositiveNumberOrNull(order.takeProfitPrice);
  const stopLossPrice = toPositiveNumberOrNull(order.stopLossPrice);

  return params.adapter.placeOrder({
    symbol: canonicalSymbol,
    side: params.intent.side === "long" ? "buy" : "sell",
    type: orderType,
    qty,
    clientOrderId: String(params.clientOrderId ?? "").trim() || undefined,
    price: orderType === "limit" && Number.isFinite(price) && price > 0 ? price : undefined,
    reduceOnly: order.reduceOnly === true,
    marginMode: "cross",
    takeProfitPrice: takeProfitPrice ?? undefined,
    stopLossPrice: stopLossPrice ?? undefined
  });
}

export async function applyGridProtectionIntent(params: {
  executionExchange: string;
  adapter: SupportedFuturesAdapter | null;
  exchangeAccountId: string;
  botSymbol: string;
  plannerIntent: GridPlannerIntent;
}): Promise<{
  status: "executed" | "blocked" | "noop";
  reason: string;
  metadata?: Record<string, unknown>;
}> {
  const takeProfitPrice = toPositiveNumberOrNull(params.plannerIntent.tpPrice);
  const stopLossPrice = toPositiveNumberOrNull(params.plannerIntent.slPrice);
  if (takeProfitPrice === null && stopLossPrice === null) {
    return {
      status: "noop",
      reason: "grid_set_protection_empty"
    };
  }

  let position: PlannerPositionSnapshot;
  if (params.executionExchange === "paper") {
    position = await toPlannerPositionFromPaper({
      exchangeAccountId: params.exchangeAccountId,
      symbol: params.botSymbol
    });
  } else if (params.adapter) {
    position = await toPlannerPositionFromAdapter({
      adapter: params.adapter,
      symbol: params.botSymbol
    });
  } else {
    return {
      status: "blocked",
      reason: "grid_set_protection_adapter_unavailable"
    };
  }

  if (!hasOpenPlannerPosition(position)) {
    return {
      status: "noop",
      reason: "grid_set_protection_no_position"
    };
  }

  if (params.executionExchange === "paper") {
    const updated = await setPaperPositionProtectionForRunner({
      exchangeAccountId: params.exchangeAccountId,
      symbol: params.botSymbol,
      side: position?.side === "short" ? "short" : "long",
      takeProfitPrice,
      stopLossPrice
    });
    return updated.updated
      ? {
          status: "executed",
          reason: "grid_paper_protection_set"
        }
      : {
          status: "noop",
          reason: "grid_set_protection_no_position"
        };
  }

  if (!params.adapter) {
    return {
      status: "blocked",
      reason: "grid_set_protection_adapter_unavailable"
    };
  }
  const adapterWithProtection = params.adapter as SupportedFuturesAdapter & {
    setPositionTpSl?: (params: {
      symbol: string;
      side: "long" | "short";
      takeProfitPrice?: number;
      stopLossPrice?: number;
    }) => Promise<{ ok: true }>;
  };
  if (typeof adapterWithProtection.setPositionTpSl !== "function") {
    return {
      status: "blocked",
      reason: `grid_set_protection_unsupported_exchange:${params.executionExchange}`,
      metadata: {
        exchange: params.executionExchange,
        supportCode: "set_position_tp_sl_unsupported"
      }
    };
  }

  await adapterWithProtection.setPositionTpSl({
    symbol: params.botSymbol,
    side: position?.side === "short" ? "short" : "long",
    takeProfitPrice: takeProfitPrice ?? undefined,
    stopLossPrice: stopLossPrice ?? undefined
  });
  return {
    status: "executed",
    reason: "grid_adapter_protection_set"
  };
}

async function writeBotOrderDualWrite(params: {
  botVaultId?: string | null;
  exchange: string;
  symbol: string;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean;
  status?: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (!params.botVaultId) return;
  const qty = Number(params.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return;
  await upsertBotOrderEntry({
    botVaultId: params.botVaultId,
    exchange: params.exchange,
    symbol: params.symbol,
    side: params.side === "sell" ? "SELL" : "BUY",
    orderType: params.orderType === "market" ? "MARKET" : "LIMIT",
    status: params.status ?? "OPEN",
    clientOrderId: params.clientOrderId,
    exchangeOrderId: params.exchangeOrderId,
    price: params.price ?? null,
    qty,
    reduceOnly: params.reduceOnly === true,
    metadata: params.metadata ?? null
  });
}

export function summarizeGridDelegatedResults(delegatedResults: ExecutionResult[]): {
  executedResults: ExecutionResult[];
  blockedResults: ExecutionResult[];
  protectionBlockedResults: ExecutionResult[];
  blockingResult: ExecutionResult | null;
} {
  const executedResults = delegatedResults.filter((entry) => entry.status === "executed");
  const blockedResults = delegatedResults.filter((entry) => entry.status === "blocked");
  const protectionBlockedResults = blockedResults.filter((entry) => entry.reason.startsWith("grid_set_protection_"));
  const nonProtectionBlocked = blockedResults.find((entry) => !entry.reason.startsWith("grid_set_protection_")) ?? null;
  const blockingResult =
    nonProtectionBlocked
    ?? (executedResults.length === 0 ? (blockedResults[0] ?? null) : null);
  return {
    executedResults,
    blockedResults,
    protectionBlockedResults,
    blockingResult
  };
}

async function cancelGridOpenOrdersBestEffort(params: {
  adapter: SupportedFuturesAdapter | null;
  openOrders: Array<{ exchangeOrderId?: string | null; clientOrderId?: string | null }>;
  botSymbol: string;
}): Promise<{ canceled: number; failed: number }> {
  if (!params.adapter) return { canceled: 0, failed: 0 };
  let canceled = 0;
  let failed = 0;
  for (const row of params.openOrders) {
    const exchangeOrderId = String(row.exchangeOrderId ?? "").trim();
    if (!exchangeOrderId) continue;
    try {
      const adapterAny = params.adapter as any;
      if (typeof adapterAny.cancelOrderByParams === "function") {
        await adapterAny.cancelOrderByParams({
          orderId: exchangeOrderId,
          symbol: params.botSymbol
        });
      } else {
        await params.adapter.cancelOrder(exchangeOrderId);
      }
      canceled += 1;
    } catch {
      failed += 1;
    }
  }
  return { canceled, failed };
}

async function closeGridResidualPositionBestEffort(params: {
  executionExchange: string;
  adapter: SupportedFuturesAdapter | null;
  exchangeAccountId: string;
  botSymbol: string;
  markPrice: number;
  paperMarketDataVenue?: string | null;
}): Promise<NormalizedCloseOutcome> {
  if (params.executionExchange === "paper") {
    try {
      const closed = await closePaperPositionForRunner({
        exchangeAccountId: params.exchangeAccountId,
        symbol: params.botSymbol,
        fillPrice: params.markPrice
      });
      return createNormalizedCloseOutcome({
        closed: Boolean(closed?.orderId) && Number(closed?.closedQty ?? 0) > 0,
        reason: null,
        source: "paper",
        orderId: closed?.orderId ?? null,
        closedQty: Number.isFinite(Number(closed?.closedQty)) ? Number(closed?.closedQty) : null,
        metadata: buildExecutionVenueMeta({
          executionVenue: "paper",
          marketDataVenue: params.paperMarketDataVenue ?? null
        })
      });
    } catch (error) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: String(error),
        source: "paper",
        metadata: buildExecutionVenueMeta({
          executionVenue: "paper",
          marketDataVenue: params.paperMarketDataVenue ?? null
        })
      });
    }
  }
  if (!params.adapter) {
    return createNormalizedCloseOutcome({
      closed: false,
      reason: "adapter_unavailable",
      source: "venue",
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  }
  try {
    const positions = await params.adapter.getPositions();
    const target = positions.find((row: any) => {
      const symbol = normalizeComparableSymbol(String(row?.symbol ?? ""));
      return symbol === normalizeComparableSymbol(params.botSymbol) && Number(row?.size ?? 0) > 0;
    });
    if (!target) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: null,
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    const qty = Number(target.size ?? NaN);
    if (!Number.isFinite(qty) || qty <= 0) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: "invalid_position_qty",
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    const sideRaw = String(target.side ?? "").trim().toLowerCase();
    const closeSide: "buy" | "sell" = sideRaw === "long" ? "sell" : "buy";
    await params.adapter.placeOrder({
      symbol: params.botSymbol,
      side: closeSide,
      type: "market",
      qty,
      reduceOnly: true,
      marginMode: "cross"
    });
    return createNormalizedCloseOutcome({
      closed: true,
      reason: null,
      source: "venue",
      closedQty: qty,
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  } catch (error) {
    if (isNoPositionToCloseError(error)) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: null,
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    return createNormalizedCloseOutcome({
      closed: false,
      reason: String(error),
      source: "venue",
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  }
}

function mergeMetrics(
  base: Record<string, unknown>,
  delta: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...base,
    ...delta,
    updatedAt: new Date().toISOString()
  };
}

function toFinitePositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function buildExecutedGridInitialSeedMetrics(params: {
  seedSide: string | null | undefined;
  seedQty: number;
  seedNotionalUsd: number;
  seedMarginUsd: number;
  seedPct: number;
  seedPrice?: number | null;
}): Record<string, unknown> {
  const seedSide = String(params.seedSide ?? "").trim().toLowerCase();
  const seedQty = Number(Number(params.seedQty ?? 0).toFixed(8));
  const seedNotionalUsd = Number(Number(params.seedNotionalUsd ?? 0).toFixed(8));
  const seedMarginUsd = Number(Number(params.seedMarginUsd ?? 0).toFixed(8));
  const seedPct = Number(Number(params.seedPct ?? 0).toFixed(8));
  const seedPrice = toFinitePositiveNumberOrNull(params.seedPrice);

  const initialSeed: Record<string, unknown> = {
    enabled: true,
    seedSide,
    seedQty,
    seedNotionalUsd,
    seedMarginUsd,
    seedPct
  };
  if (seedPrice !== null) {
    initialSeed.seedPrice = Number(seedPrice.toFixed(8));
  }

  return {
    initialSeed,
    initialSeedExecuted: true,
    initialSeedPending: false,
    initialSeedQty: seedQty,
    initialSeedSide: seedSide,
    initialSeedPct: seedPct,
    initialSeedNotionalUsd: seedNotionalUsd,
    initialSeedMarginUsd: seedMarginUsd,
    ...(seedPrice !== null ? { initialSeedPrice: Number(seedPrice.toFixed(8)) } : {})
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function withGridHealthState(
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

function summarizeSeedPositions(
  positions: Array<Record<string, unknown>>,
  symbol: string
): Record<string, unknown> {
  const normalizedSymbol = normalizeComparableSymbol(symbol);
  const matching = positions.filter((row) =>
    normalizeComparableSymbol(String(row.symbol ?? "")) === normalizedSymbol
  );
  return {
    totalCount: positions.length,
    matchingCount: matching.length,
    matching: matching.slice(0, 5).map((row) => ({
      symbol: String(row.symbol ?? ""),
      side: String(row.side ?? ""),
      size: Number(row.size ?? NaN),
      entryPrice: Number.isFinite(Number(row.entryPrice ?? NaN)) ? Number(row.entryPrice) : null,
      unrealizedPnl: Number.isFinite(Number(row.unrealizedPnl ?? NaN)) ? Number(row.unrealizedPnl) : null
    }))
  };
}

function summarizeSeedOpenOrders(
  openOrders: Array<Record<string, unknown>>,
  symbol: string
): Record<string, unknown> {
  const normalizedSymbol = normalizeComparableSymbol(symbol);
  const matching = openOrders.filter((row) =>
    normalizeComparableSymbol(String(row.symbol ?? "")) === normalizedSymbol
  );
  return {
    totalCount: openOrders.length,
    matchingCount: matching.length,
    matching: matching.slice(0, 8).map((row) => ({
      symbol: String(row.symbol ?? ""),
      orderId: String(row.orderId ?? ""),
      clientOrderId: String(row.clientOrderId ?? ""),
      side: String(row.side ?? ""),
      type: String(row.type ?? ""),
      status: String(row.status ?? ""),
      reduceOnly: row.reduceOnly === true,
      qty: Number.isFinite(Number(row.qty ?? NaN)) ? Number(row.qty) : null,
      price: Number.isFinite(Number(row.price ?? NaN)) ? Number(row.price) : null
    }))
  };
}

function summarizeSeedRecentFills(
  fills: Array<Record<string, unknown>>,
  symbol: string
): Record<string, unknown> {
  const normalizedSymbol = normalizeComparableSymbol(symbol);
  const matching = fills.filter((row) =>
    normalizeComparableSymbol(String(row.symbol ?? row.coin ?? row.asset ?? "")) === normalizedSymbol
  );
  return {
    totalCount: fills.length,
    matchingCount: matching.length,
    matching: matching.slice(0, 8).map((row) => ({
      fillId: String(row.tid ?? row.fillId ?? row.tradeId ?? ""),
      orderId: String(row.oid ?? row.orderId ?? ""),
      clientOrderId: String(row.clientOid ?? row.clientOrderId ?? ""),
      side: String(row.side ?? ""),
      qty: Number.isFinite(Number(row.sz ?? row.qty ?? NaN)) ? Number(row.sz ?? row.qty) : null,
      price: Number.isFinite(Number(row.px ?? row.price ?? NaN)) ? Number(row.px ?? row.price) : null,
      filledAt:
        Number.isFinite(Number(row.time ?? row.timestamp ?? NaN))
          ? new Date(Number(row.time ?? row.timestamp)).toISOString()
          : String(row.filledAt ?? row.createdAt ?? "")
    }))
  };
}

function summarizeSeedAccountState(accountState: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!accountState) return null;
  return {
    equity: Number.isFinite(Number(accountState.equity ?? NaN)) ? Number(accountState.equity) : null,
    availableMargin: Number.isFinite(Number(accountState.availableMargin ?? NaN))
      ? Number(accountState.availableMargin)
      : null,
    marginMode: accountState.marginMode ?? null
  };
}

async function collectInitialSeedDiagnostics(params: {
  adapter: SupportedFuturesAdapter | null;
  symbol: string;
  executionExchange: string;
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  openOrdersCount: number;
  currentStateJson: Record<string, unknown>;
  now: Date;
  submitResult?: PlaceOrderResult | null;
  orderRequest?: Record<string, unknown> | null;
  priceSource?: string | null;
  stage: "submitted" | "confirmation_pending";
}): Promise<Record<string, unknown>> {
  const diagnostics: Record<string, unknown> = {
    stage: params.stage,
    capturedAt: params.now.toISOString(),
    exchange: params.executionExchange,
    symbol: params.symbol,
    openOrdersCountBeforePlan: params.openOrdersCount
  };
  if (params.submitResult) {
    diagnostics.submitResult = {
      status: params.submitResult.status,
      orderId: typeof params.submitResult.orderId === "string" ? params.submitResult.orderId : undefined,
      candidateOrderId:
        typeof params.submitResult.candidateOrderId === "string" ? params.submitResult.candidateOrderId : undefined,
      txHash: typeof params.submitResult.txHash === "string" ? params.submitResult.txHash : undefined
    };
  }
  if (params.orderRequest) diagnostics.orderRequest = params.orderRequest;
  if (params.priceSource) diagnostics.priceSource = params.priceSource;
  const adapter = params.adapter;
  if (!adapter) return diagnostics;

  const exchangeSymbol = await resolveExchangeSymbolForDiagnostics(adapter, params.symbol).catch((error) => {
    diagnostics.exchangeSymbolReadError = String(error);
    return null;
  });
  diagnostics.exchangeSymbol = exchangeSymbol;

  const positions = await adapter.getPositions().catch((error) => {
    diagnostics.positionsReadError = String(error);
    return null;
  });
  if (positions) {
    diagnostics.positions = summarizeSeedPositions(
      positions.map((row: unknown) => asRecord(row) ?? {}),
      params.symbol
    );
  }

  const adapterAny = adapter as any;
  if (typeof adapterAny.listOpenOrders === "function") {
    const venueOpenOrders = await adapterAny.listOpenOrders({ symbol: params.symbol }).catch((error: unknown) => {
      diagnostics.openOrdersReadError = String(error);
      return null;
    });
    if (venueOpenOrders) {
      diagnostics.venueOpenOrders = summarizeSeedOpenOrders(
        venueOpenOrders.map((row: unknown) => asRecord(row) ?? {}),
        params.symbol
      );
    }
  }

  const recentFillsReader =
    typeof adapterAny.getRecentFills === "function"
      ? () => adapterAny.getRecentFills({ symbol: params.symbol, limit: 50 })
      : adapterAny.tradeApi && typeof adapterAny.tradeApi.getFills === "function"
        ? () => adapterAny.tradeApi.getFills({ symbol: params.symbol, limit: 50 })
        : null;
  if (recentFillsReader) {
    const recentFills = await recentFillsReader().catch((error: unknown) => {
      diagnostics.recentFillsReadError = String(error);
      return null;
    });
    if (Array.isArray(recentFills)) {
      diagnostics.recentFills = summarizeSeedRecentFills(
        recentFills.map((row: unknown) => asRecord(row) ?? {}),
        params.symbol
      );
    }
  }

  const accountStateReader = typeof adapterAny.getConfiguredAccountState === "function"
    ? () => adapterAny.getConfiguredAccountState()
    : () => adapter.getAccountState();
  const accountState = await accountStateReader().catch((error: unknown) => {
    diagnostics.accountStateReadError = String(error);
    return null;
  });
  diagnostics.accountState = summarizeSeedAccountState(asRecord(accountState));

  const plannerPositionResolution = await resolvePlannerPositionForExecution({
    adapter,
    symbol: params.symbol,
    executionExchange: params.executionExchange,
    tradeState: params.tradeState,
    openOrdersCount: params.openOrdersCount,
    currentStateJson: params.currentStateJson
  }).catch((error) => {
    diagnostics.plannerPositionReadError = String(error);
    return null;
  });
  if (plannerPositionResolution) {
    diagnostics.plannerPosition = plannerPositionResolution.position
      ? {
          side: plannerPositionResolution.position.side ?? null,
          qty: Number.isFinite(Number(plannerPositionResolution.position.qty ?? NaN))
            ? Number(plannerPositionResolution.position.qty)
            : null,
          entryPrice: Number.isFinite(Number(plannerPositionResolution.position.entryPrice ?? NaN))
            ? Number(plannerPositionResolution.position.entryPrice)
            : null
        }
      : null;
    diagnostics.plannerPositionSource = plannerPositionResolution.source;
    diagnostics.plannerPositionDegraded = plannerPositionResolution.degraded;
    if (plannerPositionResolution.readError) {
      diagnostics.plannerPositionAdapterReadError = plannerPositionResolution.readError;
    }
  }

  return diagnostics;
}

function shouldRefreshInitialSeedConfirmationDiagnostics(
  currentStateJson: Record<string, unknown>,
  now: Date,
  minIntervalMs = 45_000
): boolean {
  const previous = String(currentStateJson.initialSeedLastConfirmationCheckAt ?? "").trim();
  if (!previous) return true;
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(previousMs)) return true;
  return now.getTime() - previousMs >= minIntervalMs;
}

function hasPositiveAccountFunding(accountState: {
  equity?: number | null;
  availableMargin?: number | null;
} | null | undefined): boolean {
  const equity = Number(accountState?.equity ?? NaN);
  const availableMargin = Number(accountState?.availableMargin ?? NaN);
  return (Number.isFinite(equity) && equity > 0) || (Number.isFinite(availableMargin) && availableMargin > 0);
}

type VaultBalanceReadMeta = {
  fromCache: boolean;
  stale: boolean;
  degraded: boolean;
  cacheAgeMs: number | null;
  reason: string | null;
};

export type VaultBalanceSnapshot = {
  capturedAt: string;
  equityUsd: number | null;
  availableMarginUsd: number | null;
  coreSpotBalanceUsd: number | null;
  issues: string[];
  usableForSizing: boolean;
  usableForTransfers: boolean;
  reads: {
    account: VaultBalanceReadMeta | null;
    spot: VaultBalanceReadMeta | null;
  };
};

function normalizeVaultBalanceReadMeta(value: {
  fromCache?: boolean;
  stale?: boolean;
  degraded?: boolean;
  cacheAgeMs?: number | null;
  reason?: string | null;
} | null | undefined): VaultBalanceReadMeta | null {
  if (!value) return null;
  return {
    fromCache: value.fromCache === true,
    stale: value.stale === true,
    degraded: value.degraded === true,
    cacheAgeMs: Number.isFinite(Number(value.cacheAgeMs ?? NaN)) ? Number(value.cacheAgeMs) : null,
    reason: String(value.reason ?? "").trim() || null
  };
}

export function buildVaultBalanceSnapshot(params: {
  now: Date;
  accountState?: { equity?: number | null; availableMargin?: number | null } | null;
  coreSpotBalance?: { amountUsd?: number | null } | null;
  accountRead?: VaultBalanceReadMeta | null;
  spotRead?: VaultBalanceReadMeta | null;
  requireSpotBalance?: boolean;
}): VaultBalanceSnapshot {
  const equityUsd = Number.isFinite(Number(params.accountState?.equity ?? NaN))
    ? Number(params.accountState?.equity)
    : null;
  const availableMarginUsd = Number.isFinite(Number(params.accountState?.availableMargin ?? NaN))
    ? Number(params.accountState?.availableMargin)
    : null;
  const coreSpotBalanceUsd = Number.isFinite(Number(params.coreSpotBalance?.amountUsd ?? NaN))
    ? Number(params.coreSpotBalance?.amountUsd)
    : null;
  const accountRead = normalizeVaultBalanceReadMeta(params.accountRead);
  const spotRead = normalizeVaultBalanceReadMeta(params.spotRead);
  const requireSpotBalance = params.requireSpotBalance === true;
  const issues = new Set<string>();

  if (equityUsd !== null && equityUsd < -1e-9) issues.add("negative_equity");
  if (availableMarginUsd !== null && availableMarginUsd < -1e-9) issues.add("negative_available_margin");
  if (coreSpotBalanceUsd !== null && coreSpotBalanceUsd < -1e-9) issues.add("negative_core_spot_balance");
  if (
    equityUsd !== null
    && availableMarginUsd !== null
    && availableMarginUsd > equityUsd + Math.max(0.01, Math.abs(equityUsd) * 0.02)
  ) {
    issues.add("available_margin_exceeds_equity");
  }
  if (accountRead?.stale || accountRead?.degraded) issues.add("account_state_not_fresh");
  if (requireSpotBalance && (spotRead?.stale || spotRead?.degraded)) issues.add("spot_balance_not_fresh");
  if (equityUsd === null && availableMarginUsd === null) issues.add("account_state_unavailable");
  if (requireSpotBalance && coreSpotBalanceUsd === null) issues.add("spot_balance_unavailable");

  return {
    capturedAt: params.now.toISOString(),
    equityUsd,
    availableMarginUsd,
    coreSpotBalanceUsd,
    issues: [...issues],
    usableForSizing: issues.size === 0,
    usableForTransfers:
      !issues.has("negative_equity")
      && !issues.has("negative_available_margin")
      && !issues.has("negative_core_spot_balance")
      && !issues.has("available_margin_exceeds_equity")
      && !issues.has("account_state_not_fresh")
      && !issues.has("spot_balance_not_fresh")
      && !issues.has("account_state_unavailable")
      && (!requireSpotBalance || !issues.has("spot_balance_unavailable")),
    reads: {
      account: accountRead,
      spot: spotRead
    }
  };
}

async function readVaultBalanceSnapshot(params: {
  adapter: SupportedFuturesAdapter;
  cacheIdentity: string;
  symbol: string;
  now: Date;
  requireSpotBalance?: boolean;
}): Promise<VaultBalanceSnapshot> {
  const adapterAny = params.adapter as any;
  const accountStateReader =
    typeof adapterAny.getConfiguredAccountState === "function"
      ? () => adapterAny.getConfiguredAccountState()
      : () => params.adapter.getAccountState();
  const accountRead = await executeHyperliquidRead({
    key: buildHyperliquidReadKey({
      scope: "runner-vault-balance",
      identity: params.cacheIdentity,
      endpoint: "configured-account",
      symbol: params.symbol
    }),
    ttlMs: 2_500,
    staleMs: 15_000,
    cooldownMs: 10_000,
    retryAttempts: 2,
    retryBaseDelayMs: 150,
    read: accountStateReader
  }).catch((error) => ({
    value: null,
    fromCache: false,
    stale: false,
    degraded: true,
    rateLimited: false,
    cacheAgeMs: null,
    category: null,
    reason: String(error),
    retryCount: 0
  }));
  const shouldReadSpotBalance =
    params.requireSpotBalance === true
    || typeof adapterAny.getCoreUsdcSpotBalance === "function";
  const spotRead = shouldReadSpotBalance && typeof adapterAny.getCoreUsdcSpotBalance === "function"
    ? await executeHyperliquidRead({
        key: buildHyperliquidReadKey({
          scope: "runner-vault-balance",
          identity: params.cacheIdentity,
          endpoint: "core-spot-usdc",
          symbol: "USDC"
        }),
        ttlMs: 2_500,
        staleMs: 15_000,
        cooldownMs: 10_000,
        retryAttempts: 2,
        retryBaseDelayMs: 150,
        read: () => adapterAny.getCoreUsdcSpotBalance()
      }).catch((error) => ({
        value: null,
        fromCache: false,
        stale: false,
        degraded: true,
        rateLimited: false,
        cacheAgeMs: null,
        category: null,
        reason: String(error),
        retryCount: 0
      }))
    : null;

  return buildVaultBalanceSnapshot({
    now: params.now,
    accountState: accountRead.value as { equity?: number | null; availableMargin?: number | null } | null,
    coreSpotBalance: spotRead?.value as { amountUsd?: number | null } | null,
    accountRead,
    spotRead,
    requireSpotBalance: params.requireSpotBalance === true
  });
}

function readInitialPerpTransferAmountUsd(bot: Parameters<ExecutionMode["execute"]>[1]["bot"]): number {
  const allocatedUsd = Number(bot.botVaultExecution?.allocatedUsd ?? NaN);
  if (Number.isFinite(allocatedUsd) && allocatedUsd > 0) return allocatedUsd;
  const principalAllocated = Number(bot.botVaultExecution?.principalAllocated ?? NaN);
  if (Number.isFinite(principalAllocated) && principalAllocated > 0) return principalAllocated;
  return 0;
}

function readEnvNumber(name: string, fallback: number, min?: number, max?: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function readSupportedAutoMarginExchanges(): Set<string> {
  const raw = String(process.env.GRID_AUTO_MARGIN_SUPPORTED_EXCHANGES ?? "hyperliquid");
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["hyperliquid"]);
}

function normalizeExecutionMarginMode(value: unknown): "cross" | "isolated" {
  return String(value ?? "").trim().toLowerCase() === "isolated" ? "isolated" : "cross";
}

export async function ensureGridLeverageConfigured(params: {
  adapter: SupportedFuturesAdapter | null;
  executionExchange: string;
  symbol: string;
  leverage: number;
  marginMode: unknown;
  currentStateJson: Record<string, unknown>;
  now: Date;
}): Promise<{
  stateJson: Record<string, unknown>;
  configured: boolean;
  changed: boolean;
  leverage: number;
  marginMode: "cross" | "isolated";
}> {
  const desiredLeverage = Math.max(1, Math.trunc(Number(params.leverage ?? 1)));
  const desiredMarginMode = normalizeExecutionMarginMode(params.marginMode);
  if (params.executionExchange === "paper" || !params.adapter) {
    return {
      stateJson: params.currentStateJson,
      configured: false,
      changed: false,
      leverage: desiredLeverage,
      marginMode: desiredMarginMode
    };
  }
  const existing = asRecord(params.currentStateJson.exchangeLeverageConfig);
  const existingLeverage = Math.max(0, Math.trunc(Number(existing?.leverage ?? 0)));
  const existingMarginMode = normalizeExecutionMarginMode(existing?.marginMode);
  const existingExchange = String(existing?.exchange ?? "").trim().toLowerCase();
  const existingSymbol = normalizeSymbol(String(existing?.symbol ?? ""));
  if (
    existingExchange === params.executionExchange
    && existingSymbol === normalizeSymbol(params.symbol)
    && existingLeverage === desiredLeverage
    && existingMarginMode === desiredMarginMode
  ) {
    return {
      stateJson: params.currentStateJson,
      configured: true,
      changed: false,
      leverage: desiredLeverage,
      marginMode: desiredMarginMode
    };
  }
  await params.adapter.setLeverage(params.symbol, desiredLeverage, desiredMarginMode);
  return {
    stateJson: {
      ...params.currentStateJson,
      exchangeLeverageConfig: {
        exchange: params.executionExchange,
        symbol: normalizeSymbol(params.symbol),
        leverage: desiredLeverage,
        marginMode: desiredMarginMode,
        configuredAt: params.now.toISOString()
      }
    },
    configured: true,
    changed: true,
    leverage: desiredLeverage,
    marginMode: desiredMarginMode
  };
}

function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

function shouldAllowHyperliquidForGridBot(params: {
  executionExchange?: unknown;
  marketDataVenue?: unknown;
  executionProvider?: unknown;
}): boolean {
  const executionExchange = String(params.executionExchange ?? "").trim().toLowerCase();
  if (executionExchange === "hyperliquid") return true;
  const marketDataVenue = String(params.marketDataVenue ?? "").trim().toLowerCase();
  if (marketDataVenue === "hyperliquid") return true;
  const executionProvider = String(params.executionProvider ?? "").trim().toLowerCase();
  return executionProvider === "hyperliquid" || executionProvider === "hyperliquid_demo";
}

export function resolveAllowedGridExchangesForBot(
  baseAllowedExchanges: Set<string>,
  params: {
    executionExchange?: unknown;
    marketDataVenue?: unknown;
    executionProvider?: unknown;
  }
): Set<string> {
  if (baseAllowedExchanges.has("hyperliquid")) return baseAllowedExchanges;
  if (!shouldAllowHyperliquidForGridBot(params)) return baseAllowedExchanges;
  return new Set([...baseAllowedExchanges, "hyperliquid"]);
}

function isNoPositionToCloseError(error: unknown): boolean {
  return /no position to close/i.test(String(error ?? ""));
}

function mapGridTerminalOutcome(reason: string): "tp_hit" | "sl_hit" | "manual_exit" {
  if (String(reason).includes("sl")) return "sl_hit";
  if (String(reason).includes("tp")) return "tp_hit";
  return "manual_exit";
}

function computeMarginRatio(account: { equity?: number; availableMargin?: number }): number | null {
  const equity = Number(account.equity ?? NaN);
  const available = Number(account.availableMargin ?? NaN);
  if (!Number.isFinite(equity) || equity <= 0) return null;
  if (!Number.isFinite(available)) return null;
  const ratio = 1 - (available / equity);
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(1, ratio));
}

export function resolveInitialPerpFundingAmountUsd(params: {
  requestedAmountUsd: number;
  coreSpotBalanceUsd?: number | null;
}): number {
  const requestedAmountUsd = Number(params.requestedAmountUsd ?? NaN);
  if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) return 0;
  const coreSpotBalanceUsd = Number(params.coreSpotBalanceUsd ?? NaN);
  if (!Number.isFinite(coreSpotBalanceUsd) || coreSpotBalanceUsd <= 0) return requestedAmountUsd;
  return Number(Math.min(requestedAmountUsd, coreSpotBalanceUsd).toFixed(6));
}

export function resolveInitialCoreSpotDepositAmountUsd(params: {
  requestedAmountUsd: number;
  coreSpotBalanceUsd?: number | null;
}): number {
  const requestedAmountUsd = Number(params.requestedAmountUsd ?? NaN);
  if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) return 0;
  const coreSpotBalanceUsd = Number(params.coreSpotBalanceUsd ?? NaN);
  if (Number.isFinite(coreSpotBalanceUsd) && coreSpotBalanceUsd > 0) return 0;
  return Number(requestedAmountUsd.toFixed(6));
}

export function shouldRetryCloseOnlySettlementTransfer(params: {
  recordedAt?: unknown;
  sourceBalanceUsd: number;
  now: Date;
}): boolean {
  const sourceBalanceUsd = Number(params.sourceBalanceUsd ?? NaN);
  if (!Number.isFinite(sourceBalanceUsd) || sourceBalanceUsd <= 0.000001) return false;

  const recordedAtRaw = String(params.recordedAt ?? "").trim();
  if (!recordedAtRaw) return true;

  const recordedAtMs = Date.parse(recordedAtRaw);
  if (!Number.isFinite(recordedAtMs)) return true;
  // A successful settlement transfer must not be auto-resubmitted just because
  // HyperCore/EVM balance views lag behind the confirmed transaction.
  return false;
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
  reason:
    | "bot_vault_v3_ready"
    | "bot_vault_v3_onchain_vault_missing"
    | "bot_vault_v3_execution_blocked"
    | "bot_vault_v3_funding_requested_not_confirmed"
    | "bot_vault_v3_hypercore_funding_not_started"
    | "bot_vault_v3_hypercore_transfer_pending"
    | "bot_vault_v3_hypercore_transfer_not_observed"
    | "bot_vault_v3_hypercore_final_state_unverified"
    | "bot_vault_v3_hypercore_pause_restore_unverified";
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

  if (!vaultAddress) {
    return { ready: false, reason: "bot_vault_v3_onchain_vault_missing", detail: null };
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
      reason: "bot_vault_v3_execution_blocked",
      detail: lifecycleOverrideState || executionStatus || status || String(params.executionLastError ?? "").trim() || null
    };
  }

  if (fundingStatus === "hyper_evm_funding_requested") {
    return { ready: false, reason: "bot_vault_v3_funding_requested_not_confirmed", detail: null };
  }

  if (hypercoreFundingStatus === "funded") {
    if (verificationState && verificationState !== "funding_verified") {
      return {
        ready: false,
        reason: verificationBlockingReason === "paused_restore_unconfirmed"
          ? "bot_vault_v3_hypercore_pause_restore_unverified"
          : "bot_vault_v3_hypercore_final_state_unverified",
        detail: verificationBlockingReason || verificationState || null
      };
    }
    return { ready: true, reason: "bot_vault_v3_ready", detail: null };
  }

  if (hypercoreFundingStatus === "pending") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return { ready: false, reason: "bot_vault_v3_hypercore_pause_restore_unverified", detail: verificationBlockingReason };
    }
    if (
      verificationBlockingReason === "perp_state_read_unavailable"
      || verificationBlockingReason === "final_state_resync_unavailable"
      || verificationState === "transfer_observed"
    ) {
      return { ready: false, reason: "bot_vault_v3_hypercore_final_state_unverified", detail: verificationBlockingReason || verificationState || null };
    }
    if (verificationBlockingReason === "transfer_not_yet_observed" || verificationState === "transfer_submitted") {
      return { ready: false, reason: "bot_vault_v3_hypercore_transfer_not_observed", detail: verificationBlockingReason || verificationState || null };
    }
    return { ready: false, reason: "bot_vault_v3_hypercore_transfer_pending", detail: verificationBlockingReason || verificationState || null };
  }

  if (
    fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || fundingStatus === "deployed"
  ) {
    return { ready: false, reason: "bot_vault_v3_hypercore_funding_not_started", detail: null };
  }

  return { ready: false, reason: "bot_vault_v3_funding_requested_not_confirmed", detail: null };
}

function getOrCreateAdapterForBot(bot: Parameters<ExecutionMode["execute"]>[1]["bot"]): SupportedFuturesAdapter | null {
  const identity = bot.executionIdentity ?? null;
  const exchange = String(identity?.exchange ?? bot.marketData.exchange ?? "").trim().toLowerCase();
  const cacheKey = identity?.cacheScope
    ? `bot_vault:${identity.cacheScope}`
    : `${bot.id}:${bot.marketData.exchangeAccountId}`;
  const adapterCredentials = identity
    ? {
        apiKey: identity.apiKey,
        apiSecret: identity.apiSecret,
        passphrase: identity.passphrase ?? undefined
      }
    : {
        apiKey: bot.marketData.credentials.apiKey,
        apiSecret: bot.marketData.credentials.apiSecret,
        passphrase: bot.marketData.credentials.passphrase ?? undefined
      };
  const isHyperliquidV2Vault =
    exchange === "hyperliquid"
    && String(bot.botVaultExecution?.masterVaultContractVersion ?? "").trim().toLowerCase() === "v2";
  const isHyperliquidV3Vault =
    exchange === "hyperliquid"
    && String(bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3";
  return getOrCreateRunnerFuturesAdapter({
    cacheKey,
    exchange,
    apiKey: adapterCredentials.apiKey,
    apiSecret: adapterCredentials.apiSecret,
    // Hyperliquid vault execution still needs the vault address for reads
    // (open orders, fills, positions). Writes are rerouted via botVaultAddress.
    passphrase: adapterCredentials.passphrase,
    botVaultAddress:
      isHyperliquidV2Vault || isHyperliquidV3Vault
        ? bot.botVaultExecution?.vaultAddress ?? undefined
        : undefined
  });
}

type Dependencies = {
  writeRiskEventFn?: typeof writeRiskEvent;
};

export function createFuturesGridExecutionMode(deps: Dependencies = {}): ExecutionMode {
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;

  return {
    key: "futures_grid",
    async execute(signal, ctx): Promise<ExecutionResult> {
      if (ctx.bot.strategyKey !== "futures_grid") {
        return buildModeNoopResult(signal, "futures_grid_strategy_mismatch", {
          mode: "futures_grid",
          strategyKey: ctx.bot.strategyKey
        });
      }
      const executionExchange = String(ctx.bot.exchange ?? "").trim().toLowerCase();
      const botVaultState = normalizeVaultExecutionState(ctx.bot.botVaultExecution?.status);
      const allowedGridExchanges = resolveAllowedGridExchangesForBot(readAllowedGridExchanges(), {
        executionExchange,
        marketDataVenue: ctx.bot.marketData.exchange,
        executionProvider: ctx.bot.botVaultExecution?.executionProvider ?? ctx.bot.executionIdentity?.providerKey
      });
      if (!allowedGridExchanges.has(executionExchange)) {
        return buildModeBlockedResult(signal, "grid_exchange_not_allowed", {
          mode: "futures_grid",
          exchange: executionExchange,
          allowedExchanges: [...allowedGridExchanges]
        });
      }
      const gate = coerceGateSummary(signal.metadata.gate, defaultGateSummary());
      const paperContext = executionExchange === "paper"
        ? buildRunnerPaperExecutionContext({
            marketType: "perp",
            marketDataExchange: ctx.bot.marketData.exchange,
            marketDataExchangeAccountId: ctx.bot.marketData.exchangeAccountId
          })
        : null;

      if (paperContext && !paperContext.linkedMarketData.supported) {
        return buildModeBlockedResult(signal, paperContext.linkedMarketData.supportCode ?? "paper_perp_requires_supported_market_data", {
          mode: "futures_grid",
          exchange: executionExchange,
          marketDataExchange: paperContext.linkedMarketData.marketDataVenue
        });
      }

      const sharedVenue = buildSharedExecutionVenue({
        executionVenue: executionExchange,
        marketDataVenue: paperContext?.linkedMarketData.marketDataVenue ?? ctx.bot.marketData.exchange,
        paperContext
      });

      async function executeGridAction(params: {
        action: string;
        intent: TradeIntent;
        executionPath: "paper" | "direct_adapter";
        execute: () => Promise<{
          status: "executed" | "blocked" | "noop";
          reason: string;
          orderIds?: string[];
          metadata?: Record<string, unknown>;
        }>;
      }): Promise<ExecutionResult> {
        return executeRunnerSharedExecutionPipeline({
          request: {
            domain: "futures_grid",
            action: params.action,
            symbol: "symbol" in params.intent ? params.intent.symbol : ctx.bot.symbol,
            intent: params.intent,
            venue: sharedVenue,
            capabilityRequirements: [
              { feature: "grid_execution" }
            ],
            metadata: {
              mode: "futures_grid",
              executionPath: params.executionPath,
              preserveReason: true
            }
          },
          intent: params.intent,
          gate,
          execute: params.execute
        });
      }

      const instance = await loadGridBotInstanceByBotId(ctx.bot.id);
      if (!instance) {
        return buildModeBlockedResult(signal, "grid_instance_missing", {
          mode: "futures_grid"
        });
      }

      if (instance.state === "archived") {
        return buildModeNoopResult(signal, "grid_instance_archived", {
          mode: "futures_grid",
          instanceState: instance.state,
          archivedAt: instance.archivedAt?.toISOString?.() ?? null,
          archivedReason: instance.archivedReason ?? null
        });
      }

      if (instance.state === "paused" || instance.state === "stopped") {
        return buildModeNoopResult(signal, "grid_instance_not_running", {
          mode: "futures_grid",
          instanceState: instance.state
        });
      }

      const adapter = getOrCreateAdapterForBot(ctx.bot);
      let markPrice = readMarkPrice(signal);
      let adapterMarkPriceDiagnostic: Awaited<ReturnType<typeof readMarkPriceDiagnosticFromAdapter>> | null = null;
      if ((!markPrice || markPrice <= 0) && adapter) {
        adapterMarkPriceDiagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, ctx.bot.symbol);
        if (adapterMarkPriceDiagnostic.ok) {
          markPrice = adapterMarkPriceDiagnostic.price;
        }
      }
      if ((!markPrice || markPrice <= 0) && paperContext?.linkedMarketData.marketDataVenue === "binance") {
        markPrice = await fetchBinancePerpMarkPrice(ctx.bot.symbol);
      }
      if (!markPrice) {
        const markPriceStateJson = withGridHealthState(asRecord(instance.stateJson) ?? {}, {
          code: "awaiting_market_price",
          severity: "warning",
          reason: "grid_missing_mark_price",
          details: {
            markPriceFallback: paperContext
              ? "binance_perp_fallback_failed"
              : adapter
                ? "adapter_ticker_failed"
                : "adapter_unavailable",
            markPriceDiagnostics: adapterMarkPriceDiagnostic
              ? {
                  symbol: adapterMarkPriceDiagnostic.symbol,
                  exchangeSymbol: adapterMarkPriceDiagnostic.exchangeSymbol,
                  errorCategory: adapterMarkPriceDiagnostic.errorCategory,
                  priceSource: adapterMarkPriceDiagnostic.priceSource,
                  attemptedSources: adapterMarkPriceDiagnostic.attemptedSources,
                  retryCount: adapterMarkPriceDiagnostic.retryCount,
                  staleCacheAgeMs: adapterMarkPriceDiagnostic.staleCacheAgeMs,
                  usedCachedSnapshot: adapterMarkPriceDiagnostic.usedCachedSnapshot
                }
              : null
          },
          now: ctx.now
        });
        await updateGridBotInstancePlannerState({
          instanceId: instance.id,
          state: "running",
          stateJson: markPriceStateJson,
          lastPlanError: "grid_missing_mark_price",
          lastPlanVersion: "python-v1-bootstrap"
        });
        return buildModeNoopResult(signal, "grid_missing_mark_price", {
          mode: "futures_grid",
          markPriceFallback: paperContext
            ? "binance_perp_fallback_failed"
            : adapter
              ? "adapter_ticker_failed"
              : "adapter_unavailable",
          markPriceDiagnostics: adapterMarkPriceDiagnostic
            ? {
                symbol: adapterMarkPriceDiagnostic.symbol,
                exchangeSymbol: adapterMarkPriceDiagnostic.exchangeSymbol,
                errorCategory: adapterMarkPriceDiagnostic.errorCategory,
                priceSource: adapterMarkPriceDiagnostic.priceSource,
                attemptedSources: adapterMarkPriceDiagnostic.attemptedSources,
                retryCount: adapterMarkPriceDiagnostic.retryCount,
                staleCacheAgeMs: adapterMarkPriceDiagnostic.staleCacheAgeMs,
                usedCachedSnapshot: adapterMarkPriceDiagnostic.usedCachedSnapshot,
                endpointFailures: adapterMarkPriceDiagnostic.endpointFailures
              }
            : null
        });
      }

      let currentStateJson = asRecord(instance.stateJson) ?? {};
      let currentMetricsJson = asRecord(instance.metricsJson) ?? {};
      const mergeCurrentMetrics = (delta: Record<string, unknown>): Record<string, unknown> => {
        currentMetricsJson = mergeMetrics(currentMetricsJson, delta);
        return currentMetricsJson;
      };
      const persistCurrentStateJson = async () => {
        await updateGridBotInstancePlannerState({
          instanceId: instance.id,
          stateJson: currentStateJson
        });
      };
      try {
        const leverageConfig = await ensureGridLeverageConfigured({
          adapter,
          executionExchange,
          symbol: ctx.bot.symbol,
          leverage: ctx.bot.leverage,
          marginMode: ctx.bot.marginMode,
          currentStateJson,
          now: ctx.now
        });
        currentStateJson = leverageConfig.stateJson;
        if (leverageConfig.changed) {
          await persistCurrentStateJson();
        }
      } catch (error) {
        const reason = `grid_leverage_configuration_failed:${String(error)}`;
        currentStateJson = {
          ...currentStateJson,
          exchangeLeverageConfig: {
            exchange: executionExchange,
            symbol: normalizeSymbol(ctx.bot.symbol),
            leverage: Math.max(1, Math.trunc(Number(ctx.bot.leverage ?? 1))),
            marginMode: normalizeExecutionMarginMode(ctx.bot.marginMode),
            lastFailedAt: ctx.now.toISOString(),
            lastError: String(error)
          }
        };
        await updateGridBotInstancePlannerState({
          instanceId: instance.id,
          state: "running",
          stateJson: currentStateJson,
          metricsJson: mergeCurrentMetrics({
            positionSnapshot: {
              side: null,
              qty: 0,
              entryPrice: null,
              markPrice
            }
          }),
          lastPlanError: reason,
          lastPlanVersion: "python-v1-bootstrap"
        });
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_BLOCKED",
          message: "grid leverage configuration failed",
          meta: buildGridExecutionMeta({
            stage: "plan_blocked_leverage_configuration",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason,
            error,
            extra: {
              leverage: ctx.bot.leverage,
              marginMode: ctx.bot.marginMode,
              markPrice
            }
          })
        });
        return buildModeBlockedResult(signal, reason, {
          mode: "futures_grid",
          preserveReason: true
        });
      }
      let prePlanFillSyncSummary: Awaited<ReturnType<typeof syncGridFillEvents>> | null = null;
      const isHyperliquidV2Vault =
        executionExchange === "hyperliquid"
        && String(ctx.bot.botVaultExecution?.masterVaultContractVersion ?? "").trim().toLowerCase() === "v2";
      const isHyperliquidV3Vault =
        executionExchange === "hyperliquid"
        && String(ctx.bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3";
      const isHyperliquidOnchainVaultBootstrap =
        executionExchange === "hyperliquid"
        && Boolean(ctx.bot.botVaultExecution?.vaultAddress);
      if (adapter && executionExchange !== "paper") {
        try {
          prePlanFillSyncSummary = await syncGridFillEvents({
            instance,
            bot: ctx.bot,
            adapter
          });
          currentStateJson = recordGridFillSyncRecoveryState({
            stateJson: currentStateJson,
            now: ctx.now,
            summary: prePlanFillSyncSummary
          });
        } catch (error) {
          currentStateJson = recordGridFillSyncRecoveryState({
            stateJson: currentStateJson,
            now: ctx.now,
            error
          });
        }
      }
      let openOrders = await listGridBotOpenOrders(instance.id);
      if (adapter && executionExchange !== "paper" && !isHyperliquidV2Vault) {
        try {
          const maxOrphanResubmitAttempts = readEnvNumber("GRID_MAX_ORPHAN_ORDER_RESUBMITS", 10, 1, 100);
          const venueOpenOrders = await snapshotVenueOrdersForRecovery(adapter);
          const orderRecovery = reconcileGridOpenOrdersAgainstVenue({
            stateJson: currentStateJson,
            now: ctx.now,
            openOrders,
            venueOrders: venueOpenOrders,
            maxOrphanResubmitAttempts
          });
          currentStateJson = orderRecovery.stateJson;
          if (orderRecovery.staleOrders.length > 0) {
            await Promise.allSettled(orderRecovery.staleOrders.map((order) =>
              updateGridBotOrderMapStatus({
                instanceId: instance.id,
                clientOrderId: order.clientOrderId,
                exchangeOrderId: order.exchangeOrderId,
                status: "canceled"
              })
            ));
            openOrders = await listGridBotOpenOrders(instance.id);
          }
          if (orderRecovery.unknownVenueOrders.length > 0) {
            let reopenedVenueOrderCount = 0;
            for (const venueOrder of orderRecovery.unknownVenueOrders) {
              const orderRef = await findGridBotOrderMapByOrderRef({
                instanceId: instance.id,
                clientOrderId: venueOrder.clientOrderId,
                exchangeOrderId: venueOrder.exchangeOrderId
              });
              if (!orderRef?.clientOrderId) continue;
              await createGridBotOrderMapEntry({
                instanceId: instance.id,
                botId: ctx.bot.id,
                clientOrderId: orderRef.clientOrderId,
                exchangeOrderId: venueOrder.exchangeOrderId ?? orderRef.exchangeOrderId ?? null,
                gridLeg: orderRef.gridLeg,
                gridIndex: orderRef.gridIndex,
                intentType: orderRef.intentType,
                side: venueOrder.side === "sell" ? "sell" : "buy",
                price: venueOrder.price ?? null,
                qty: venueOrder.qty ?? null,
                reduceOnly: venueOrder.reduceOnly ?? orderRef.reduceOnly,
                status: "open"
              });
              reopenedVenueOrderCount += 1;
            }
            if (reopenedVenueOrderCount > 0) {
              openOrders = await listGridBotOpenOrders(instance.id);
            }
          }
          if (
            prePlanFillSyncSummary
            || orderRecovery.summary.orphanedCount > 0
            || orderRecovery.summary.blockedResubmitCount > 0
            || orderRecovery.summary.unknownVenueCount > 0
            || orderRecovery.summary.missingVenueCount > 0
          ) {
            await persistCurrentStateJson();
          }
        } catch {
          await persistCurrentStateJson();
        }
      } else if (prePlanFillSyncSummary) {
        await persistCurrentStateJson();
      }
      let tradeState = await loadBotTradeState({ botId: ctx.bot.id, symbol: ctx.bot.symbol, now: ctx.now });
      const recovery = await recoverGridPendingExecutions({
        instanceId: instance.id,
        botId: ctx.bot.id,
        botSymbol: ctx.bot.symbol,
        exchangeAccountId: ctx.bot.exchangeAccountId,
        executionExchange,
        now: ctx.now,
        stateJson: currentStateJson,
        openOrders,
        adapter,
        deps: {
          placePaperLimitOrder: async (input) =>
            placePaperLimitOrderForRunner({
              exchangeAccountId: input.exchangeAccountId,
              symbol: input.symbol,
              side: input.side,
              qty: input.qty,
              price: input.price,
              reduceOnly: input.reduceOnly,
              clientOrderId: input.clientOrderId
            }),
          createOrderMapEntry: createGridBotOrderMapEntry,
          updateOrderMapStatus: updateGridBotOrderMapStatus,
          listGridOpenOrders: async () => listGridBotOpenOrders(instance.id)
        }
      });
      currentStateJson = recovery.stateJson;
      openOrders = recovery.openOrders;
      if (
        recovery.summary.recoveredCount > 0
        || recovery.summary.pendingCount > 0
        || recovery.summary.manualInterventionCount > 0
      ) {
        await persistCurrentStateJson();
      }
      let precomputedPlannerPositionResolution: Awaited<ReturnType<typeof resolvePlannerPositionForExecution>> | null = null;
      if (adapter && executionExchange !== "paper" && !hasOpenPlannerPosition(toPlannerPosition(tradeState))) {
        const shouldSyncTradeStateFromVenue =
          openOrders.length > 0
          || currentStateJson.initialSeedExecuted === true
          || currentStateJson.initialSeedPending === true;
        if (shouldSyncTradeStateFromVenue) {
          try {
            precomputedPlannerPositionResolution = await resolvePlannerPositionForExecution({
              adapter,
              symbol: ctx.bot.symbol,
              executionExchange,
              tradeState,
              openOrdersCount: openOrders.length,
              currentStateJson
            });
            tradeState = await syncGridTradeStateWithPlannerPosition({
              botId: ctx.bot.id,
              symbol: ctx.bot.symbol,
              now: ctx.now,
              tradeState,
              plannerPosition: precomputedPlannerPositionResolution.position
            });
          } catch {
            precomputedPlannerPositionResolution = null;
          }
        }
      }
      const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
      const lastProcessedGridFillTs = String(currentStateJson.lastProcessedGridFillTs ?? "").trim();
      const livePlannerFillEvents = executionExchange !== "paper"
        ? await listGridBotFillEvents({
            instanceId: instance.id,
            afterTs: lastProcessedGridFillTs ? new Date(lastProcessedGridFillTs) : null,
            take: 50
          })
        : [];
      const preReconciliationPositionRefresh = await refreshTradeStateForVaultReconciliation({
        executionExchange,
        liveFillEvents: livePlannerFillEvents,
        tradeState,
        resolvePlannerPosition: () => resolvePlannerPositionForExecution({
          adapter,
          symbol: ctx.bot.symbol,
          executionExchange,
          tradeState,
          openOrdersCount: openOrders.length,
          currentStateJson
        }),
        syncTradeState: (plannerPosition) => syncGridTradeStateWithPlannerPosition({
          botId: ctx.bot.id,
          symbol: ctx.bot.symbol,
          now: ctx.now,
          tradeState,
          plannerPosition
        })
      });
      tradeState = preReconciliationPositionRefresh.tradeState;
      precomputedPlannerPositionResolution = precomputedPlannerPositionResolution ?? preReconciliationPositionRefresh.plannerPositionResolution;
      let vaultReconciliationResult: ReconciliationResult | null = null;
      if (adapter && isHyperliquidV3Vault && botVaultId) {
        const reconciliationMonitor = getOrCreateHyperliquidExecutionMonitor(`bot_vault_v3:${botVaultId}`);
        const pendingExecutions = listPendingGridExecutions(currentStateJson);
        const expectedPosition = toPlannerPosition(tradeState);
        const balanceExpectation = buildVaultBalanceExpectation({
          currentStateJson,
          openOrdersCount: openOrders.length,
          plannerPosition: expectedPosition,
          pendingExecutions
        });
        const reconciliationResult = await reconciliationMonitor.reconcileOrders({
          adapter: adapter as any,
          symbol: ctx.bot.symbol,
          localOpenOrders: openOrders.map((row) => ({
            clientOrderId: row.clientOrderId,
            exchangeOrderId: row.exchangeOrderId,
            side: row.side,
            price: row.price,
            qty: row.qty,
            reduceOnly: row.reduceOnly
          })),
          expectedPosition: expectedPosition
            ? {
                symbol: ctx.bot.symbol,
                side: expectedPosition.side === "short" ? "short" : "long",
                qty: Number(expectedPosition.qty),
                entryPrice: Number.isFinite(Number(expectedPosition.entryPrice))
                  ? Number(expectedPosition.entryPrice)
                  : null
              }
            : null,
          pendingExecutions,
          balanceExpectation,
          now: ctx.now
        }).catch(() => null);
        if (reconciliationResult) {
          vaultReconciliationResult = reconciliationResult;
          const reconciliationBlockedReason = resolveVaultReconciliationBlockReason(reconciliationResult);
          const terminalStatusUpdates = reconciliationResult.statusChanges
            .filter((row) => row.nextState === "filled" || row.nextState === "canceled" || row.nextState === "rejected")
            .map((row) => {
              const order = reconciliationResult.orders.find((entry) => entry.key === row.orderKey);
              if (!order) return null;
              return {
                clientOrderId: order.clientOrderId,
                exchangeOrderId: order.exchangeOrderId ?? order.liveOrderId,
                status: row.nextState
              };
            })
            .filter((row): row is {
              clientOrderId: string | null;
              exchangeOrderId: string | null;
              status: "filled" | "canceled" | "rejected";
            } => Boolean(row));
          if (terminalStatusUpdates.length > 0) {
            await Promise.allSettled(terminalStatusUpdates.map((row) =>
              updateGridBotOrderMapStatus({
                instanceId: instance.id,
                clientOrderId: row.clientOrderId,
                exchangeOrderId: row.exchangeOrderId,
                status: row.status
              })
            ));
            openOrders = await listGridBotOpenOrders(instance.id);
          }
          await updateBotVaultExecutionRuntime({
            botVaultId,
            executionLastSyncedAt: ctx.now,
            executionMetadataPatch: {
              reconciliationMonitor: summarizeVaultReconciliation(reconciliationResult)
            }
          });
          for (const alert of reconciliationResult.newAlerts.slice(0, 5)) {
            await writeRiskEventFn({
              botId: ctx.bot.id,
              type: "GRID_PLAN_BLOCKED",
              message: `grid_reconciliation_${alert.code}`,
              meta: buildGridExecutionMeta({
                stage: "vault_reconciliation",
                symbol: ctx.bot.symbol,
                instanceId: instance.id,
                reason: alert.code,
                extra: {
                  severity: alert.severity,
                  orderKey: alert.orderKey ?? null,
                  message: alert.message
                }
              })
            });
          }
          let reopenedLiveOrderCount = 0;
          for (const liveOrder of reconciliationResult.liveOpenOrders) {
            const refs = extractHyperliquidLiveOrderRefs({
              orderId: String(liveOrder.orderId ?? "").trim() || null,
              raw: liveOrder.raw
            });
            let orderRef = refs.clientOrderId
              ? await findGridBotOrderMapByOrderRef({
                  instanceId: instance.id,
                  clientOrderId: refs.clientOrderId
                })
              : null;
            if (!orderRef) {
              for (const exchangeOrderRef of refs.exchangeOrderRefs) {
                orderRef = await findGridBotOrderMapByOrderRef({
                  instanceId: instance.id,
                  exchangeOrderId: exchangeOrderRef
                });
                if (orderRef) break;
              }
            }
            const resolvedClientOrderId = orderRef?.clientOrderId ?? refs.clientOrderId ?? "";
            if (!resolvedClientOrderId.startsWith(`grid-${instance.id}-`)) continue;
            const alreadyTracked = liveOrderMatchesLocalOpenOrder({
              openOrders,
              clientOrderId: resolvedClientOrderId,
              exchangeOrderRefs: refs.exchangeOrderRefs
            });
            if (alreadyTracked) continue;
            const parsedRef = orderRef
              ? {
                  gridLeg: orderRef.gridLeg,
                  gridIndex: orderRef.gridIndex,
                  intentType: orderRef.intentType
                }
              : parseGridClientOrderIdForRecovery(instance.id, resolvedClientOrderId);
            if (!parsedRef) continue;
            await createGridBotOrderMapEntry({
              instanceId: instance.id,
              botId: ctx.bot.id,
              clientOrderId: resolvedClientOrderId,
              exchangeOrderId: orderRef?.exchangeOrderId ?? refs.exchangeOrderRefs[0] ?? null,
              gridLeg: parsedRef.gridLeg,
              gridIndex: parsedRef.gridIndex,
              intentType: "intentType" in parsedRef
                ? parsedRef.intentType
                : liveOrder.reduceOnly === true ? "rebalance" : "entry",
              side: String(liveOrder.side ?? "").trim().toLowerCase() === "sell" ? "sell" : "buy",
              price: Number.isFinite(Number(liveOrder.price ?? NaN)) ? Number(liveOrder.price) : null,
              qty: Number.isFinite(Number(liveOrder.qty ?? NaN)) ? Number(liveOrder.qty) : null,
              reduceOnly: liveOrder.reduceOnly === true,
              status: "open"
            });
            reopenedLiveOrderCount += 1;
          }
          if (reopenedLiveOrderCount > 0) {
            openOrders = await listGridBotOpenOrders(instance.id);
          }
          if (reconciliationBlockedReason) {
            await writeRiskEventFn({
              botId: ctx.bot.id,
              type: "GRID_PLAN_BLOCKED",
              message: reconciliationBlockedReason,
              meta: buildGridExecutionMeta({
                stage: "vault_reconciliation_blocked",
                symbol: ctx.bot.symbol,
                instanceId: instance.id,
                reason: reconciliationBlockedReason,
                extra: {
                  status: reconciliationResult.status,
                  criticalDrifts: reconciliationResult.drifts
                    .filter((row) => row.severity === "critical")
                    .slice(0, 10)
                }
              })
            });
            return buildModeBlockedResult(signal, reconciliationBlockedReason, {
              mode: "futures_grid",
              preserveReason: true,
              reconciliation: summarizeVaultReconciliation(reconciliationResult)
            });
          }
        }
      }
      if (recovery.blockedReason) {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_BLOCKED",
          message: recovery.blockedReason,
          meta: buildGridExecutionMeta({
            stage: "execution_recovery_blocked",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason: recovery.blockedReason,
            extra: {
              executionRecovery: recovery.summary
            }
          })
        });
        return buildModeBlockedResult(signal, recovery.blockedReason, {
          mode: "futures_grid",
          preserveReason: true,
          executionRecovery: recovery.summary
        });
      }
      let paperFillEvents: Array<{
        exchangeOrderId: string | null;
        clientOrderId: string | null;
        side: "buy" | "sell";
        fillPrice: number;
        fillQty: number;
        fillTs: Date;
        gridLeg: "long" | "short";
        gridIndex: number;
        intentType: "entry" | "tp" | "sl" | "rebalance";
      }> = [];
      if (executionExchange === "paper" && openOrders.length > 0) {
        const previousMarkPrice = Number(currentStateJson.lastMarkPrice ?? NaN);
        paperFillEvents = await simulatePaperGridLimitFillsForRunner({
          exchangeAccountId: ctx.bot.exchangeAccountId,
          symbol: ctx.bot.symbol,
          markPrice,
          previousMarkPrice: Number.isFinite(previousMarkPrice) && previousMarkPrice > 0 ? previousMarkPrice : null,
          maxFillsPerTick: readEnvNumber("GRID_PAPER_MAX_FILLS_PER_TICK", 12, 1, 100),
          openOrders
        });
        if (paperFillEvents.length > 0) {
          await Promise.allSettled([
            ...paperFillEvents.map((fill) =>
              updateGridBotOrderMapStatus({
                instanceId: instance.id,
                clientOrderId: fill.clientOrderId,
                exchangeOrderId: fill.exchangeOrderId,
                status: "filled"
              })
            ),
            ...paperFillEvents.map((fill, index) =>
              createGridBotFillEventEntry({
                instanceId: instance.id,
                botId: ctx.bot.id,
                exchangeOrderId: fill.exchangeOrderId,
                clientOrderId: fill.clientOrderId,
                exchangeFillId: `${fill.exchangeOrderId ?? fill.clientOrderId ?? "paper"}:${fill.fillTs.getTime()}:${index}`,
                fillPrice: fill.fillPrice,
                fillQty: fill.fillQty,
                fillNotionalUsd: Number((fill.fillPrice * fill.fillQty).toFixed(8)),
                feeUsd: 0,
                side: fill.side,
                gridLeg: fill.gridLeg,
                gridIndex: fill.gridIndex,
                fillTs: fill.fillTs,
                dedupeKey: [
                  instance.id,
                  fill.exchangeOrderId ?? "",
                  fill.clientOrderId ?? "",
                  fill.fillPrice.toFixed(8),
                  fill.fillQty.toFixed(8),
                  fill.fillTs.toISOString(),
                ].join("|"),
                rawJson: {
                  source: "paper_limit_simulator",
                  intentType: fill.intentType,
                }
              })
            )
          ]);
          openOrders = await listGridBotOpenOrders(instance.id);
        }
      }
      const plannerFillResolution = resolvePlannerFillEventsForExecution({
        currentStateJson,
        paperFillEvents,
        liveFillEvents: livePlannerFillEvents
      });

      if (botVaultState === "paused" || botVaultState === "closed" || botVaultState === "error") {
        const entryOrders = selectCancelableEntryOrders(openOrders);
        const cancelSummary = await cancelGridOpenOrdersBestEffort({
          adapter,
          openOrders: entryOrders.map((row) => ({
            exchangeOrderId: row.exchangeOrderId,
            clientOrderId: row.clientOrderId
          })),
          botSymbol: ctx.bot.symbol
        });
        if (ctx.bot.botVaultExecution?.botVaultId && entryOrders.length > 0) {
          await Promise.allSettled(entryOrders.map((row) =>
            writeBotOrderDualWrite({
              botVaultId: ctx.bot.botVaultExecution?.botVaultId,
              exchange: executionExchange,
              symbol: ctx.bot.symbol,
              clientOrderId: row.clientOrderId ?? null,
              exchangeOrderId: row.exchangeOrderId ?? null,
              side: row.side === "sell" ? "sell" : "buy",
              orderType: "limit",
              price: row.price ?? null,
              qty: row.qty ?? null,
              reduceOnly: row.reduceOnly === true,
              status: "CANCELED",
              metadata: {
                source: "runner_vault_state_guard",
                vaultState: botVaultState
              }
            })
          ));
        }
        if (botVaultState === "closed") {
          return buildModeNoopResult(signal, "bot_vault_closed", {
            mode: "futures_grid",
            canceledEntryOrders: cancelSummary.canceled,
            cancelErrors: cancelSummary.failed
          });
        }
        return buildModeNoopResult(signal, botVaultState === "error" ? "bot_vault_error" : "bot_vault_paused", {
          mode: "futures_grid",
          canceledEntryOrders: cancelSummary.canceled,
          cancelErrors: cancelSummary.failed
        });
      }

      if (botVaultState === "close_only") {
        const entryOrders = selectCancelableEntryOrders(openOrders);
        if (entryOrders.length > 0) {
          const cancelSummary = await cancelGridOpenOrdersBestEffort({
            adapter,
            openOrders: entryOrders.map((row) => ({
              exchangeOrderId: row.exchangeOrderId,
              clientOrderId: row.clientOrderId
            })),
            botSymbol: ctx.bot.symbol
          });
          await Promise.allSettled(entryOrders.map((row) =>
            writeBotOrderDualWrite({
              botVaultId: ctx.bot.botVaultExecution?.botVaultId,
              exchange: executionExchange,
              symbol: ctx.bot.symbol,
              clientOrderId: row.clientOrderId ?? null,
              exchangeOrderId: row.exchangeOrderId ?? null,
              side: row.side === "sell" ? "sell" : "buy",
              orderType: "limit",
              price: row.price ?? null,
              qty: row.qty ?? null,
              reduceOnly: row.reduceOnly === true,
              status: "CANCELED",
              metadata: {
                source: "runner_close_only_guard",
                canceledEntryOrders: cancelSummary.canceled,
                cancelErrors: cancelSummary.failed
              }
            })
          ));
          openOrders = await listGridBotOpenOrders(instance.id);
        }
      }

      const feeBufferPct = readEnvNumber("GRID_MIN_INVEST_FEE_BUFFER_PCT", 1, 0, 25);
      const mmrPct = readEnvNumber("GRID_LIQ_MMR_DEFAULT_PCT", 0.75, 0.01, 20);
      const liqDistanceMinPct = readEnvNumber("GRID_LIQ_DISTANCE_MIN_PCT", 8, 0, 100);
      const feeRateFallbackPct = readEnvNumber("GRID_FEE_RATE_FALLBACK_PCT", 0.06, 0, 20);
      const minNotionalFallback = readEnvNumber("GRID_MIN_NOTIONAL_FALLBACK_USDT", 5, 0);
      const autoMarginDefaultTriggerPct = readEnvNumber("GRID_AUTO_MARGIN_DEFAULT_TRIGGER_PCT", 3, 0, 100);
      const supportedAutoMarginExchanges = readSupportedAutoMarginExchanges();
      const exchangeKey = executionExchange;
      let minQty: number | null = null;
      let qtyStep: number | null = null;
      let priceTick: number | null = null;
      let feeRate: number | null = feeRateFallbackPct;
      try {
        if (adapter) {
          await adapter.contractCache.refresh(false);
          const contract = await adapter.contractCache.getByCanonical(ctx.bot.symbol);
          if (contract) {
            minQty = Number.isFinite(Number(contract.minVol)) && Number(contract.minVol) > 0 ? Number(contract.minVol) : null;
            qtyStep = Number.isFinite(Number(contract.stepSize)) && Number(contract.stepSize) > 0 ? Number(contract.stepSize) : null;
            priceTick = Number.isFinite(Number(contract.tickSize)) && Number(contract.tickSize) > 0 ? Number(contract.tickSize) : null;
            if (contract.takerFeeRate != null && Number.isFinite(Number(contract.takerFeeRate)) && Number(contract.takerFeeRate) >= 0) {
              feeRate = Number(contract.takerFeeRate);
            }
          }
        }
      } catch {
        // best-effort: keep fallbacks only
      }
      const dynamicNotional = minQty && minQty > 0 ? minQty * markPrice : 0;
      const minNotional = resolveVenueMinNotional({
        executionExchange,
        fallbackMinNotional: minNotionalFallback,
        dynamicMinNotional: dynamicNotional
      });

      let plannerPositionResolution;
      if (executionExchange === "paper") {
        plannerPositionResolution = {
          position: await toPlannerPositionFromPaper({
            exchangeAccountId: ctx.bot.exchangeAccountId,
            symbol: ctx.bot.symbol
          }),
          source: "paper" as const,
          degraded: false,
          readError: null
        };
      } else {
        plannerPositionResolution = precomputedPlannerPositionResolution ?? await resolvePlannerPositionForExecution({
          adapter,
          symbol: ctx.bot.symbol,
          executionExchange,
          tradeState,
          openOrdersCount: openOrders.length,
          currentStateJson
        });
      }
      let plannerPosition = plannerPositionResolution.position;
      if (executionExchange !== "paper") {
        tradeState = await syncGridTradeStateWithPlannerPosition({
          botId: ctx.bot.id,
          symbol: ctx.bot.symbol,
          now: ctx.now,
          tradeState,
          plannerPosition
        });
      }
      if (plannerPositionResolution.degraded) {
        currentStateJson = {
          ...currentStateJson,
          plannerPositionFallback: {
            exchange: executionExchange,
            source: plannerPositionResolution.source,
            error: plannerPositionResolution.readError,
            at: ctx.now.toISOString()
          }
        };
        await persistCurrentStateJson();
      }

      const isHyperliquidOnchainVault =
        executionExchange === "hyperliquid"
        && Boolean(ctx.bot.botVaultExecution?.vaultAddress);
      if (
        isHyperliquidOnchainVault
        && botVaultState === "close_only"
        && adapter
        && openOrders.length === 0
        && !hasOpenPlannerPosition(plannerPosition)
      ) {
        const adapterAny = adapter as any;
        const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
        const vaultBalanceSnapshot = await readVaultBalanceSnapshot({
          adapter,
          cacheIdentity: botVaultId || instance.id,
          symbol: ctx.bot.symbol,
          now: ctx.now,
          requireSpotBalance: true
        });
        const perpToSpotRecordedAt = String(currentStateJson.closeOnlyPerpToSpotDoneAt ?? "").trim();
        const spotToEvmRecordedAt = String(currentStateJson.closeOnlySpotToEvmDoneAt ?? "").trim();
        const settlementReadyAt = String(currentStateJson.closeOnlySettlementReadyAt ?? "").trim();
        if (!vaultBalanceSnapshot.usableForTransfers) {
          return buildModeBlockedResult(signal, "grid_vault_balance_snapshot_invalid", {
            mode: "futures_grid",
            preserveReason: true,
            vaultBalanceSnapshot
          });
        }
        const perpWithdrawableUsd = Math.max(0, Number(vaultBalanceSnapshot.availableMarginUsd ?? 0));
        const spotBalanceUsd = Math.max(0, Number(vaultBalanceSnapshot.coreSpotBalanceUsd ?? 0));
        const shouldRetryPerpToSpot = shouldRetryCloseOnlySettlementTransfer({
          recordedAt: perpToSpotRecordedAt,
          sourceBalanceUsd: perpWithdrawableUsd,
          now: ctx.now
        });
        const shouldRetrySpotToEvm = shouldRetryCloseOnlySettlementTransfer({
          recordedAt: spotToEvmRecordedAt,
          sourceBalanceUsd: spotBalanceUsd,
          now: ctx.now
        });

        if (perpWithdrawableUsd > 0.000001) {
          if (!shouldRetryPerpToSpot) {
            return buildModeBlockedResult(signal, "grid_close_only_perp_to_spot_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          if (typeof adapterAny.transferUsdClass !== "function") {
            const reason = "grid_close_only_perp_to_spot_unsupported";
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionLastError: reason,
              executionLastErrorAt: ctx.now,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "perp_to_spot_unsupported",
                settlementLastUpdatedAt: ctx.now.toISOString()
              }
            });
            return buildModeBlockedResult(signal, reason, {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          try {
            const transferResult = await adapterAny.transferUsdClass({
              amountUsd: perpWithdrawableUsd,
              toPerp: false
            });
            if (transferResult?.status === "failed") {
              throw new Error(transferResult.errorMessage ?? transferResult.errorCode ?? "grid_close_only_perp_to_spot_failed");
            }
            currentStateJson = {
              ...currentStateJson,
              closeOnlyPerpToSpotDoneAt: ctx.now.toISOString(),
              closeOnlyPerpToSpotAmountUsd: perpWithdrawableUsd,
              closeOnlyPerpToSpotLastTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
              closeOnlyPerpToSpotLastStatus: typeof transferResult?.status === "string" ? transferResult.status : null
            };
            await updateGridBotInstancePlannerState({
              instanceId: instance.id,
              state: "running",
              stateJson: currentStateJson,
              metricsJson: mergeCurrentMetrics({
                  closeOnlyPerpToSpotAmountUsd: perpWithdrawableUsd,
                  closeOnlyPerpToSpotTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : undefined,
                  closeOnlyPerpToSpotStatus: typeof transferResult?.status === "string" ? transferResult.status : undefined
                }),
              lastPlanError: "grid_close_only_perp_to_spot_pending",
              lastPlanVersion: "python-v1-close-only-settlement"
            });
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionStatus: "close_only",
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "perp_to_spot_pending",
                settlementLastUpdatedAt: ctx.now.toISOString(),
                settlementPerpToSpotAmountUsd: perpWithdrawableUsd,
                settlementPerpToSpotTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
                settlementPerpToSpotStatus: typeof transferResult?.status === "string" ? transferResult.status : null
              }
            });
            return buildModeBlockedResult(signal, "grid_close_only_perp_to_spot_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          } catch (error) {
            const reason = `grid_close_only_perp_to_spot_failed:${String(error)}`;
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionLastError: String(error),
              executionLastErrorAt: ctx.now,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "perp_to_spot_failed",
                settlementLastUpdatedAt: ctx.now.toISOString(),
                settlementLastError: String(error)
              }
            });
            return buildModeBlockedResult(signal, reason, {
              mode: "futures_grid",
              preserveReason: true
            });
          }
        }

        if (spotBalanceUsd > 0.000001) {
          if (!shouldRetrySpotToEvm) {
            return buildModeBlockedResult(signal, "grid_close_only_spot_to_evm_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          if (typeof adapterAny.transferUsdcSpotToEvm !== "function") {
            const reason = "grid_close_only_spot_to_evm_unsupported";
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionLastError: reason,
              executionLastErrorAt: ctx.now,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "spot_to_evm_unsupported",
                settlementLastUpdatedAt: ctx.now.toISOString()
              }
            });
            return buildModeBlockedResult(signal, reason, {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          try {
            const transferResult = await adapterAny.transferUsdcSpotToEvm({
              amountUsd: spotBalanceUsd
            });
            if (transferResult?.status === "failed") {
              throw new Error(transferResult.errorMessage ?? transferResult.errorCode ?? "grid_close_only_spot_to_evm_failed");
            }
            currentStateJson = {
              ...currentStateJson,
              closeOnlySpotToEvmDoneAt: ctx.now.toISOString(),
              closeOnlySpotToEvmAmountUsd: spotBalanceUsd,
              closeOnlySpotToEvmLastTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
              closeOnlySpotToEvmLastStatus: typeof transferResult?.status === "string" ? transferResult.status : null
            };
            await updateGridBotInstancePlannerState({
              instanceId: instance.id,
              state: "running",
              stateJson: currentStateJson,
              metricsJson: mergeCurrentMetrics({
                  closeOnlySpotToEvmAmountUsd: spotBalanceUsd,
                  closeOnlySpotToEvmTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : undefined,
                  closeOnlySpotToEvmStatus: typeof transferResult?.status === "string" ? transferResult.status : undefined
                }),
              lastPlanError: "grid_close_only_spot_to_evm_pending",
              lastPlanVersion: "python-v1-close-only-settlement"
            });
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionStatus: "close_only",
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "spot_to_evm_pending",
                settlementLastUpdatedAt: ctx.now.toISOString(),
                settlementSpotToEvmAmountUsd: spotBalanceUsd,
                settlementSpotToEvmTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
                settlementSpotToEvmStatus: typeof transferResult?.status === "string" ? transferResult.status : null
              }
            });
            return buildModeBlockedResult(signal, "grid_close_only_spot_to_evm_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          } catch (error) {
            const reason = `grid_close_only_spot_to_evm_failed:${String(error)}`;
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionLastError: String(error),
              executionLastErrorAt: ctx.now,
              executionMetadataPatch: {
                lifecycleOverrideState: "settling",
                settlementStage: "spot_to_evm_failed",
                settlementLastUpdatedAt: ctx.now.toISOString(),
                settlementLastError: String(error)
              }
            });
            return buildModeBlockedResult(signal, reason, {
              mode: "futures_grid",
              preserveReason: true
            });
          }
        }

        if (!settlementReadyAt && perpWithdrawableUsd <= 0.000001 && spotBalanceUsd <= 0.000001) {
          currentStateJson = {
            ...currentStateJson,
            closeOnlySettlementReadyAt: ctx.now.toISOString()
          };
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: currentStateJson,
            lastPlanError: null,
            lastPlanVersion: "python-v1-close-only-settlement"
          });
          if (botVaultId) {
            await updateBotVaultExecutionRuntime({
              botVaultId,
              executionStatus: "close_only",
              executionLastError: null,
              executionLastErrorAt: null,
              executionMetadataPatch: {
                lifecycleOverrideState: "withdraw_pending",
                settlementStage: "evm_ready",
                settlementReadyAt: ctx.now.toISOString(),
                settlementLastUpdatedAt: ctx.now.toISOString()
              }
            });
          }
          return buildModeNoopResult(signal, "grid_close_only_settlement_ready", {
            mode: "futures_grid"
          });
        }
      }

      if (Number.isFinite(Number(markPrice)) && Number(markPrice) > 0) {
        const nextMarkPrice = Number(markPrice);
        const previousMarkPrice = Number(currentStateJson.lastMarkPrice ?? NaN);
        const metricsRecord = currentMetricsJson;
        const positionSnapshotRecord = asRecord(metricsRecord.positionSnapshot) ?? {};
        const previousMetricsMarkPrice = Number(
          positionSnapshotRecord.markPrice ?? NaN
        );
        if (previousMarkPrice !== nextMarkPrice || previousMetricsMarkPrice !== nextMarkPrice) {
          currentStateJson = {
            ...currentStateJson,
            lastMarkPrice: nextMarkPrice
          };
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: instance.state === "running" ? "running" : instance.state,
            stateJson: currentStateJson,
            metricsJson: mergeCurrentMetrics({
              positionSnapshot: {
                side: plannerPosition?.side ?? null,
                qty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
                entryPrice: Number.isFinite(Number(plannerPosition?.entryPrice)) ? Number(plannerPosition?.entryPrice) : null,
                markPrice: nextMarkPrice
              }
            })
          });
        }
      }

      if (
        currentStateJson.initialSeedExecuted === true
        && currentMetricsJson.initialSeedExecuted !== true
        && hasOpenPlannerPosition(plannerPosition)
      ) {
        const reconciledSeedPct = Number.isFinite(Number(currentStateJson.initialSeedPct))
          ? Number(currentStateJson.initialSeedPct)
          : Number(instance.initialSeedPct ?? 0);
        const reconciledSeedMarginUsd = Math.max(0, Number(instance.investUsd ?? 0) * (reconciledSeedPct / 100));
        const reconciledSeedNotionalUsd = Number(
          (
            Math.max(0, Number(plannerPosition?.qty ?? 0))
            * Math.max(0, Number(markPrice ?? plannerPosition?.entryPrice ?? 0))
          ).toFixed(8)
        );
        await updateGridBotInstancePlannerState({
          instanceId: instance.id,
          state: "running",
          stateJson: currentStateJson,
          metricsJson: mergeCurrentMetrics({
            ...buildExecutedGridInitialSeedMetrics({
              seedSide: plannerPosition?.side
                ?? (typeof currentStateJson.initialSeedSide === "string" ? currentStateJson.initialSeedSide : null),
              seedQty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
              seedNotionalUsd: reconciledSeedNotionalUsd,
              seedMarginUsd: reconciledSeedMarginUsd,
              seedPct: reconciledSeedPct,
              seedPrice: Number.isFinite(Number(plannerPosition?.entryPrice ?? NaN))
                ? Number(plannerPosition?.entryPrice)
                : markPrice
            }),
            positionSnapshot: {
              side: plannerPosition?.side ?? null,
              qty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
              entryPrice: Number.isFinite(Number(plannerPosition?.entryPrice)) ? Number(plannerPosition?.entryPrice) : null,
              markPrice
            }
          }),
          lastPlanError: null,
          lastPlanVersion: "python-v1-seed-metrics-reconciled"
        });
      }

      if (shouldMarkInitialSeedExecuted({
        currentStateJson,
        plannerPosition
      })) {
        const confirmedSeedPct = Number.isFinite(Number(currentStateJson.initialSeedPct))
          ? Number(currentStateJson.initialSeedPct)
          : Number(instance.initialSeedPct ?? 0);
        const confirmedSeedMarginUsd = Math.max(0, Number(instance.investUsd ?? 0) * (confirmedSeedPct / 100));
        const confirmedSeedStateJson = {
          ...currentStateJson,
          initialSeedExecuted: true,
          initialSeedPending: false,
          initialSeedNeedsReseed: false,
          initialSeedConfirmedAt: ctx.now.toISOString()
        };
        const confirmedSeedNotionalUsd = Number(
          (
            Math.max(0, Number(plannerPosition?.qty ?? 0))
            * Math.max(0, Number(markPrice ?? plannerPosition?.entryPrice ?? 0))
          ).toFixed(8)
        );
        await updateGridBotInstancePlannerState({
          instanceId: instance.id,
          state: "running",
          stateJson: confirmedSeedStateJson,
          metricsJson: mergeCurrentMetrics({
            ...buildExecutedGridInitialSeedMetrics({
              seedSide: plannerPosition?.side ?? null,
              seedQty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
              seedNotionalUsd: confirmedSeedNotionalUsd,
              seedMarginUsd: confirmedSeedMarginUsd,
              seedPct: confirmedSeedPct,
              seedPrice: Number.isFinite(Number(plannerPosition?.entryPrice ?? NaN))
                ? Number(plannerPosition?.entryPrice)
                : markPrice
            }),
            positionSnapshot: {
              side: plannerPosition?.side ?? null,
              qty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
              entryPrice: Number.isFinite(Number(plannerPosition?.entryPrice)) ? Number(plannerPosition?.entryPrice) : null,
              markPrice
            }
          }),
          lastPlanError: null,
          lastPlanVersion: "python-v1-seed-confirmed"
        });
        currentStateJson = confirmedSeedStateJson;
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_APPLIED",
          message: "grid_initial_seed_confirmed",
          meta: buildGridExecutionMeta({
            stage: "plan_applied_initial_seed_confirmed",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            extra: {
              seedSide: plannerPosition?.side ?? null,
              seedQty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
              seedEntryPrice: Number.isFinite(Number(plannerPosition?.entryPrice)) ? Number(plannerPosition?.entryPrice) : null,
              markPrice
            }
          })
        });
      }

      const initialSeedEnabled = Boolean(instance.initialSeedEnabled) && Number(instance.initialSeedPct) > 0;
      const seedNeedsReseed = currentStateJson.initialSeedNeedsReseed === true;
      const seedAlreadyExecuted = currentStateJson.initialSeedExecuted === true;
      let seedPending = currentStateJson.initialSeedPending === true;
      const initialPerpTransferAmountUsd = readInitialPerpTransferAmountUsd(ctx.bot);
      const allowHyperliquidVaultBootstrap = !isHyperliquidOnchainVaultBootstrap || shouldAllowHyperliquidVaultBootstrap({
        status: ctx.bot.botVaultExecution?.status,
        executionStatus: ctx.bot.botVaultExecution?.executionStatus,
        executionLastError: ctx.bot.botVaultExecution?.executionLastError,
        executionMetadata: ctx.bot.botVaultExecution?.executionMetadata
      });
      const botVaultExecutionReadiness = isHyperliquidV3Vault
        ? evaluateHyperliquidBotVaultExecutionReadiness({
            vaultAddress: ctx.bot.botVaultExecution?.vaultAddress,
            status: ctx.bot.botVaultExecution?.status,
            executionStatus: ctx.bot.botVaultExecution?.executionStatus,
            executionLastError: ctx.bot.botVaultExecution?.executionLastError,
            executionMetadata: ctx.bot.botVaultExecution?.executionMetadata,
            fundingStatus: ctx.bot.botVaultExecution?.fundingStatus,
            hypercoreFundingStatus: ctx.bot.botVaultExecution?.hypercoreFundingStatus
          })
        : { ready: true as const, reason: "bot_vault_v3_ready" as const, detail: null };
      const restartRecoveryGuardReason = resolveRestartRecoveryGuardReason({
        currentStateJson,
        plannerPosition,
        openOrdersCount: openOrders.length,
        reconciliationResult: vaultReconciliationResult
      });

      if (isHyperliquidV3Vault && !botVaultExecutionReadiness.ready) {
        return buildModeBlockedResult(signal, botVaultExecutionReadiness.reason, {
          mode: "futures_grid",
          preserveReason: true,
          executionReadiness: botVaultExecutionReadiness
        });
      }

      if (
        isHyperliquidOnchainVaultBootstrap
        && allowHyperliquidVaultBootstrap
        && adapter
        && !hasOpenPlannerPosition(plannerPosition)
        && initialPerpTransferAmountUsd > 0
      ) {
        const adapterAny = adapter as any;
        const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
        const vaultBalanceSnapshot = await readVaultBalanceSnapshot({
          adapter,
          cacheIdentity: botVaultId || instance.id,
          symbol: ctx.bot.symbol,
          now: ctx.now,
          requireSpotBalance: true
        });
        if (!vaultBalanceSnapshot.usableForTransfers) {
          return buildModeBlockedResult(signal, "grid_vault_balance_snapshot_invalid", {
            mode: "futures_grid",
            preserveReason: true,
            vaultBalanceSnapshot
          });
        }
        if (!hasPositiveAccountFunding({
          equity: vaultBalanceSnapshot.equityUsd,
          availableMargin: vaultBalanceSnapshot.availableMarginUsd
        })) {
          const hasCoreDepositCapability = typeof adapterAny.depositUsdcToHyperCore === "function";
          const hasTransferCapability = typeof adapterAny.transferUsdClass === "function";
          const coreSpotBalanceUsd = Number(vaultBalanceSnapshot.coreSpotBalanceUsd ?? NaN);
          const observedCoreSpotFundingAmountUsd = resolveInitialPerpFundingAmountUsd({
            requestedAmountUsd: initialPerpTransferAmountUsd,
            coreSpotBalanceUsd
          });
          const coreSpotDepositAmountUsd = resolveInitialCoreSpotDepositAmountUsd({
            requestedAmountUsd: initialPerpTransferAmountUsd,
            coreSpotBalanceUsd
          });
          let coreSpotTransferRecordedAt = String(currentStateJson.initialCoreSpotTransferDoneAt ?? "").trim();
          const transferRecordedAt = String(currentStateJson.initialPerpTransferDoneAt ?? "").trim();
          const applyHypercoreAccountingFeeIfNeeded = async (): Promise<void> => {
            if (!botVaultId) return;
            try {
              await applyBotVaultHypercoreAccountingFee({
                botVaultId,
                feeUsd: HYPERCORE_ACCOUNTING_FEE_USD,
                appliedAt: ctx.now
              });
            } catch (error) {
              await writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLAN_BLOCKED",
                message: "grid hypercore accounting fee booking failed",
                meta: buildGridExecutionMeta({
                  stage: "plan_blocked_hypercore_accounting_fee_booking",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  reason: "grid_hypercore_accounting_fee_booking_failed",
                  error,
                  extra: {
                    feeUsd: HYPERCORE_ACCOUNTING_FEE_USD
                  }
                })
              });
            }
          };
          if (!coreSpotTransferRecordedAt && observedCoreSpotFundingAmountUsd > 0) {
            await applyHypercoreAccountingFeeIfNeeded();
            currentStateJson = {
              ...currentStateJson,
              initialCoreSpotTransferDoneAt: ctx.now.toISOString(),
              initialCoreSpotTransferAmountUsd: observedCoreSpotFundingAmountUsd,
              initialCoreSpotTransferLastTxHash: currentStateJson.initialCoreSpotTransferLastTxHash ?? null
            };
            coreSpotTransferRecordedAt = String(currentStateJson.initialCoreSpotTransferDoneAt ?? "").trim();
          }
          if (!coreSpotTransferRecordedAt && hasCoreDepositCapability && coreSpotDepositAmountUsd > 0) {
            try {
              const depositResult = await adapterAny.depositUsdcToHyperCore({
                amountUsd: coreSpotDepositAmountUsd
              });
              if (depositResult?.status === "failed") {
                throw new Error(depositResult.errorMessage ?? depositResult.errorCode ?? "grid_initial_core_spot_funding_failed");
              }
              await applyHypercoreAccountingFeeIfNeeded();
              currentStateJson = {
                ...currentStateJson,
                initialCoreSpotTransferDoneAt: ctx.now.toISOString(),
                initialCoreSpotTransferAmountUsd: coreSpotDepositAmountUsd,
                initialCoreSpotTransferLastTxHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : null,
                initialCoreSpotTransferLastStatus: typeof depositResult?.status === "string" ? depositResult.status : null
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                metricsJson: mergeCurrentMetrics({
                  initialCoreSpotTransferAmountUsd: coreSpotDepositAmountUsd,
                  initialCoreSpotTransferTxHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : undefined,
                  initialCoreSpotTransferStatus: typeof depositResult?.status === "string" ? depositResult.status : undefined
                }),
                lastPlanError: "grid_initial_core_spot_funding_pending",
                lastPlanVersion: "python-v1-initial-core-spot-funding"
              });
              await writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLAN_APPLIED",
                message: "grid_initial_core_spot_funding_submitted",
                meta: buildGridExecutionMeta({
                  stage: "plan_applied_initial_core_spot_funding",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  extra: {
                    amountUsd: coreSpotDepositAmountUsd,
                    txHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : null,
                    status: typeof depositResult?.status === "string" ? depositResult.status : null
                  }
                })
              });
            } catch (error) {
              const reason = `grid_initial_core_spot_funding_failed:${String(error)}`;
              currentStateJson = {
                ...currentStateJson,
                initialCoreSpotTransferFailedAt: ctx.now.toISOString(),
                initialCoreSpotTransferLastError: String(error)
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                lastPlanError: reason,
                lastPlanVersion: "python-v1-initial-core-spot-funding"
              });
              await writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLAN_BLOCKED",
                message: "grid initial core spot funding failed",
                meta: buildGridExecutionMeta({
                  stage: "plan_blocked_initial_core_spot_funding",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  reason,
                  error,
                  extra: {
                    amountUsd: coreSpotDepositAmountUsd
                  }
                })
              });
              return buildModeBlockedResult(signal, reason, {
                mode: "futures_grid",
                preserveReason: true
              });
            }
            return buildModeBlockedResult(signal, "grid_initial_core_spot_funding_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          if (!transferRecordedAt && hasTransferCapability) {
            if (coreSpotTransferRecordedAt) {
              await applyHypercoreAccountingFeeIfNeeded();
            }
            const transferAmountUsd = resolveInitialPerpFundingAmountUsd({
              requestedAmountUsd: initialPerpTransferAmountUsd,
              coreSpotBalanceUsd
            });
            if (!(transferAmountUsd > 0)) {
              return buildModeBlockedResult(signal, "grid_initial_perp_funding_pending", {
                mode: "futures_grid",
                preserveReason: true
              });
            }
            try {
              const transferResult = await adapterAny.transferUsdClass({
                amountUsd: transferAmountUsd,
                toPerp: true
              });
              if (transferResult?.status === "failed") {
                throw new Error(transferResult.errorMessage ?? transferResult.errorCode ?? "grid_initial_perp_funding_failed");
              }
              currentStateJson = {
                ...currentStateJson,
                initialPerpTransferDoneAt: ctx.now.toISOString(),
                initialPerpTransferAmountUsd: transferAmountUsd,
                initialPerpTransferLastTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
                initialPerpTransferLastStatus: typeof transferResult?.status === "string" ? transferResult.status : null,
                initialPerpTransferRequestedAmountUsd: initialPerpTransferAmountUsd,
                initialSeedPending: false,
                initialSeedNeedsReseed: true
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                metricsJson: mergeCurrentMetrics({
                  initialSeedPending: false,
                  initialSeedExecuted: false,
                  initialPerpTransferAmountUsd: transferAmountUsd,
                  initialPerpTransferRequestedAmountUsd: initialPerpTransferAmountUsd,
                  initialPerpTransferTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : undefined,
                  initialPerpTransferStatus: typeof transferResult?.status === "string" ? transferResult.status : undefined
                }),
                lastPlanError: "grid_initial_perp_funding_pending",
                lastPlanVersion: "python-v1-initial-perp-funding"
              });
              await writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLAN_APPLIED",
                message: "grid_initial_perp_funding_submitted",
                meta: buildGridExecutionMeta({
                  stage: "plan_applied_initial_perp_funding",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  extra: {
                    amountUsd: transferAmountUsd,
                    requestedAmountUsd: initialPerpTransferAmountUsd,
                    txHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
                    status: typeof transferResult?.status === "string" ? transferResult.status : null
                  }
                })
              });
            } catch (error) {
              const reason = `grid_initial_perp_funding_failed:${String(error)}`;
              currentStateJson = {
                ...currentStateJson,
                initialPerpTransferFailedAt: ctx.now.toISOString(),
                initialPerpTransferLastError: String(error)
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                lastPlanError: reason,
                lastPlanVersion: "python-v1-initial-perp-funding"
              });
              await writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLAN_BLOCKED",
                message: "grid initial perp funding failed",
                meta: buildGridExecutionMeta({
                  stage: "plan_blocked_initial_perp_funding",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  reason,
                  error,
                  extra: {
                    amountUsd: transferAmountUsd,
                    requestedAmountUsd: initialPerpTransferAmountUsd
                  }
                })
              });
              return buildModeBlockedResult(signal, reason, {
                mode: "futures_grid",
                preserveReason: true
              });
            }
            return buildModeBlockedResult(signal, "grid_initial_perp_funding_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          }
          if (transferRecordedAt) {
            return buildModeBlockedResult(signal, "grid_initial_perp_funding_pending", {
              mode: "futures_grid",
              preserveReason: true
            });
          }
        }
      }

      const shouldAttemptInitialSeed = initialSeedEnabled
        && allowHyperliquidVaultBootstrap
        && !restartRecoveryGuardReason
        && !hasOpenPlannerPosition(plannerPosition)
        && !seedPending
        && (instance.state === "created" || seedNeedsReseed || !seedAlreadyExecuted);

      if (
        initialSeedEnabled
        && allowHyperliquidVaultBootstrap
        && !seedPending
        && restartRecoveryGuardReason
      ) {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_BLOCKED",
          message: restartRecoveryGuardReason,
          meta: buildGridExecutionMeta({
            stage: "restart_recovery_guard_blocked",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason: restartRecoveryGuardReason,
            extra: {
              openOrdersCount: openOrders.length,
              plannerPosition: plannerPosition ?? null,
              reconciliation: vaultReconciliationResult
                ? summarizeVaultReconciliation(vaultReconciliationResult)
                : null
            }
          })
        });
        return buildModeBlockedResult(signal, restartRecoveryGuardReason, {
          mode: "futures_grid",
          preserveReason: true
        });
      }

      if (shouldAttemptInitialSeed) {
        const seedPct = Math.max(0, Math.min(60, Number(instance.initialSeedPct ?? 30)));
        const seedMarginUsd = Math.max(0, Number(instance.investUsd ?? 0) * (seedPct / 100));
        const seedNotionalUsdRaw = seedMarginUsd * Math.max(1, Number(instance.leverage ?? 1));
        const seedQty = resolveInitialSeedOrderQty({
          seedNotionalUsdRaw,
          markPrice,
          minQty,
          qtyStep,
          minNotional
        });
        const seedSide = computeInitialSeedSide({
          mode: instance.mode,
          markPrice,
          lowerPrice: instance.lowerPrice,
          upperPrice: instance.upperPrice,
          crossSideConfig: instance.crossSideConfig
        });
        const seedPositionSide = seedSide === "buy" ? "long" : "short";

        if (!Number.isFinite(seedQty) || seedQty <= 0) {
          const reason = "grid_initial_seed_failed:invalid_seed_qty";
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: withGridHealthState(currentStateJson, {
              code: "seed_failed",
              severity: "error",
              reason,
              details: {
                seedPct,
                seedMarginUsd,
                seedNotionalUsdRaw,
                markPrice
              },
              now: ctx.now
            }),
            lastPlanError: reason,
            lastPlanVersion: "python-v1-seed"
          });
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_BLOCKED",
            message: "grid initial seed failed",
            meta: buildGridExecutionMeta({
              stage: "plan_blocked_initial_seed",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              reason,
              extra: {
                seedPct,
                seedMarginUsd,
                seedNotionalUsdRaw,
                markPrice
              }
            })
          });
          return buildModeBlockedResult(signal, reason, {
            mode: "futures_grid",
            preserveReason: true
          });
        }

        try {
          let seedSubmitResult: PlaceOrderResult | null = null;
          if (executionExchange === "paper") {
            await placePaperPositionForRunner({
              exchangeAccountId: ctx.bot.exchangeAccountId,
              symbol: ctx.bot.symbol,
              side: seedPositionSide,
              qty: seedQty,
              fillPrice: markPrice,
              takeProfitPrice: null,
              stopLossPrice: null
            });
            plannerPosition = await toPlannerPositionFromPaper({
              exchangeAccountId: ctx.bot.exchangeAccountId,
              symbol: ctx.bot.symbol
            });
          } else {
            if (!adapter) {
              throw new Error("adapter_unavailable");
            }
            seedSubmitResult = await adapter.placeOrder({
              symbol: ctx.bot.symbol,
              side: seedSide,
              type: "market",
              qty: seedQty,
              reduceOnly: false,
              marginMode: "cross"
            });
            if (!isConfirmedPlaceOrderResult(seedSubmitResult) && !seedSubmitResult.submitted) {
              throw new Error(
                seedSubmitResult.errorMessage
                ?? seedSubmitResult.errorCode
                ?? "grid_initial_seed_submit_failed"
              );
            }
          }

          const seedNotionalUsd = Number((seedQty * markPrice).toFixed(8));
          const nextStateJson = {
            ...currentStateJson,
            initialSeedExecuted: executionExchange === "paper",
            initialSeedPending: executionExchange !== "paper",
            initialSeedNeedsReseed: false,
            initialSeedAt: ctx.now.toISOString(),
            initialSeedSide: seedPositionSide,
            initialSeedQty: seedQty,
            initialSeedPct: seedPct
          };
          const initialSeedContext = executionExchange === "paper"
            ? {
                exchange: executionExchange,
                symbol: ctx.bot.symbol,
                side: seedSide,
                positionSide: seedPositionSide,
                qty: seedQty,
                markPrice,
                priceSource: adapterMarkPriceDiagnostic?.priceSource ?? (readMarkPrice(signal) ? "signal" : null),
                submitResult: null,
                stage: "paper_seed_executed"
              }
            : await collectInitialSeedDiagnostics({
                adapter,
                symbol: ctx.bot.symbol,
                executionExchange,
                tradeState,
                openOrdersCount: openOrders.length,
                currentStateJson: nextStateJson,
                now: ctx.now,
                submitResult: seedSubmitResult,
                orderRequest: {
                  type: "market",
                  side: seedSide,
                  positionSide: seedPositionSide,
                  qty: seedQty,
                  reduceOnly: false,
                  marginMode: "cross",
                  markPrice,
                  seedPct,
                  seedNotionalUsd
                },
                priceSource: adapterMarkPriceDiagnostic?.priceSource ?? (readMarkPrice(signal) ? "signal" : null),
                stage: "submitted"
              });
          const persistedSeedStateJson = executionExchange === "paper"
            ? withGridHealthState(nextStateJson, null)
            : {
                ...withGridHealthState(nextStateJson, null),
                initialSeedLastContext: initialSeedContext
              };
          if (executionExchange === "paper") {
            await seedGridBotVaultMatchingStateForGridInstance({
              instanceId: instance.id,
              side: seedPositionSide,
              qty: seedQty,
              price: markPrice,
              feeUsd: 0,
            });
          }
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: persistedSeedStateJson,
            metricsJson: mergeCurrentMetrics({
              ...(executionExchange === "paper"
                ? buildExecutedGridInitialSeedMetrics({
                    seedSide: seedPositionSide,
                    seedQty,
                    seedNotionalUsd,
                    seedMarginUsd,
                    seedPct,
                    seedPrice: markPrice
                  })
                : {}),
              initialSeedExecuted: executionExchange === "paper",
              initialSeedPending: executionExchange !== "paper",
              initialSeedQty: seedQty,
              initialSeedSide: seedPositionSide,
              initialSeedPct: seedPct,
              initialSeedNotionalUsd: seedNotionalUsd,
            }),
            lastPlanError: null,
            lastPlanVersion: executionExchange === "paper" ? "python-v1-seed" : "python-v1-seed-submitted"
          });
          currentStateJson = persistedSeedStateJson;
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_APPLIED",
            message: executionExchange === "paper" ? "grid_initial_seed_executed" : "grid_initial_seed_submitted",
            meta: buildGridExecutionMeta({
              stage: executionExchange === "paper" ? "plan_applied_initial_seed" : "plan_applied_initial_seed_submitted",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              extra: {
                seedPct,
                seedSide: seedPositionSide,
                seedQty,
                seedNotionalUsd,
                markPrice,
                seedSubmitOrderId: seedSubmitResult?.orderId ?? null,
                seedSubmitTxHash: seedSubmitResult?.txHash ?? null,
                initialSeedContext
              }
            })
          });
        } catch (error) {
          const reason = `grid_initial_seed_failed:${String(error)}`;
          const resolvedExchangeSymbol = await resolveExchangeSymbolForDiagnostics(adapter, ctx.bot.symbol);
          const initialSeedContext = {
            exchange: executionExchange,
            symbol: ctx.bot.symbol,
            exchangeSymbol: resolvedExchangeSymbol,
            side: seedSide,
            positionSide: seedPositionSide,
            qty: seedQty,
            markPrice,
            priceSource: adapterMarkPriceDiagnostic?.priceSource ?? (readMarkPrice(signal) ? "signal" : null),
            placeOrderError: String(error)
          };
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: withGridHealthState({
              ...currentStateJson,
              initialSeedFailedAt: ctx.now.toISOString(),
              initialSeedLastError: String(error),
              initialSeedLastContext: initialSeedContext
            }, {
              code: "seed_failed",
              severity: "error",
              reason,
              details: {
                seedSide: seedPositionSide,
                seedQty,
                markPrice
              },
              now: ctx.now
            }),
            metricsJson: mergeCurrentMetrics({
              positionSnapshot: {
                side: plannerPosition?.side ?? null,
                qty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
                entryPrice: Number.isFinite(Number(plannerPosition?.entryPrice)) ? Number(plannerPosition?.entryPrice) : null,
                markPrice
              }
            }),
            lastPlanError: reason,
            lastPlanVersion: "python-v1-seed"
          });
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_BLOCKED",
            message: "grid initial seed failed",
            meta: buildGridExecutionMeta({
              stage: "plan_blocked_initial_seed",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              reason,
              error,
              extra: {
                seedPct,
                seedMarginUsd,
                seedNotionalUsdRaw,
                seedQty,
                ...initialSeedContext
              }
            })
          });
          return buildModeBlockedResult(signal, reason, {
            mode: "futures_grid",
            preserveReason: true
          });
        }
      }

      if (currentStateJson.initialSeedPending === true && !hasOpenPlannerPosition(plannerPosition)) {
        const reason = "grid_initial_seed_confirmation_pending";
        let pendingSeedContext = asRecord(currentStateJson.initialSeedLastContext);
        if (executionExchange !== "paper" && adapter && shouldRefreshInitialSeedConfirmationDiagnostics(currentStateJson, ctx.now)) {
          const previousSubmitResult = asRecord(pendingSeedContext?.submitResult);
          pendingSeedContext = await collectInitialSeedDiagnostics({
            adapter,
            symbol: ctx.bot.symbol,
            executionExchange,
            tradeState,
            openOrdersCount: openOrders.length,
            currentStateJson,
            now: ctx.now,
            submitResult: previousSubmitResult
              ? {
                  status:
                    String(previousSubmitResult.status ?? "").trim() === "confirmed"
                      ? "confirmed"
                      : String(previousSubmitResult.status ?? "").trim() === "failed"
                        ? "failed"
                        : "pending_timeout",
                  submitted: previousSubmitResult.submitted !== false,
                  confirmationSource:
                    String(previousSubmitResult.confirmationSource ?? "").trim() === "receipt"
                      ? "receipt"
                      : String(previousSubmitResult.confirmationSource ?? "").trim() === "venue_ack"
                        ? "venue_ack"
                        : "none",
                  receiptStatus:
                    String(previousSubmitResult.receiptStatus ?? "").trim() === "success"
                      ? "success"
                      : String(previousSubmitResult.receiptStatus ?? "").trim() === "reverted"
                        ? "reverted"
                        : "unknown",
                  orderId: typeof previousSubmitResult.orderId === "string"
                    ? String(previousSubmitResult.orderId)
                    : undefined,
                  candidateOrderId: typeof previousSubmitResult.candidateOrderId === "string"
                    ? String(previousSubmitResult.candidateOrderId)
                    : undefined,
                  txHash: typeof previousSubmitResult.txHash === "string"
                    ? String(previousSubmitResult.txHash)
                    : undefined
                }
              : null,
            orderRequest: asRecord(pendingSeedContext?.orderRequest),
            priceSource: typeof pendingSeedContext?.priceSource === "string" ? pendingSeedContext.priceSource : null,
            stage: "confirmation_pending"
          });
          currentStateJson = {
            ...currentStateJson,
            initialSeedLastContext: pendingSeedContext,
            initialSeedLastConfirmationCheckAt: ctx.now.toISOString()
          };
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: currentStateJson,
            lastPlanError: reason,
            lastPlanVersion: "python-v1-seed-confirmation-pending"
          });
        }
        const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
        if (botVaultId) {
          const terminalSeedOrder = await findLatestBotOrderSince({
            botVaultId,
            since: String(currentStateJson.initialSeedAt ?? "").trim() || null,
            statuses: ["REJECTED", "EXPIRED", "CANCELED"]
          });
          if (terminalSeedOrder) {
            pendingSeedContext = {
              ...(pendingSeedContext ?? {}),
              terminalOrderStatus: terminalSeedOrder.status,
              terminalOrderAt: terminalSeedOrder.createdAt,
              terminalOrderClientOrderId: terminalSeedOrder.clientOrderId,
              terminalOrderExchangeOrderId: terminalSeedOrder.exchangeOrderId,
              terminalOrderMetadata: terminalSeedOrder.metadata ?? undefined
            };
          }
        }
        if (shouldRetryInitialSeedSubmission({
          currentStateJson,
          plannerPosition,
          pendingSeedContext,
          now: ctx.now
        })) {
          const retryReason = String(pendingSeedContext?.terminalOrderStatus ?? "").trim().toLowerCase()
            ? `terminal_order_${String(pendingSeedContext?.terminalOrderStatus ?? "").trim().toLowerCase()}`
            : "missing_confirmable_order";
          currentStateJson = {
            ...currentStateJson,
            initialSeedPending: false,
            initialSeedNeedsReseed: true,
            initialSeedRetryScheduledAt: ctx.now.toISOString(),
            initialSeedRetryReason: retryReason,
            initialSeedLastContext: pendingSeedContext ?? currentStateJson.initialSeedLastContext
          };
          seedPending = false;
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: withGridHealthState(currentStateJson, {
              code: "running_unseeded",
              severity: "warning",
              reason,
              details: {
                pendingSeedConfirmation: true
              },
              now: ctx.now
            }),
            metricsJson: mergeCurrentMetrics({
              initialSeedPending: false,
              initialSeedExecuted: false
            }),
            lastPlanError: null,
            lastPlanVersion: "python-v1-seed-retry-scheduled"
          });
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_APPLIED",
            message: "grid_initial_seed_retry_scheduled",
            meta: buildGridExecutionMeta({
              stage: "plan_applied_initial_seed_retry_scheduled",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              extra: {
                initialSeedContext: pendingSeedContext ?? undefined
              }
            })
          });
        } else {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_BLOCKED",
          message: reason,
          meta: buildGridExecutionMeta({
            stage: "plan_blocked_initial_seed_confirmation",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason,
            extra: {
              initialSeedContext: pendingSeedContext ?? undefined
            }
          })
        });
        return buildModeBlockedResult(signal, reason, {
          mode: "futures_grid",
          preserveReason: true
        });
        }
      }

      const plannerPayload = buildGridPlanRequest({
        instance,
        markPrice,
        openOrders,
        position: plannerPosition,
        stateJson: currentStateJson,
        fillEvents: plannerFillResolution.plannerFillEvents,
        venueConstraints: {
          minQty,
          qtyStep,
          priceTick,
          minNotional,
          feeRate
        },
        feeBufferPct,
        mmrPct,
        liqDistanceMinPct
      });

      let plan;
      try {
        plan = await runGridPlan(plannerPayload);
      } catch (error) {
        const reason = `grid_planner_unavailable:${String(error)}`;
        const plannerUnavailableSignature = (() => {
          const lower = reason.toLowerCase();
          if (lower.includes("circuit open")) return "GRID_PLANNER_UNAVAILABLE:circuit_open";
          if (lower.includes("fetch failed")) return "GRID_PLANNER_UNAVAILABLE:fetch_failed";
          if (lower.includes("timeout")) return "GRID_PLANNER_UNAVAILABLE:timeout";
          return `GRID_PLANNER_UNAVAILABLE:${reason}`;
        })();
        await Promise.allSettled([
          updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: instance.state === "running" ? "running" : instance.state,
            stateJson: withGridHealthState({
              ...currentStateJson,
              plannerUnavailableAt: ctx.now.toISOString(),
              plannerUnavailableReason: reason
            }, {
              code: "planner_unavailable",
              severity: "warning",
              reason,
              now: ctx.now
            }),
            lastPlanError: reason
          }),
          ...(shouldThrottleGridNoiseRiskEvent(ctx.bot.id, plannerUnavailableSignature, ctx.now)
              ? []
              : [writeRiskEventFn({
                botId: ctx.bot.id,
                type: "GRID_PLANNER_UNAVAILABLE",
                message: reason,
                meta: buildGridExecutionMeta({
                  stage: "planner_unavailable",
                  symbol: ctx.bot.symbol,
                  instanceId: instance.id,
                  reason,
                  extra: {
                    strategyKey: ctx.bot.strategyKey
                  }
                })
              })])
        ]);
        return buildModeBlockedResult(signal, reason, {
          mode: "futures_grid",
          preserveReason: true
        });
      }

      const riskRow = asRecord(plan.risk) ?? {};
      const entryBlockedByLiq = riskRow.entryBlockedByLiq === true;
      const entryBlockedByMinInvestment = riskRow.entryBlockedByMinInvestment === true;
      const marginMode = instance.marginMode === "AUTO" ? "AUTO" : "MANUAL";
      const autoMarginConfigured = marginMode === "AUTO" && instance.marginPolicy === "AUTO_ALLOWED";
      let updatedExtraMarginUsd = Number(instance.extraMarginUsd ?? 0);
      let updatedAutoMarginUsedUSDT = Number(instance.autoMarginUsedUSDT ?? 0);
      let updatedLastAutoMarginAt = instance.lastAutoMarginAt ?? null;
      let autoMarginAddedUSDT = 0;
      let autoMarginBlockedReason: string | null = null;
      const riskLiqDistance = Number(riskRow.worstCaseLiqDistancePct ?? NaN);

      if (autoMarginConfigured) {
        if (!supportedAutoMarginExchanges.has(exchangeKey)) {
          autoMarginBlockedReason = "unsupported_exchange";
        } else if (!adapter || typeof (adapter as any).addPositionMargin !== "function") {
          autoMarginBlockedReason = "adapter_missing_add_margin";
        } else {
          const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
          const vaultBalanceSnapshot = await readVaultBalanceSnapshot({
            adapter,
            cacheIdentity: botVaultId || instance.id,
            symbol: ctx.bot.symbol,
            now: ctx.now
          });
          if (!vaultBalanceSnapshot.usableForSizing) {
            autoMarginBlockedReason = `vault_balance_snapshot_invalid:${vaultBalanceSnapshot.issues.join(",") || "unknown"}`;
          } else {
          const triggerType = instance.autoMarginTriggerType ?? "LIQ_DISTANCE_PCT_BELOW";
          const triggerValue = Number.isFinite(Number(instance.autoMarginTriggerValue))
            ? Number(instance.autoMarginTriggerValue)
            : autoMarginDefaultTriggerPct;
          let triggerActive = false;
          if (triggerType === "LIQ_DISTANCE_PCT_BELOW") {
            triggerActive = Number.isFinite(riskLiqDistance) && riskLiqDistance < triggerValue;
          } else {
            const marginRatio = computeMarginRatio({
              equity: vaultBalanceSnapshot.equityUsd ?? undefined,
              availableMargin: vaultBalanceSnapshot.availableMarginUsd ?? undefined
            });
            triggerActive = marginRatio !== null && marginRatio > triggerValue;
          }

          if (triggerActive) {
            const cooldownSec = Number.isFinite(Number(instance.autoMarginCooldownSec)) ? Number(instance.autoMarginCooldownSec) : 300;
            const nowMs = ctx.now.getTime();
            const lastAutoMarginMs = updatedLastAutoMarginAt instanceof Date ? updatedLastAutoMarginAt.getTime() : 0;
            if (lastAutoMarginMs > 0 && cooldownSec > 0 && nowMs - lastAutoMarginMs < cooldownSec * 1000) {
              autoMarginBlockedReason = "cooldown_active";
            } else {
              const maxCap = Math.max(0, Number(instance.autoMarginMaxUSDT ?? 0));
              const remainingCap = Math.max(0, maxCap - updatedAutoMarginUsedUSDT);
              if (remainingCap <= 0) {
                autoMarginBlockedReason = "cap_reached";
              } else {
                const availableMargin = Number.isFinite(Number(vaultBalanceSnapshot.availableMarginUsd))
                  ? Math.max(0, Number(vaultBalanceSnapshot.availableMarginUsd))
                  : Number.POSITIVE_INFINITY;
                const step = Number.isFinite(Number(instance.autoMarginStepUSDT))
                  ? Math.max(0, Number(instance.autoMarginStepUSDT))
                  : 25;
                const topUpAmount = Math.max(0, Math.min(step, remainingCap, availableMargin));
                if (!Number.isFinite(topUpAmount) || topUpAmount <= 0) {
                  autoMarginBlockedReason = "no_collateral_or_cap";
                } else {
                  try {
                    await (adapter as any).addPositionMargin({
                      symbol: ctx.bot.symbol,
                      amountUsd: topUpAmount,
                      marginMode: "cross"
                    });
                    autoMarginAddedUSDT = topUpAmount;
                    updatedExtraMarginUsd = Number((updatedExtraMarginUsd + topUpAmount).toFixed(6));
                    updatedAutoMarginUsedUSDT = Number((updatedAutoMarginUsedUSDT + topUpAmount).toFixed(6));
                    updatedLastAutoMarginAt = ctx.now;
                    await writeRiskEventFn({
                      botId: ctx.bot.id,
                      type: "GRID_AUTO_MARGIN_ADDED",
                      message: "auto margin added",
                      meta: buildGridExecutionMeta({
                        stage: "auto_margin_added",
                        symbol: ctx.bot.symbol,
                        instanceId: instance.id,
                        extra: {
                          addedUSDT: topUpAmount,
                          usedUSDT: updatedAutoMarginUsedUSDT,
                          maxUSDT: maxCap,
                          triggerType,
                          triggerValue,
                          liqDistancePct: Number.isFinite(riskLiqDistance) ? riskLiqDistance : null
                        }
                      })
                    });
                  } catch (error) {
                    autoMarginBlockedReason = `add_margin_failed:${String(error)}`;
                  }
                }
              }
            }
          }
          }
        }
      }

      const autoMarginRiskBlocked = Boolean(
        autoMarginBlockedReason
        && autoMarginBlockedReason !== "unsupported_exchange"
        && autoMarginBlockedReason !== "adapter_missing_add_margin"
      );
      const riskBlockingActive = entryBlockedByLiq || entryBlockedByMinInvestment || autoMarginRiskBlocked;
      const hasOpenPosition = Boolean(
        plannerPayload.position
        && Number.isFinite(Number(plannerPayload.position.qty))
        && Number(plannerPayload.position.qty) > 0
      );
      const riskFilteredIntents = filterGridIntentsForRiskGate({
        intents: plan.intents,
        currentStateJson,
        openOrdersCount: openOrders.length,
        hasOpenPosition,
        entryBlockedByLiq,
        entryBlockedByMinInvestment,
        autoMarginRiskBlocked
      });
      const gatedIntents = botVaultState === "close_only"
        ? riskFilteredIntents.filter(
            (intent) =>
              intent.type === "cancel_order"
              || intent.type === "set_protection"
              || intent.reduceOnly === true
          )
        : riskFilteredIntents;
      const hasFreshGridFills = Boolean(prePlanFillSyncSummary && prePlanFillSyncSummary.inserted > 0);
      const stabilizedGridIntents = stabilizeHyperliquidVaultGridIntents({
        intents: gatedIntents,
        isHyperliquidVault: isHyperliquidV2Vault || isHyperliquidV3Vault,
        botVaultState,
        hasFreshGridFills,
        openOrders
      });

      if (autoMarginBlockedReason && autoMarginRiskBlocked) {
        const autoMarginBlockedSignature = `GRID_AUTO_MARGIN_BLOCKED:${marginMode}:${autoMarginBlockedReason}`;
        if (!shouldThrottleGridNoiseRiskEvent(ctx.bot.id, autoMarginBlockedSignature, ctx.now)) {
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_AUTO_MARGIN_BLOCKED",
            message: "auto margin policy blocked entries",
            meta: buildGridExecutionMeta({
              stage: "auto_margin_blocked",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              reason: autoMarginBlockedReason,
              extra: {
                marginMode,
                exchange: exchangeKey,
                autoMarginUsedUSDT: updatedAutoMarginUsedUSDT,
                autoMarginMaxUSDT: instance.autoMarginMaxUSDT
              }
            })
          });
        }
      }

      if (riskBlockingActive) {
        const planBlockedSignature = [
          "GRID_PLAN_BLOCKED",
          entryBlockedByLiq ? "liq" : "no_liq",
          entryBlockedByMinInvestment ? "min_invest" : "no_min_invest",
          autoMarginRiskBlocked ? `auto:${autoMarginBlockedReason ?? "unknown"}` : "no_auto"
        ].join(":");
        if (!shouldThrottleGridNoiseRiskEvent(ctx.bot.id, planBlockedSignature, ctx.now)) {
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_BLOCKED",
            message: "grid entry intents blocked by risk gate",
            meta: buildGridExecutionMeta({
              stage: "plan_blocked_risk_gate",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              reason: autoMarginBlockedReason,
              extra: {
                entryBlockedByLiq,
                entryBlockedByMinInvestment,
                entryBlockedByAutoMargin: autoMarginRiskBlocked,
                autoMarginNonBlocking:
                  autoMarginBlockedReason === "unsupported_exchange"
                  || autoMarginBlockedReason === "adapter_missing_add_margin",
                autoMarginBlockedReason,
                droppedIntents: Math.max(0, plan.intents.length - gatedIntents.length),
                risk: riskRow
              }
            })
          });
        }
      }

      const placeIntents = stabilizedGridIntents.filter((intent) => intent.type === "place_order");
      const replaceIntents = stabilizedGridIntents.filter((intent) => intent.type === "replace_order");
      const cancelIntents = stabilizedGridIntents.filter((intent) => intent.type === "cancel_order");
      const protectionIntents = stabilizedGridIntents.filter((intent) => intent.type === "set_protection");
      const orderIntents = [...replaceIntents, ...placeIntents];
      const gridOrderBatchSize = readEnvNumber("GRID_ORDER_BATCH_SIZE", 48, 1, 200);
      const delegatedResults: ExecutionResult[] = [];
      let terminalIntentHit: "tp" | "sl" | null = null;

      const executeCancelIntent = async (cancelIntent: GridPlannerIntent): Promise<ExecutionResult> => {
        const clientOrderId = String(cancelIntent.clientOrderId ?? "").trim();
        const exchangeOrderId = String(cancelIntent.exchangeOrderId ?? "").trim();
        const matchedOpenOrder = openOrders.find((row) =>
          (clientOrderId && String(row.clientOrderId ?? "").trim() === clientOrderId)
          || (exchangeOrderId && String(row.exchangeOrderId ?? "").trim() === exchangeOrderId)
        ) ?? null;
        const resolvedClientOrderId = clientOrderId || String(matchedOpenOrder?.clientOrderId ?? "").trim();
        const existingPendingCancel = findBlockingPendingGridCancel({
          plannerIntent: {
            ...cancelIntent,
            clientOrderId: resolvedClientOrderId || cancelIntent.clientOrderId,
            exchangeOrderId: exchangeOrderId || matchedOpenOrder?.exchangeOrderId || cancelIntent.exchangeOrderId
          },
          pendingExecutions: listPendingGridExecutions(currentStateJson)
        });
        if (!clientOrderId && !exchangeOrderId) {
          return buildModeNoopResult(signal, "grid_cancel_missing_order_ref", {
            mode: "futures_grid",
            preserveReason: true
          });
        }
        if (existingPendingCancel) {
          return buildModeBlockedResult(signal, "grid_cancel_confirmation_pending:existing_pending_cancel", {
            mode: "futures_grid",
            retryCategory: "unsafe_retry",
            retryReasonCode: "acceptance_unknown",
            clientOrderId: existingPendingCancel.clientOrderId,
            exchangeOrderId: existingPendingCancel.exchangeOrderId
          });
        }
        return executeGridAction({
          action: "cancel_order",
          intent: signal.legacyIntent,
          executionPath: executionExchange === "paper" ? "paper" : "direct_adapter",
          execute: async () => {
            try {
              if (executionExchange === "paper") {
                await cancelPaperOrderForRunner({
                  exchangeAccountId: ctx.bot.exchangeAccountId,
                  orderId: exchangeOrderId || null,
                  clientOrderId: clientOrderId || null
                });
              } else if (adapter && exchangeOrderId) {
                const adapterAny = adapter as any;
                let cancelResult: CancelOrderResult | null = null;
                if (typeof adapterAny.cancelOrderByParams === "function") {
                  cancelResult = await adapterAny.cancelOrderByParams({
                    orderId: exchangeOrderId,
                    symbol: ctx.bot.symbol
                  });
                } else {
                  cancelResult = await adapter.cancelOrder(exchangeOrderId);
                }
                if (cancelResult && !isConfirmedFuturesActionResult(cancelResult)) {
                  const cancelError = cancelResult.errorMessage ?? cancelResult.errorCode ?? cancelResult.status;
                  if (resolvedClientOrderId) {
                    currentStateJson = upsertPendingGridExecution(currentStateJson, {
                      ...createPendingGridExecution({
                        clientOrderId: resolvedClientOrderId,
                        actionType: "cancel_order",
                        symbol: ctx.bot.symbol,
                        side: cancelIntent.side === "sell" ? "sell" : matchedOpenOrder?.side === "sell" ? "sell" : "buy",
                        orderType:
                          Number.isFinite(Number(cancelIntent.price)) && Number(cancelIntent.price) > 0
                            ? "limit"
                            : matchedOpenOrder?.price
                              ? "limit"
                              : "market",
                        qty: cancelIntent.qty ?? matchedOpenOrder?.qty ?? null,
                        price: cancelIntent.price ?? matchedOpenOrder?.price ?? null,
                        reduceOnly: cancelIntent.reduceOnly === true || matchedOpenOrder?.reduceOnly === true,
                        gridLeg: matchedOpenOrder?.gridLeg === "short" ? "short" : "long",
                        gridIndex: Math.max(0, Math.trunc(Number(matchedOpenOrder?.gridIndex ?? cancelIntent.gridIndex ?? 0))),
                        intentType:
                          matchedOpenOrder?.intentType === "tp"
                          || matchedOpenOrder?.intentType === "sl"
                          || matchedOpenOrder?.intentType === "rebalance"
                            ? matchedOpenOrder.intentType
                            : matchedOpenOrder?.reduceOnly === true || cancelIntent.reduceOnly === true
                              ? "rebalance"
                              : "entry",
                        executionExchange,
                        now: ctx.now
                      }),
                      exchangeOrderId: exchangeOrderId || String(matchedOpenOrder?.exchangeOrderId ?? "").trim() || null,
                      retryCategory: "unsafe_retry",
                      status: "pending_confirmation",
                      lastError: `grid_cancel_confirmation_pending:${cancelError}`,
                      lastAttemptAt: ctx.now.toISOString()
                    });
                    await persistCurrentStateJson();
                  }
                  if (
                    executionExchange === "hyperliquid"
                    && String(ctx.bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
                    && String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim()
                  ) {
                    const pendingCancelBotVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
                    getOrCreateHyperliquidExecutionMonitor(`bot_vault_v3:${pendingCancelBotVaultId}`).recordCancelRequested({
                      clientOrderId: resolvedClientOrderId || null,
                      exchangeOrderId: exchangeOrderId || String(matchedOpenOrder?.exchangeOrderId ?? "").trim() || null,
                      now: ctx.now
                    });
                  }
                  return {
                    status: "blocked",
                    reason: `grid_cancel_confirmation_pending:${cancelError}`,
                    metadata: {
                      retryCategory: "unsafe_retry",
                      retryReasonCode: "acceptance_unknown",
                      txHash: cancelResult.txHash ?? null
                    }
                  };
                }
              }
              if (resolvedClientOrderId) {
                currentStateJson = clearPendingGridExecution(currentStateJson, resolvedClientOrderId);
                await persistCurrentStateJson();
              }
              await updateGridBotOrderMapStatus({
                instanceId: instance.id,
                clientOrderId: resolvedClientOrderId || null,
                exchangeOrderId: exchangeOrderId || null,
                status: "canceled"
              });
              const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
              if (
                executionExchange === "hyperliquid"
                && String(ctx.bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
                && botVaultId
              ) {
                getOrCreateHyperliquidExecutionMonitor(`bot_vault_v3:${botVaultId}`).recordCancelRequested({
                  clientOrderId: resolvedClientOrderId || null,
                  exchangeOrderId: exchangeOrderId || null,
                  now: ctx.now
                });
              }
              await writeBotOrderDualWrite({
                botVaultId: ctx.bot.botVaultExecution?.botVaultId,
                exchange: executionExchange,
                symbol: ctx.bot.symbol,
                clientOrderId: resolvedClientOrderId || null,
                exchangeOrderId: exchangeOrderId || null,
                side: cancelIntent.side === "sell" ? "sell" : "buy",
                orderType: Number.isFinite(Number(cancelIntent.price)) && Number(cancelIntent.price) > 0 ? "limit" : "market",
                price: cancelIntent.price ?? null,
                qty: cancelIntent.qty ?? null,
                reduceOnly: cancelIntent.reduceOnly === true,
                status: "CANCELED",
                metadata: {
                  source: "runner_grid_cancel",
                  gridLeg: cancelIntent.gridLeg ?? null,
                  gridIndex: cancelIntent.gridIndex ?? null
                }
              });
              return {
                status: "executed",
                reason: "grid_cancel_executed",
                orderIds: exchangeOrderId ? [exchangeOrderId] : []
              };
            } catch (error) {
              return {
                status: "blocked",
                reason: `grid_cancel_failed:${String(error)}`
              };
            }
          }
        });
      };

      for (const cancelIntent of cancelIntents.slice(0, gridOrderBatchSize)) {
        delegatedResults.push(await executeCancelIntent(cancelIntent));
      }

      let remainingOrderBudget = Math.max(0, gridOrderBatchSize - Math.min(cancelIntents.length, gridOrderBatchSize));
      for (const rawPlannerIntent of [...replaceIntents, ...placeIntents].slice(0, remainingOrderBudget)) {
        const plannerIntent = normalizeGridOrderIntentForVenueConstraints({
          plannerIntent: rawPlannerIntent,
          minQty,
          qtyStep,
          minNotional
        });
        if (!plannerIntent) continue;
        const blockingPendingCancel = findBlockingPendingGridCancel({
          plannerIntent,
          pendingExecutions: listPendingGridExecutions(currentStateJson)
        });
        if (blockingPendingCancel) {
          delegatedResults.push(buildModeBlockedResult(signal, "grid_replace_waiting_cancel_confirmation", {
            mode: "futures_grid",
            retryCategory: "unsafe_retry",
            retryReasonCode: "acceptance_unknown",
            clientOrderId: blockingPendingCancel.clientOrderId,
            exchangeOrderId: blockingPendingCancel.exchangeOrderId
          }));
          continue;
        }
        if (plannerIntent.type === "replace_order") {
          const cancelResult = await executeCancelIntent({
            ...plannerIntent,
            type: "cancel_order"
          });
          delegatedResults.push(cancelResult);
          if (cancelResult.status === "blocked") continue;
        }
        const mappedIntent = toOrderIntentFromPlanner(ctx.bot.symbol, plannerIntent);
        if (!mappedIntent) continue;
        const hasSlPrice = toPositiveNumberOrNull(plannerIntent.slPrice) !== null;
        const hasTpPrice = toPositiveNumberOrNull(plannerIntent.tpPrice) !== null;
        const clientOrderId = String(plannerIntent.clientOrderId ?? "").trim();
        const pendingIntentType = plannerIntent.reduceOnly
          ? (hasSlPrice ? "sl" : hasTpPrice ? "tp" : "rebalance")
          : "entry";
        const blockedResubmitReason = resolveGridOrderResubmitGuardReason({
          currentStateJson,
          clientOrderId
        });
        if (blockedResubmitReason) {
          const guard = getGridOrderResubmissionGuard(currentStateJson, clientOrderId);
          currentStateJson = {
            ...currentStateJson,
            orderResubmitGuard: {
              clientOrderId,
              reason: blockedResubmitReason,
              orphanCount: guard?.orphanCount ?? null,
              blockedAt: guard?.blockedAt ?? ctx.now.toISOString(),
              updatedAt: ctx.now.toISOString()
            }
          };
          await persistCurrentStateJson();
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_BLOCKED",
            message: blockedResubmitReason,
            meta: buildGridExecutionMeta({
              stage: "order_resubmit_guard",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              reason: blockedResubmitReason,
              extra: {
                clientOrderId,
                orphanCount: guard?.orphanCount ?? null,
                blockedAt: guard?.blockedAt ?? null
              }
            })
          });
          delegatedResults.push(buildModeBlockedResult(signal, blockedResubmitReason, {
            mode: "futures_grid",
            preserveReason: true,
            clientOrderId,
            orphanCount: guard?.orphanCount ?? null,
            blockedAt: guard?.blockedAt ?? null
          }));
          continue;
        }
        if (clientOrderId) {
          currentStateJson = upsertPendingGridExecution(currentStateJson, createPendingGridExecution({
            clientOrderId,
            symbol: ctx.bot.symbol,
            side: plannerIntent.side === "sell" ? "sell" : "buy",
            orderType: Number.isFinite(Number(plannerIntent.price)) && Number(plannerIntent.price) > 0 ? "limit" : "market",
            qty: plannerIntent.qty ?? null,
            price: plannerIntent.price ?? null,
            reduceOnly: plannerIntent.reduceOnly === true,
            gridLeg: plannerIntent.gridLeg === "short" ? "short" : "long",
            gridIndex: Math.max(0, Math.trunc(Number(plannerIntent.gridIndex ?? 0))),
            intentType: pendingIntentType,
            executionExchange,
            now: ctx.now
          }));
          await persistCurrentStateJson();
        }
        let delegated: ExecutionResult;
        if (executionExchange === "paper") {
          delegated = await executeGridAction({
            action: mappedIntent.order?.reduceOnly === true ? "close_position" : "place_order",
            intent: mappedIntent,
            executionPath: "paper",
            execute: async () => {
              try {
                const order = mappedIntent.order ?? {};
                const fillPriceRaw = Number(order.price ?? markPrice ?? NaN);
                const fillPrice = Number.isFinite(fillPriceRaw) && fillPriceRaw > 0 ? fillPriceRaw : markPrice;
                if (order.type === "limit") {
                  const qty = Number(order.qty ?? NaN);
                  if (!Number.isFinite(qty) || qty <= 0) {
                    return {
                      status: "blocked",
                      reason: "paper_invalid_qty"
                    };
                  }
                  const placed = await placePaperLimitOrderForRunner({
                    exchangeAccountId: ctx.bot.exchangeAccountId,
                    symbol: ctx.bot.symbol,
                    side: mappedIntent.side === "long" ? "buy" : "sell",
                    qty,
                    price: fillPrice,
                    reduceOnly: order.reduceOnly === true,
                    clientOrderId: clientOrderId || null
                  });
                  return {
                    status: "executed",
                    reason: "grid_paper_limit_order_open",
                    orderIds: placed.orderId ? [placed.orderId] : []
                  };
                }

                if (order.reduceOnly === true) {
                  const closed = await closePaperPositionForRunner({
                    exchangeAccountId: ctx.bot.exchangeAccountId,
                    symbol: ctx.bot.symbol,
                    fillPrice
                  });
                  if (!closed.orderId || closed.closedQty <= 0) {
                    return {
                      status: "noop",
                      reason: "reduce_only_no_position"
                    };
                  }
                  return {
                    status: "executed",
                    reason: "grid_paper_close_executed",
                    orderIds: [closed.orderId]
                  };
                }

                const qty = Number(order.qty ?? NaN);
                if (!Number.isFinite(qty) || qty <= 0) {
                  return {
                    status: "blocked",
                    reason: "paper_invalid_qty"
                  };
                }
                const takeProfitPrice = toPositiveNumberOrNull(order.takeProfitPrice);
                const stopLossPrice = toPositiveNumberOrNull(order.stopLossPrice);
                const placed = await placePaperPositionForRunner({
                  exchangeAccountId: ctx.bot.exchangeAccountId,
                  symbol: ctx.bot.symbol,
                  side: mappedIntent.side,
                  qty,
                  fillPrice,
                  takeProfitPrice,
                  stopLossPrice
                });
                return {
                  status: "executed",
                  reason: "grid_paper_order_executed",
                  orderIds: placed.orderId ? [placed.orderId] : []
                };
              } catch (error) {
                const retry = categorizeExecutionRetry({
                  executionExchange,
                  error
                });
                return {
                  status: "blocked",
                  reason: `paper_place_order_failed:${String(error)}`,
                  metadata: {
                    retryCategory: retry.category,
                    retryReasonCode: retry.reasonCode
                  }
                };
              }
            }
          });
        } else if (!adapter) {
          delegated = await executeGridAction({
            action: mappedIntent.order?.reduceOnly === true ? "close_position" : "place_order",
            intent: mappedIntent,
            executionPath: "direct_adapter",
            execute: async () => ({
              status: "blocked",
              reason: "adapter_unavailable"
            })
          });
        } else {
          delegated = await executeGridAction({
            action: mappedIntent.order?.reduceOnly === true ? "close_position" : "place_order",
            intent: mappedIntent,
            executionPath: "direct_adapter",
            execute: async () => {
              try {
                const placed = await executeMappedIntentViaAdapter({
                  adapter,
                  botSymbol: ctx.bot.symbol,
                  intent: mappedIntent,
                  clientOrderId
                });
                if (!isConfirmedPlaceOrderResult(placed)) {
                  const placeError = placed.errorMessage ?? placed.errorCode ?? placed.status;
                  return {
                    status: "blocked",
                    reason: `adapter_place_order_pending:${placeError}`,
                    metadata: {
                      retryCategory: placed.submitted ? "unsafe_retry" : "manual_intervention_required",
                      retryReasonCode: placed.submitted ? "acceptance_unknown" : "retry_not_safe",
                      txHash: placed.txHash ?? null,
                      candidateOrderId: placed.candidateOrderId ?? null
                    }
                  };
                }
                return {
                  status: "executed",
                  reason: "grid_adapter_executed",
                  orderIds: placed.orderId ? [placed.orderId] : []
                };
              } catch (error) {
                if (mappedIntent.order?.reduceOnly === true && isNoPositionToCloseError(error)) {
                  return {
                    status: "noop",
                    reason: "reduce_only_no_position"
                  };
                }
                const raw = String(error);
                const retry = categorizeExecutionRetry({
                  executionExchange,
                  error
                });
                return {
                  status: "blocked",
                  reason: /unknown symbol|symbolunknown/i.test(raw)
                    ? `symbol_unknown:${raw}`
                    : `adapter_place_order_failed:${raw}`,
                  metadata: {
                    retryCategory: retry.category,
                    retryReasonCode: retry.reasonCode
                  }
                };
              }
            }
          });
        }

        delegatedResults.push(delegated);
        if (
          delegated.status === "executed"
          && plannerIntent.reduceOnly === true
          && (hasTpPrice || hasSlPrice)
        ) {
          terminalIntentHit = hasSlPrice ? "sl" : "tp";
        }

        const retryCategory = String(delegated.metadata.retryCategory ?? "").trim() as ExecutionRetryCategory | "";
        if (delegated.status === "executed" && clientOrderId) {
          const firstOrderId = Array.isArray(delegated.orderIds) && delegated.orderIds.length > 0
            ? delegated.orderIds[0]
            : null;
          const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
          if (
            executionExchange === "hyperliquid"
            && String(ctx.bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
            && botVaultId
          ) {
            getOrCreateHyperliquidExecutionMonitor(`bot_vault_v3:${botVaultId}`).recordSubmittedOrder({
              clientOrderId,
              exchangeOrderId: firstOrderId,
              symbol: ctx.bot.symbol,
              side: plannerIntent.side === "sell" ? "sell" : "buy",
              orderType: Number.isFinite(Number(plannerIntent.price)) && Number(plannerIntent.price) > 0 ? "limit" : "market",
              price: plannerIntent.price ?? null,
              qty: plannerIntent.qty ?? null,
              reduceOnly: plannerIntent.reduceOnly === true,
              now: ctx.now,
              metadata: {
                source: "runner_grid_plan",
                gridLeg: plannerIntent.gridLeg ?? null,
                gridIndex: plannerIntent.gridIndex ?? null,
                intentType: pendingIntentType
              }
            });
          }
          await createGridBotOrderMapEntry({
            instanceId: instance.id,
            botId: ctx.bot.id,
            clientOrderId,
            exchangeOrderId: firstOrderId,
            gridLeg: plannerIntent.gridLeg === "short" ? "short" : "long",
            gridIndex: Math.max(0, Math.trunc(Number(plannerIntent.gridIndex ?? 0))),
            intentType: pendingIntentType,
            side: plannerIntent.side === "sell" ? "sell" : "buy",
            price: plannerIntent.price ?? null,
            qty: plannerIntent.qty ?? null,
            reduceOnly: plannerIntent.reduceOnly === true,
            status: "open"
          });
          currentStateJson = recordGridOrderSubmissionAttempt({
            stateJson: clearPendingGridExecution(currentStateJson, clientOrderId),
            clientOrderId,
            exchangeOrderId: firstOrderId,
            now: ctx.now
          });
          await persistCurrentStateJson();
          await writeBotOrderDualWrite({
            botVaultId: ctx.bot.botVaultExecution?.botVaultId,
            exchange: executionExchange,
            symbol: ctx.bot.symbol,
            clientOrderId,
            exchangeOrderId: firstOrderId,
            side: plannerIntent.side === "sell" ? "sell" : "buy",
            orderType: Number.isFinite(Number(plannerIntent.price)) && Number(plannerIntent.price) > 0 ? "limit" : "market",
            price: plannerIntent.price ?? null,
            qty: plannerIntent.qty ?? null,
            reduceOnly: plannerIntent.reduceOnly === true,
            status: "OPEN",
            metadata: {
              source: "runner_grid_plan",
              gridLeg: plannerIntent.gridLeg ?? null,
              gridIndex: plannerIntent.gridIndex ?? null,
              intentType: pendingIntentType
            }
          });
        } else if (clientOrderId && delegated.status !== "executed") {
          if (retryCategory === "unsafe_retry" || retryCategory === "safe_retry") {
            currentStateJson = upsertPendingGridExecution(currentStateJson, {
              ...createPendingGridExecution({
                clientOrderId,
                symbol: ctx.bot.symbol,
                side: plannerIntent.side === "sell" ? "sell" : "buy",
                orderType: Number.isFinite(Number(plannerIntent.price)) && Number(plannerIntent.price) > 0 ? "limit" : "market",
                qty: plannerIntent.qty ?? null,
                price: plannerIntent.price ?? null,
                reduceOnly: plannerIntent.reduceOnly === true,
                gridLeg: plannerIntent.gridLeg === "short" ? "short" : "long",
                gridIndex: Math.max(0, Math.trunc(Number(plannerIntent.gridIndex ?? 0))),
                intentType: pendingIntentType,
                executionExchange,
                now: ctx.now
              }),
              retryCategory,
              lastError: delegated.reason,
              lastAttemptAt: ctx.now.toISOString(),
              exchangeOrderId: null
            });
          } else {
            currentStateJson = clearPendingGridExecution(currentStateJson, clientOrderId);
          }
          await persistCurrentStateJson();
        }
      }

      for (const protectionIntent of protectionIntents) {
        const delegated = await executeGridAction({
          action: "set_protection",
          intent: signal.legacyIntent,
          executionPath: executionExchange === "paper" ? "paper" : "direct_adapter",
          execute: async () => {
            try {
              return await applyGridProtectionIntent({
                executionExchange,
                adapter,
                exchangeAccountId: ctx.bot.exchangeAccountId,
                botSymbol: ctx.bot.symbol,
                plannerIntent: protectionIntent
              });
            } catch (error) {
              const retry = categorizeExecutionRetry({
                executionExchange,
                error
              });
              return {
                status: "blocked",
                reason: `grid_set_protection_failed:${String(error)}`,
                metadata: {
                  retryCategory: retry.category,
                  retryReasonCode: retry.reasonCode
                }
              };
            }
          }
        });
        delegatedResults.push(delegated);
      }

      const planWindowMeta = asRecord(plan.windowMeta) ?? {};
      const currentPositionSnapshot = plannerPosition
        ? {
            side: plannerPosition.side ?? null,
            qty: Number.isFinite(Number(plannerPosition.qty)) ? Number(plannerPosition.qty) : 0,
            entryPrice: Number.isFinite(Number(plannerPosition.entryPrice)) ? Number(plannerPosition.entryPrice) : null,
            markPrice
          }
        : {
            side: null,
            qty: 0,
            entryPrice: null,
            markPrice
          };
      const targetActiveOrders = Number(planWindowMeta.activeOrdersTotal ?? NaN);
      const targetActiveBuys = Number(planWindowMeta.activeBuys ?? NaN);
      const targetActiveSells = Number(planWindowMeta.activeSells ?? NaN);

      await updateGridBotInstancePlannerState({
        instanceId: instance.id,
        state: "running",
        stateJson: withGridHealthState(
          mergeGridExecutionRecoveryState({
            ...plan.nextStateJson,
            ...(plannerFillResolution.latestProcessedFillTs
              ? { lastProcessedGridFillTs: plannerFillResolution.latestProcessedFillTs }
              : {})
          }, currentStateJson),
          null
        ),
        extraMarginUsd: updatedExtraMarginUsd,
        autoMarginUsedUSDT: updatedAutoMarginUsedUSDT,
        lastAutoMarginAt: updatedLastAutoMarginAt,
        metricsJson: mergeCurrentMetrics({
          ...plan.metricsDelta,
          minInvestmentUSDT: riskRow.minInvestmentUSDT ?? plan.metricsDelta.minInvestmentUSDT,
          worstCaseLiqDistancePct: riskRow.worstCaseLiqDistancePct ?? plan.metricsDelta.worstCaseLiqDistancePct,
          liqDistanceMinPct,
          liqEstimateLong: riskRow.liqEstimateLong ?? plan.metricsDelta.liqEstimateLong,
          liqEstimateShort: riskRow.liqEstimateShort ?? plan.metricsDelta.liqEstimateShort,
          windowMeta: planWindowMeta,
          plannedOrders: Number.isFinite(targetActiveOrders) ? targetActiveOrders : openOrders.length,
          openOrdersCount: Number.isFinite(targetActiveOrders) ? targetActiveOrders : openOrders.length,
          activeBuys: Number.isFinite(targetActiveBuys) ? targetActiveBuys : null,
          activeSells: Number.isFinite(targetActiveSells) ? targetActiveSells : null,
          activeOrderWindowSize: instance.activeOrderWindowSize,
          recenterDriftLevels: instance.recenterDriftLevels,
          positionSnapshot: currentPositionSnapshot,
          marginMode,
          autoMarginAddedUSDT,
          autoMarginUsedUSDT: updatedAutoMarginUsedUSDT,
          autoMarginMaxUSDT: instance.autoMarginMaxUSDT ?? null,
          autoMarginBlockedReason: autoMarginBlockedReason ?? null
        }),
        lastPlanError: null,
        lastPlanVersion: "python-v1"
      });

      const recenterReason = String(planWindowMeta.recenterReason ?? "no_change").trim().toLowerCase();
      const windowEventMessage =
        recenterReason === "seed"
          ? "grid_window_seeded"
          : recenterReason === "fill" || recenterReason === "drift"
            ? "grid_window_recentered"
            : "grid_window_no_change";
      const protectionOutcomeEntries = delegatedResults
        .filter((entry) =>
          entry.reason === "grid_adapter_protection_set"
          || entry.reason === "grid_paper_protection_set"
          || entry.reason.startsWith("grid_set_protection_")
        )
        .map((entry) => ({
          status: entry.status,
          reason: entry.reason
        }));
      const protectionExecutedCount = delegatedResults.filter((entry) => entry.reason === "grid_adapter_protection_set" || entry.reason === "grid_paper_protection_set").length;
      const protectionBlockedCount = delegatedResults.filter((entry) => entry.reason.startsWith("grid_set_protection_") && entry.status === "blocked").length;
      const protectionNoopCount = delegatedResults.filter((entry) => entry.reason.startsWith("grid_set_protection_") && entry.status === "noop").length;
      const hasActionablePlanChanges =
        orderIntents.length > 0
        || cancelIntents.length > 0
        || protectionExecutedCount > 0
        || autoMarginAddedUSDT > 0;
      const shouldEmitNoopPlanHeartbeat = !hasActionablePlanChanges
        && windowEventMessage === "grid_window_no_change"
        && shouldThrottleGridNoiseRiskEvent(
          ctx.bot.id,
          `GRID_PLAN_APPLIED:${windowEventMessage}`,
          ctx.now
        ) === false;
      if (hasActionablePlanChanges || windowEventMessage !== "grid_window_no_change" || shouldEmitNoopPlanHeartbeat) {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_PLAN_APPLIED",
          message: windowEventMessage,
          meta: buildGridExecutionMeta({
            stage: "plan_applied",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason: windowEventMessage,
            extra: {
              autoMarginEnabled: instance.autoMarginEnabled,
              allocation: {
                investUsd: instance.investUsd,
                extraMarginUsd: updatedExtraMarginUsd
              },
              marginMode,
              autoMarginAddedUSDT,
              autoMarginBlockedReason,
              reasonCodes: plan.reasonCodes,
              intents: gatedIntents.length,
              ordersPlanned: orderIntents.length,
              cancelsPlanned: cancelIntents.length,
              protectionsPlanned: protectionIntents.length,
              protectionsExecuted: protectionExecutedCount,
              protectionsBlocked: protectionBlockedCount,
              protectionsNoop: protectionNoopCount,
              protectionOutcomes: protectionOutcomeEntries,
              windowMeta: planWindowMeta
            }
          })
        });
      }

      let fillSyncSummary: Awaited<ReturnType<typeof syncGridFillEvents>> | null = null;
      if (adapter && executionExchange !== "paper") {
        try {
          fillSyncSummary = await syncGridFillEvents({
            instance,
            bot: ctx.bot,
            adapter
          });
        } catch {
          fillSyncSummary = null;
        }
      }

      const terminalTpHits = Number(fillSyncSummary?.terminalTpHits ?? 0);
      const terminalSlHits = Number(fillSyncSummary?.terminalSlHits ?? 0);
      const hasTerminalHit = terminalTpHits > 0 || terminalSlHits > 0 || terminalIntentHit !== null;
      if (hasTerminalHit) {
        const archivedReason = terminalSlHits > 0 || terminalIntentHit === "sl" ? "sl_hit_terminal" : "tp_hit_terminal";
        const openOrdersAfter = await listGridBotOpenOrders(instance.id);
        const cancelSummary = await cancelGridOpenOrdersBestEffort({
          adapter,
          openOrders: openOrdersAfter,
          botSymbol: ctx.bot.symbol
        });
        const closeSummary = await closeGridResidualPositionBestEffort({
          executionExchange,
          adapter,
          exchangeAccountId: ctx.bot.exchangeAccountId,
          botSymbol: ctx.bot.symbol,
          markPrice,
          paperMarketDataVenue: paperContext?.linkedMarketData.marketDataVenue ?? null
        });
        const historyClose = await recordTradeExitHistory({
          botId: ctx.bot.id,
          symbol: ctx.bot.symbol,
          now: ctx.now,
          exitPrice: Number.isFinite(Number(markPrice)) ? Number(markPrice) : null,
          outcome: mapGridTerminalOutcome(archivedReason),
          reason: archivedReason,
          orderId: closeSummary.orderId ?? null,
          emitOrphanEvent: false,
          riskEventType: "GRID_TERMINATED",
          buildMeta: ({ stage, symbol, reason, error, extra }) =>
            buildGridExecutionMeta({
              stage,
              symbol,
              instanceId: instance.id,
              reason,
              error,
              extra
            })
        });
        const terminalCloseOutcome = mergeNormalizedCloseOutcomeMetadata(closeSummary, {
          historyClose
        });
        await archiveGridBotInstanceTerminal({
          instanceId: instance.id,
          botId: ctx.bot.id,
          archivedReason,
          runtimeReason: "grid_instance_archived_terminal",
          stateJson: plan.nextStateJson,
          metricsJson: mergeCurrentMetrics({
            ...plan.metricsDelta,
            terminalReason: archivedReason
          }),
          lastPlanError: null
        });
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "GRID_TERMINATED",
          message: "grid terminated by protective exit",
          meta: buildGridExecutionMeta({
            stage: "terminated_protective_exit",
            symbol: ctx.bot.symbol,
            instanceId: instance.id,
            reason: archivedReason,
            extra: {
              terminalTpHits,
              terminalSlHits,
              terminalIntentHit,
              canceledOrders: cancelSummary.canceled,
              cancelErrors: cancelSummary.failed,
              closedResidualPosition: terminalCloseOutcome.closed,
              closeResidualReason: terminalCloseOutcome.reason,
              closeResidualOutcome: terminalCloseOutcome,
              historyClose,
              ...buildExecutionVenueMeta({
                executionVenue: executionExchange,
                marketDataVenue: paperContext?.linkedMarketData.marketDataVenue ?? ctx.bot.marketData.exchange
              })
            }
          })
        });
        return buildModeNoopResult(signal, "grid_terminated", {
          mode: "futures_grid",
          reason: archivedReason,
          terminalTpHits,
          terminalSlHits
        });
      }

      if (delegatedResults.length === 0) {
        return buildModeNoopResult(signal, resolveGridRiskNoopReason({
          riskBlockingActive,
          hasOpenPosition
        }), {
          mode: "futures_grid",
          riskBlocked: riskBlockingActive,
          risk: riskRow,
          currentGridInvestUsd: instance.investUsd,
          currentExtraMarginUsd: updatedExtraMarginUsd,
          plannerReasonCodes: plan.reasonCodes,
          plannedIntents: gatedIntents.length,
          fillSync: fillSyncSummary
        });
      }

      const {
        executedResults,
        protectionBlockedResults,
        blockingResult
      } = summarizeGridDelegatedResults(delegatedResults);
      if (blockingResult) {
        return {
          ...blockingResult,
          reason: `grid_plan_blocked:${blockingResult.reason}`,
          metadata: {
            ...blockingResult.metadata,
            mode: "futures_grid",
            plannerReasonCodes: plan.reasonCodes,
            preserveReason: true
          }
        };
      }

      if (executedResults.length === 0) {
        return buildModeNoopResult(signal, resolveGridRiskNoopReason({
          riskBlockingActive,
          hasOpenPosition
        }), {
          mode: "futures_grid",
          riskBlocked: riskBlockingActive,
          risk: riskRow,
          currentGridInvestUsd: instance.investUsd,
          currentExtraMarginUsd: updatedExtraMarginUsd,
          plannerReasonCodes: plan.reasonCodes,
          plannedIntents: gatedIntents.length,
          delegatedOrders: delegatedResults.length,
          protectionBlocked: protectionBlockedResults.length,
          fillSync: fillSyncSummary
        });
      }

      const orderIds = delegatedResults.flatMap((entry) => entry.orderIds ?? []);

      return {
        status: "executed",
        reason: "grid_plan_executed",
        orderIds: orderIds.length > 0 ? orderIds : undefined,
        metadata: {
          mode: "futures_grid",
          plannerReasonCodes: plan.reasonCodes,
          plannedIntents: plan.intents.length,
          delegatedOrders: delegatedResults.length,
          protectionBlocked: protectionBlockedResults.length,
          fillSync: fillSyncSummary,
          preserveReason: true
        },
        legacy: {
          outcome: "ok",
          intent: signal.legacyIntent,
          gate: delegatedResults[0]?.legacy.gate ?? signal.metadata.gate as any
        }
      };
    }
  };
}

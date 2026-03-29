import type { TradeIntent } from "@mm/futures-core";
import { buildSharedExecutionVenue } from "@mm/futures-engine";
import {
  type SupportedFuturesAdapter
} from "@mm/futures-exchange";
import {
  archiveGridBotInstanceTerminal,
  cancelPaperOrderForRunner,
  closePaperPositionForRunner,
  createGridBotFillEventEntry,
  createGridBotOrderMapEntry,
  listPaperPositionsForRunner,
  listGridBotOpenOrders,
  loadBotTradeState,
  placePaperPositionForRunner,
  placePaperLimitOrderForRunner,
  loadGridBotInstanceByBotId,
  seedGridBotVaultMatchingStateForGridInstance,
  simulatePaperGridLimitFillsForRunner,
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
  mergeGridExecutionRecoveryState,
  recordGridFillSyncRecoveryState,
  reconcileGridOpenOrdersAgainstVenue,
  recoverGridPendingExecutions,
  snapshotVenueOrdersForRecovery,
  upsertPendingGridExecution,
  type ExecutionRetryCategory,
} from "./recovery.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";
const GRID_NOISE_RISK_EVENT_THROTTLE_MS = 120_000;
const GRID_NOISE_RISK_EVENT_CACHE_MAX = 2_000;
const gridNoiseRiskEventCache = new Map<string, number>();

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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
  return {
    status: result.status,
    lastUpdatedAt: result.at,
    liveOpenOrdersCount: result.liveOpenOrders.length,
    trackedOrdersCount: result.orders.length,
    recentFillCount: result.recentFills.length,
    newFillCount: result.newFills.length,
    driftCount: result.drifts.length,
    alertCount: result.alerts.length,
    drifts: result.drifts.slice(0, 10),
    alerts: result.alerts.slice(0, 10),
    statusChanges: result.statusChanges.slice(0, 10),
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

function roundUpToStep(value: number, step: number | null): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step ?? NaN) || !step || step <= 0) return value;
  const ratio = value / step;
  return Math.ceil(ratio - 1e-12) * step;
}

function computeInitialSeedSide(params: {
  mode: "long" | "short" | "neutral" | "cross";
  markPrice: number;
  lowerPrice: number;
  upperPrice: number;
}): "buy" | "sell" {
  if (params.mode === "long") return "buy";
  if (params.mode === "short") return "sell";
  const midpoint = (Number(params.lowerPrice) + Number(params.upperPrice)) / 2;
  return Number(params.markPrice) <= midpoint ? "buy" : "sell";
}

function hasOpenPlannerPosition(position: {
  side?: "long" | "short" | null;
  qty?: number | null;
} | null | undefined): boolean {
  return Boolean(position && Number.isFinite(Number(position.qty)) && Number(position.qty) > 0);
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

export function stabilizeHyperliquidVaultGridIntents(params: {
  intents: GridPlannerIntent[];
  isHyperliquidV2Vault: boolean;
  botVaultState: string;
  hasFreshGridFills: boolean;
  openOrders: Array<{
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
}): GridPlannerIntent[] {
  if (!params.isHyperliquidV2Vault || params.botVaultState !== "active" || params.hasFreshGridFills) {
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
}): Promise<{ orderId: string }> {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  submitResult?: { orderId: string; txHash?: string } | null;
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
  if (params.submitResult?.orderId) {
    diagnostics.submitResult = {
      orderId: params.submitResult.orderId,
      txHash: typeof params.submitResult.txHash === "string" ? params.submitResult.txHash : undefined
    };
  }
  if (params.orderRequest) diagnostics.orderRequest = params.orderRequest;
  if (params.priceSource) diagnostics.priceSource = params.priceSource;
  if (!params.adapter) return diagnostics;

  const exchangeSymbol = await resolveExchangeSymbolForDiagnostics(params.adapter, params.symbol).catch((error) => {
    diagnostics.exchangeSymbolReadError = String(error);
    return null;
  });
  diagnostics.exchangeSymbol = exchangeSymbol;

  const positions = await params.adapter.getPositions().catch((error) => {
    diagnostics.positionsReadError = String(error);
    return null;
  });
  if (positions) {
    diagnostics.positions = summarizeSeedPositions(
      positions.map((row: unknown) => asRecord(row) ?? {}),
      params.symbol
    );
  }

  const adapterAny = params.adapter as any;
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

  const accountState = await params.adapter.getAccountState().catch((error) => {
    diagnostics.accountStateReadError = String(error);
    return null;
  });
  diagnostics.accountState = summarizeSeedAccountState(asRecord(accountState));

  const plannerPositionResolution = await resolvePlannerPositionForExecution({
    adapter: params.adapter,
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
          metricsJson: mergeMetrics(instance.metricsJson, {
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
          const venueOpenOrders = await snapshotVenueOrdersForRecovery(adapter);
          const orderRecovery = reconcileGridOpenOrdersAgainstVenue({
            stateJson: currentStateJson,
            now: ctx.now,
            openOrders,
            venueOrders: venueOpenOrders
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
          if (
            prePlanFillSyncSummary
            || orderRecovery.summary.orphanedCount > 0
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
      const tradeState = await loadBotTradeState({ botId: ctx.bot.id, symbol: ctx.bot.symbol, now: ctx.now });
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
      const botVaultId = String(ctx.bot.botVaultExecution?.botVaultId ?? "").trim();
      const isHyperliquidV3Vault =
        executionExchange === "hyperliquid"
        && String(ctx.bot.botVaultExecution?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3";
      if (adapter && isHyperliquidV3Vault && botVaultId) {
        const reconciliationMonitor = getOrCreateHyperliquidExecutionMonitor(`bot_vault_v3:${botVaultId}`);
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
          now: ctx.now
        }).catch(() => null);
        if (reconciliationResult) {
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
      const minNotional = Number(Math.max(minNotionalFallback, dynamicNotional).toFixed(8));

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
        plannerPositionResolution = await resolvePlannerPositionForExecution({
          adapter,
          symbol: ctx.bot.symbol,
          executionExchange,
          tradeState,
          openOrdersCount: openOrders.length,
          currentStateJson
        });
      }
      let plannerPosition = plannerPositionResolution.position;
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
        const perpToSpotRecordedAt = String(currentStateJson.closeOnlyPerpToSpotDoneAt ?? "").trim();
        const spotToEvmRecordedAt = String(currentStateJson.closeOnlySpotToEvmDoneAt ?? "").trim();
        const settlementReadyAt = String(currentStateJson.closeOnlySettlementReadyAt ?? "").trim();
        const accountState = await adapter.getAccountState().catch(() => null);
        const perpWithdrawableUsd = Math.max(0, Number(accountState?.availableMargin ?? 0));
        const spotBalanceSnapshot = typeof adapterAny.getCoreUsdcSpotBalance === "function"
          ? await adapterAny.getCoreUsdcSpotBalance().catch(() => null)
          : null;
        const spotBalanceUsd = Math.max(0, Number(spotBalanceSnapshot?.amountUsd ?? 0));

        if (!perpToSpotRecordedAt && perpWithdrawableUsd > 0.000001) {
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
            currentStateJson = {
              ...currentStateJson,
              closeOnlyPerpToSpotDoneAt: ctx.now.toISOString(),
              closeOnlyPerpToSpotAmountUsd: perpWithdrawableUsd,
              closeOnlyPerpToSpotLastTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null
            };
            await updateGridBotInstancePlannerState({
              instanceId: instance.id,
              state: "running",
              stateJson: currentStateJson,
              metricsJson: mergeMetrics(instance.metricsJson, {
                closeOnlyPerpToSpotAmountUsd: perpWithdrawableUsd,
                closeOnlyPerpToSpotTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : undefined
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
                settlementPerpToSpotTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null
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

        if (!spotToEvmRecordedAt && spotBalanceUsd > 0.000001) {
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
            await adapterAny.transferUsdcSpotToEvm({
              amountUsd: spotBalanceUsd
            });
            currentStateJson = {
              ...currentStateJson,
              closeOnlySpotToEvmDoneAt: ctx.now.toISOString(),
              closeOnlySpotToEvmAmountUsd: spotBalanceUsd
            };
            await updateGridBotInstancePlannerState({
              instanceId: instance.id,
              state: "running",
              stateJson: currentStateJson,
              metricsJson: mergeMetrics(instance.metricsJson, {
                closeOnlySpotToEvmAmountUsd: spotBalanceUsd
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
                settlementSpotToEvmAmountUsd: spotBalanceUsd
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
        const metricsRecord = asRecord(instance.metricsJson) ?? {};
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
            metricsJson: mergeMetrics(instance.metricsJson, {
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

      if (shouldMarkInitialSeedExecuted({
        currentStateJson,
        plannerPosition
      })) {
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
          metricsJson: mergeMetrics(instance.metricsJson, {
            initialSeedExecuted: true,
            initialSeedQty: Number.isFinite(Number(plannerPosition?.qty)) ? Number(plannerPosition?.qty) : 0,
            initialSeedSide: plannerPosition?.side ?? null,
            initialSeedPct: Number.isFinite(Number(currentStateJson.initialSeedPct))
              ? Number(currentStateJson.initialSeedPct)
              : Number(instance.initialSeedPct ?? 0),
            initialSeedNotionalUsd: confirmedSeedNotionalUsd > 0 ? confirmedSeedNotionalUsd : undefined,
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
      const seedPending = currentStateJson.initialSeedPending === true;
      const initialPerpTransferAmountUsd = readInitialPerpTransferAmountUsd(ctx.bot);

      if (
        isHyperliquidV2Vault
        && adapter
        && !hasOpenPlannerPosition(plannerPosition)
        && initialPerpTransferAmountUsd > 0
      ) {
        const transferAccountState = await adapter.getAccountState().catch(() => null);
        if (!hasPositiveAccountFunding(transferAccountState)) {
          const adapterAny = adapter as any;
          const hasCoreDepositCapability = typeof adapterAny.depositUsdcToHyperCore === "function";
          const hasTransferCapability = typeof adapterAny.transferUsdClass === "function";
          const coreSpotTransferRecordedAt = String(currentStateJson.initialCoreSpotTransferDoneAt ?? "").trim();
          const transferRecordedAt = String(currentStateJson.initialPerpTransferDoneAt ?? "").trim();
          if (!coreSpotTransferRecordedAt && hasCoreDepositCapability) {
            try {
              const depositResult = await adapterAny.depositUsdcToHyperCore({
                amountUsd: initialPerpTransferAmountUsd
              });
              currentStateJson = {
                ...currentStateJson,
                initialCoreSpotTransferDoneAt: ctx.now.toISOString(),
                initialCoreSpotTransferAmountUsd: initialPerpTransferAmountUsd,
                initialCoreSpotTransferLastTxHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : null
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                metricsJson: mergeMetrics(instance.metricsJson, {
                  initialCoreSpotTransferAmountUsd: initialPerpTransferAmountUsd,
                  initialCoreSpotTransferTxHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : undefined
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
                    amountUsd: initialPerpTransferAmountUsd,
                    txHash: typeof depositResult?.txHash === "string" ? depositResult.txHash : null
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
                    amountUsd: initialPerpTransferAmountUsd
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
            try {
              const transferResult = await adapterAny.transferUsdClass({
                amountUsd: initialPerpTransferAmountUsd,
                toPerp: true
              });
              currentStateJson = {
                ...currentStateJson,
                initialPerpTransferDoneAt: ctx.now.toISOString(),
                initialPerpTransferAmountUsd,
                initialPerpTransferLastTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null,
                initialSeedPending: false,
                initialSeedNeedsReseed: true
              };
              await updateGridBotInstancePlannerState({
                instanceId: instance.id,
                state: "running",
                stateJson: currentStateJson,
                metricsJson: mergeMetrics(instance.metricsJson, {
                  initialSeedPending: false,
                  initialSeedExecuted: false,
                  initialPerpTransferAmountUsd,
                  initialPerpTransferTxHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : undefined
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
                    amountUsd: initialPerpTransferAmountUsd,
                    txHash: typeof transferResult?.txHash === "string" ? transferResult.txHash : null
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
                    amountUsd: initialPerpTransferAmountUsd
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
        && !hasOpenPlannerPosition(plannerPosition)
        && !seedPending
        && (instance.state === "created" || seedNeedsReseed || !seedAlreadyExecuted);

      if (shouldAttemptInitialSeed) {
        const seedPct = Math.max(0, Math.min(60, Number(instance.initialSeedPct ?? 30)));
        const seedMarginUsd = Math.max(0, Number(instance.investUsd ?? 0) * (seedPct / 100));
        const seedNotionalUsdRaw = seedMarginUsd * Math.max(1, Number(instance.leverage ?? 1));
        let seedQty = seedNotionalUsdRaw / Math.max(markPrice, 1e-9);
        if (Number.isFinite(minQty ?? NaN) && Number(minQty) > 0) {
          seedQty = Math.max(seedQty, Number(minQty));
        }
        seedQty = roundUpToStep(seedQty, qtyStep);
        if (minNotional > 0 && seedQty * markPrice + 1e-9 < minNotional) {
          seedQty = roundUpToStep(minNotional / Math.max(markPrice, 1e-9), qtyStep);
          if (Number.isFinite(minQty ?? NaN) && Number(minQty) > 0) {
            seedQty = Math.max(seedQty, Number(minQty));
          }
        }
        seedQty = Number(seedQty.toFixed(8));
        const seedSide = computeInitialSeedSide({
          mode: instance.mode,
          markPrice,
          lowerPrice: instance.lowerPrice,
          upperPrice: instance.upperPrice
        });
        const seedPositionSide = seedSide === "buy" ? "long" : "short";

        if (!Number.isFinite(seedQty) || seedQty <= 0) {
          const reason = "grid_initial_seed_failed:invalid_seed_qty";
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
          let seedSubmitResult: { orderId: string; txHash?: string } | null = null;
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
            ? nextStateJson
            : {
                ...nextStateJson,
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
            metricsJson: mergeMetrics(instance.metricsJson, {
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
            stateJson: {
              ...currentStateJson,
              initialSeedFailedAt: ctx.now.toISOString(),
              initialSeedLastError: String(error),
              initialSeedLastContext: initialSeedContext
            },
            metricsJson: mergeMetrics(instance.metricsJson, {
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
            submitResult: typeof previousSubmitResult?.orderId === "string"
              ? {
                  orderId: String(previousSubmitResult.orderId),
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

      const plannerPayload: GridPlanRequest = {
        instanceId: instance.id,
        mode: instance.mode,
        gridMode: instance.gridMode,
        allocationMode: instance.allocationMode,
        budgetSplitPolicy: instance.budgetSplitPolicy,
        longBudgetPct: instance.longBudgetPct,
        shortBudgetPct: instance.shortBudgetPct,
        lowerPrice: instance.lowerPrice,
        upperPrice: instance.upperPrice,
        gridCount: instance.gridCount,
        activeOrderWindowSize: instance.activeOrderWindowSize,
        recenterDriftLevels: instance.recenterDriftLevels,
        investUsd: instance.investUsd,
        leverage: instance.leverage,
        slippagePct: instance.slippagePct,
        triggerPrice: instance.triggerPrice,
        tpPct: instance.tpPct,
        slPrice: instance.slPrice,
        trailingEnabled: false,
        markPrice,
        openOrders,
        position: plannerPosition,
        stateJson: currentStateJson,
        fillEvents: paperFillEvents.map((fill) => ({
          exchangeOrderId: fill.exchangeOrderId,
          clientOrderId: fill.clientOrderId,
          side: fill.side,
          fillPrice: fill.fillPrice,
          fillQty: fill.fillQty,
          fillTs: fill.fillTs.toISOString()
        })),
        venueConstraints: {
          minQty,
          qtyStep,
          priceTick,
          minNotional,
          feeRate
        },
        feeBufferPct,
        mmrPct,
        extraMarginUsd: instance.extraMarginUsd,
        liqDistanceMinPct,
        initialSeedEnabled: instance.initialSeedEnabled,
        initialSeedPct: instance.initialSeedPct
      };

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
            stateJson: {
              ...currentStateJson,
              plannerUnavailableAt: ctx.now.toISOString(),
              plannerUnavailableReason: reason
            },
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
          const triggerType = instance.autoMarginTriggerType ?? "LIQ_DISTANCE_PCT_BELOW";
          const triggerValue = Number.isFinite(Number(instance.autoMarginTriggerValue))
            ? Number(instance.autoMarginTriggerValue)
            : autoMarginDefaultTriggerPct;
          let triggerActive = false;
          if (triggerType === "LIQ_DISTANCE_PCT_BELOW") {
            triggerActive = Number.isFinite(riskLiqDistance) && riskLiqDistance < triggerValue;
          } else {
            try {
              const accountState = await adapter.getAccountState();
              const marginRatio = computeMarginRatio({
                equity: accountState.equity,
                availableMargin: accountState.availableMargin
              });
              triggerActive = marginRatio !== null && marginRatio > triggerValue;
            } catch {
              triggerActive = false;
            }
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
                let availableMargin = Number.POSITIVE_INFINITY;
                try {
                  const accountState = await adapter.getAccountState();
                  if (Number.isFinite(Number(accountState.availableMargin))) {
                    availableMargin = Math.max(0, Number(accountState.availableMargin));
                  }
                } catch {
                  // fallback to cap only
                }
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
      const riskFilteredIntents = riskBlockingActive
        ? plan.intents.filter(
            (intent) =>
              intent.type === "cancel_order"
              || intent.type === "set_protection"
              || (intent.reduceOnly === true && hasOpenPosition)
          )
        : plan.intents;
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
        isHyperliquidV2Vault,
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
        if (!clientOrderId && !exchangeOrderId) {
          return buildModeNoopResult(signal, "grid_cancel_missing_order_ref", {
            mode: "futures_grid",
            preserveReason: true
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
                if (typeof adapterAny.cancelOrderByParams === "function") {
                  await adapterAny.cancelOrderByParams({
                    orderId: exchangeOrderId,
                    symbol: ctx.bot.symbol
                  });
                } else {
                  await adapter.cancelOrder(exchangeOrderId);
                }
              }
              await updateGridBotOrderMapStatus({
                instanceId: instance.id,
                clientOrderId: clientOrderId || null,
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
                  clientOrderId: clientOrderId || null,
                  exchangeOrderId: exchangeOrderId || null,
                  now: ctx.now
                });
              }
              await writeBotOrderDualWrite({
                botVaultId: ctx.bot.botVaultExecution?.botVaultId,
                exchange: executionExchange,
                symbol: ctx.bot.symbol,
                clientOrderId: clientOrderId || null,
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
      for (const plannerIntent of [...replaceIntents, ...placeIntents].slice(0, remainingOrderBudget)) {
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
          currentStateJson = clearPendingGridExecution(currentStateJson, clientOrderId);
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
        stateJson: mergeGridExecutionRecoveryState(plan.nextStateJson, currentStateJson),
        extraMarginUsd: updatedExtraMarginUsd,
        autoMarginUsedUSDT: updatedAutoMarginUsedUSDT,
        lastAutoMarginAt: updatedLastAutoMarginAt,
        metricsJson: mergeMetrics(instance.metricsJson, {
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

      // `set_protection` can be emitted every tick by planner by design; treat it as non-actionable for noise control.
      const recenterReason = String(planWindowMeta.recenterReason ?? "no_change").trim().toLowerCase();
      const windowEventMessage =
        recenterReason === "seed"
          ? "grid_window_seeded"
          : recenterReason === "fill" || recenterReason === "drift"
            ? "grid_window_recentered"
            : "grid_window_no_change";
      const hasActionablePlanChanges =
        orderIntents.length > 0
        || cancelIntents.length > 0
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
          metricsJson: mergeMetrics(instance.metricsJson, {
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
        return buildModeNoopResult(signal, riskBlockingActive ? "grid_entry_blocked_by_risk" : "grid_no_order_changes", {
          mode: "futures_grid",
          riskBlocked: riskBlockingActive,
          risk: riskRow,
          plannerReasonCodes: plan.reasonCodes,
          plannedIntents: gatedIntents.length,
          fillSync: fillSyncSummary
        });
      }

      const blocked = delegatedResults.find((entry) => entry.status === "blocked");
      if (blocked) {
        return {
          ...blocked,
          reason: `grid_plan_blocked:${blocked.reason}`,
          metadata: {
            ...blocked.metadata,
            mode: "futures_grid",
            plannerReasonCodes: plan.reasonCodes,
            preserveReason: true
          }
        };
      }

      const executedResults = delegatedResults.filter((entry) => entry.status === "executed");
      if (executedResults.length === 0) {
        return buildModeNoopResult(signal, riskBlockingActive ? "grid_entry_blocked_by_risk" : "grid_no_order_changes", {
          mode: "futures_grid",
          riskBlocked: riskBlockingActive,
          risk: riskRow,
          plannerReasonCodes: plan.reasonCodes,
          plannedIntents: gatedIntents.length,
          delegatedOrders: delegatedResults.length,
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

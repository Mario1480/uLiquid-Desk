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
  return getOrCreateRunnerFuturesAdapter({
    cacheKey,
    exchange,
    apiKey: adapterCredentials.apiKey,
    apiSecret: adapterCredentials.apiSecret,
    passphrase: adapterCredentials.passphrase
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
      let prePlanFillSyncSummary: Awaited<ReturnType<typeof syncGridFillEvents>> | null = null;
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
      if (adapter && executionExchange !== "paper") {
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
            if (Number.isFinite(Number(contract.takerFeeRate)) && Number(contract.takerFeeRate) >= 0) {
              feeRate = Number(contract.takerFeeRate);
            }
          }
        }
      } catch {
        // best-effort: keep fallbacks only
      }
      const dynamicNotional = minQty && minQty > 0 ? minQty * markPrice : 0;
      const minNotional = Number(Math.max(minNotionalFallback, dynamicNotional).toFixed(8));

      let plannerPosition = executionExchange === "paper"
        ? await toPlannerPositionFromPaper({
          exchangeAccountId: ctx.bot.exchangeAccountId,
          symbol: ctx.bot.symbol
        })
        : adapter
          ? await toPlannerPositionFromAdapter({
            adapter,
            symbol: ctx.bot.symbol
          })
          : toPlannerPosition(tradeState);

      const initialSeedEnabled = Boolean(instance.initialSeedEnabled) && Number(instance.initialSeedPct) > 0;
      const seedNeedsReseed = currentStateJson.initialSeedNeedsReseed === true;
      const seedAlreadyExecuted = currentStateJson.initialSeedExecuted === true;
      const shouldAttemptInitialSeed = initialSeedEnabled
        && !hasOpenPlannerPosition(plannerPosition)
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
            await adapter.placeOrder({
              symbol: ctx.bot.symbol,
              side: seedSide,
              type: "market",
              qty: seedQty,
              reduceOnly: false,
              marginMode: "cross"
            });
            plannerPosition = {
              side: seedPositionSide,
              qty: seedQty,
              entryPrice: markPrice
            };
          }

          const nextStateJson = {
            ...currentStateJson,
            initialSeedExecuted: true,
            initialSeedNeedsReseed: false,
            initialSeedAt: ctx.now.toISOString(),
            initialSeedSide: seedPositionSide,
            initialSeedQty: seedQty,
            initialSeedPct: seedPct
          };
          const seedNotionalUsd = Number((seedQty * markPrice).toFixed(8));
          await seedGridBotVaultMatchingStateForGridInstance({
            instanceId: instance.id,
            side: seedPositionSide,
            qty: seedQty,
            price: markPrice,
            feeUsd: 0,
          });
          await updateGridBotInstancePlannerState({
            instanceId: instance.id,
            state: "running",
            stateJson: nextStateJson,
            metricsJson: mergeMetrics(instance.metricsJson, {
              initialSeedExecuted: true,
              initialSeedQty: seedQty,
              initialSeedSide: seedPositionSide,
              initialSeedPct: seedPct,
              initialSeedNotionalUsd: seedNotionalUsd,
            }),
            lastPlanError: null,
            lastPlanVersion: "python-v1-seed"
          });
          currentStateJson = nextStateJson;
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_APPLIED",
            message: "grid_initial_seed_executed",
            meta: buildGridExecutionMeta({
              stage: "plan_applied_initial_seed",
              symbol: ctx.bot.symbol,
              instanceId: instance.id,
              extra: {
                seedPct,
                seedSide: seedPositionSide,
                seedQty,
                seedNotionalUsd,
                markPrice
              }
            })
          });
        } catch (error) {
          const reason = `grid_initial_seed_failed:${String(error)}`;
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
                markPrice
              }
            })
          });
          return buildModeBlockedResult(signal, reason, {
            mode: "futures_grid",
            preserveReason: true
          });
        }
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

      const placeIntents = gatedIntents.filter((intent) => intent.type === "place_order");
      const replaceIntents = gatedIntents.filter((intent) => intent.type === "replace_order");
      const cancelIntents = gatedIntents.filter((intent) => intent.type === "cancel_order");
      const protectionIntents = gatedIntents.filter((intent) => intent.type === "set_protection");
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

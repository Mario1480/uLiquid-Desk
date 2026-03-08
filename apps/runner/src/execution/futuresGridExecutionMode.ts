import type { TradeIntent } from "@mm/futures-core";
import {
  createFuturesAdapter as createSharedFuturesAdapter,
  FuturesAdapterFactoryError,
  type BitgetFuturesAdapter,
  type HyperliquidFuturesAdapter,
  type MexcFuturesAdapter
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
  buildModeBlockedResult,
  buildModeNoopResult,
  toOrderMarkPrice
} from "./modeUtils.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";

type SupportedFuturesAdapter = BitgetFuturesAdapter | HyperliquidFuturesAdapter | MexcFuturesAdapter;
const MEXC_PERP_ENABLED = String(process.env.MEXC_PERP_ENABLED ?? "false").trim().toLowerCase() === "true";
const adapterCache = new Map<string, SupportedFuturesAdapter>();
const GRID_NOISE_RISK_EVENT_THROTTLE_MS = 120_000;
const GRID_NOISE_RISK_EVENT_CACHE_MAX = 2_000;
const gridNoiseRiskEventCache = new Map<string, number>();

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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

function parseTickerPrice(payload: unknown): number | null {
  const row = Array.isArray(payload) ? payload[0] ?? null : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const candidates = [
    record.markPrice,
    record.lastPr,
    record.last,
    record.price,
    record.close,
    record.indexPrice,
    record.lastPrice,
    record.mark
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate ?? NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function fetchBinancePerpMarkPrice(symbol: string): Promise<number | null> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  const baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  const url = `${baseUrl}/fapi/v1/ticker/price?symbol=${encodeURIComponent(normalized)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    const parsed = Number((payload as Record<string, unknown>).price ?? NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

async function readMarkPriceFromAdapter(
  adapter: SupportedFuturesAdapter,
  symbol: string
): Promise<number | null> {
  try {
    const adapterAny = adapter as any;
    const exchangeSymbol = typeof adapterAny.toExchangeSymbol === "function"
      ? await adapterAny.toExchangeSymbol(symbol)
      : symbol;
    if (adapterAny.marketApi && typeof adapterAny.marketApi.getTicker === "function") {
      const ticker = await adapterAny.marketApi.getTicker(exchangeSymbol);
      const parsed = parseTickerPrice(ticker);
      if (parsed && parsed > 0) return parsed;
    }
  } catch {
    // best-effort only
  }
  return null;
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
    price: orderType === "limit" && Number.isFinite(price) && price > 0 ? price : undefined,
    reduceOnly: order.reduceOnly === true,
    marginMode: "cross",
    takeProfitPrice: takeProfitPrice ?? undefined,
    stopLossPrice: stopLossPrice ?? undefined
  });
}

function normalizeComparableSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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
}): Promise<{ closed: boolean; reason: string | null }> {
  if (params.executionExchange === "paper") {
    try {
      const closed = await closePaperPositionForRunner({
        exchangeAccountId: params.exchangeAccountId,
        symbol: params.botSymbol,
        fillPrice: params.markPrice
      });
      return {
        closed: Boolean(closed?.orderId) && Number(closed?.closedQty ?? 0) > 0,
        reason: null
      };
    } catch (error) {
      return { closed: false, reason: String(error) };
    }
  }
  if (!params.adapter) return { closed: false, reason: "adapter_unavailable" };
  try {
    const positions = await params.adapter.getPositions();
    const target = positions.find((row: any) => {
      const symbol = normalizeComparableSymbol(String(row?.symbol ?? ""));
      return symbol === normalizeComparableSymbol(params.botSymbol) && Number(row?.size ?? 0) > 0;
    });
    if (!target) return { closed: false, reason: "no_open_position" };
    const qty = Number(target.size ?? NaN);
    if (!Number.isFinite(qty) || qty <= 0) return { closed: false, reason: "invalid_position_qty" };
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
    return { closed: true, reason: null };
  } catch (error) {
    if (isNoPositionToCloseError(error)) return { closed: false, reason: "no_open_position" };
    return { closed: false, reason: String(error) };
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

function isNoPositionToCloseError(error: unknown): boolean {
  return /no position to close/i.test(String(error ?? ""));
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
  const exchange = String(bot.marketData.exchange ?? "").trim().toLowerCase();
  if (exchange === "paper" || exchange === "binance") return null;
  if (exchange === "mexc" && !MEXC_PERP_ENABLED) return null;
  const cacheKey = `${bot.id}:${bot.marketData.exchangeAccountId}`;
  const cached = adapterCache.get(cacheKey);
  if (cached) return cached;
  try {
    const adapter = createSharedFuturesAdapter(
      {
        exchange,
        apiKey: bot.marketData.credentials.apiKey,
        apiSecret: bot.marketData.credentials.apiSecret,
        passphrase: bot.marketData.credentials.passphrase ?? undefined
      },
      {
        allowMexcPerp: MEXC_PERP_ENABLED,
        allowBinancePerp: false
      }
    ) as SupportedFuturesAdapter;
    adapterCache.set(cacheKey, adapter);
    return adapter;
  } catch (error) {
    if (error instanceof FuturesAdapterFactoryError) return null;
    throw error;
  }
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
      const allowedGridExchanges = readAllowedGridExchanges();
      if (!allowedGridExchanges.has(executionExchange)) {
        return buildModeBlockedResult(signal, "grid_exchange_not_allowed", {
          mode: "futures_grid",
          exchange: executionExchange,
          allowedExchanges: [...allowedGridExchanges]
        });
      }
      const gate = coerceGateSummary(signal.metadata.gate, defaultGateSummary());

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
      if ((!markPrice || markPrice <= 0) && adapter) {
        markPrice = await readMarkPriceFromAdapter(adapter, ctx.bot.symbol);
      }
      if ((!markPrice || markPrice <= 0) && executionExchange === "paper") {
        markPrice = await fetchBinancePerpMarkPrice(ctx.bot.symbol);
      }
      if (!markPrice) {
        return buildModeNoopResult(signal, "grid_missing_mark_price", {
          mode: "futures_grid",
          markPriceFallback: executionExchange === "paper"
            ? "binance_perp_fallback_failed"
            : adapter
              ? "adapter_ticker_failed"
              : "adapter_unavailable"
        });
      }

      const tradeState = await loadBotTradeState({ botId: ctx.bot.id, symbol: ctx.bot.symbol, now: ctx.now });
      const stateJsonRecord = asRecord(instance.stateJson) ?? {};
      let openOrders = await listGridBotOpenOrders(instance.id);
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
        const previousMarkPrice = Number(stateJsonRecord.lastMarkPrice ?? NaN);
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
        : toPlannerPosition(tradeState);

      const initialSeedEnabled = Boolean(instance.initialSeedEnabled) && Number(instance.initialSeedPct) > 0;
      const seedNeedsReseed = stateJsonRecord.initialSeedNeedsReseed === true;
      const seedAlreadyExecuted = stateJsonRecord.initialSeedExecuted === true;
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
            meta: {
              instanceId: instance.id,
              reason,
              seedPct,
              seedMarginUsd,
              seedNotionalUsdRaw,
              markPrice
            }
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
            ...(asRecord(instance.stateJson) ?? {}),
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
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_APPLIED",
            message: "grid_initial_seed_executed",
            meta: {
              instanceId: instance.id,
              seedPct,
              seedSide: seedPositionSide,
              seedQty,
              seedNotionalUsd,
              markPrice
            }
          });
        } catch (error) {
          const reason = `grid_initial_seed_failed:${String(error)}`;
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_PLAN_BLOCKED",
            message: "grid initial seed failed",
            meta: {
              instanceId: instance.id,
              reason,
              seedPct,
              seedMarginUsd,
              seedNotionalUsdRaw,
              seedQty,
              markPrice
            }
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
        slPct: instance.slPct,
        trailingEnabled: false,
        markPrice,
        openOrders,
        position: plannerPosition,
        stateJson: instance.stateJson,
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
              ...(asRecord(instance.stateJson) ?? {}),
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
                meta: {
                  instanceId: instance.id,
                  strategyKey: ctx.bot.strategyKey
                }
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
                      meta: {
                        instanceId: instance.id,
                        addedUSDT: topUpAmount,
                        usedUSDT: updatedAutoMarginUsedUSDT,
                        maxUSDT: maxCap,
                        triggerType,
                        triggerValue,
                        liqDistancePct: Number.isFinite(riskLiqDistance) ? riskLiqDistance : null
                      }
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
      const gatedIntents = riskBlockingActive
        ? plan.intents.filter(
            (intent) =>
              intent.type === "cancel_order"
              || intent.type === "set_protection"
              || (intent.reduceOnly === true && hasOpenPosition)
          )
        : plan.intents;

      if (autoMarginBlockedReason && autoMarginRiskBlocked) {
        const autoMarginBlockedSignature = `GRID_AUTO_MARGIN_BLOCKED:${marginMode}:${autoMarginBlockedReason}`;
        if (!shouldThrottleGridNoiseRiskEvent(ctx.bot.id, autoMarginBlockedSignature, ctx.now)) {
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: "GRID_AUTO_MARGIN_BLOCKED",
            message: "auto margin policy blocked entries",
            meta: {
              instanceId: instance.id,
              reason: autoMarginBlockedReason,
              marginMode,
              exchange: exchangeKey,
              autoMarginUsedUSDT: updatedAutoMarginUsedUSDT,
              autoMarginMaxUSDT: instance.autoMarginMaxUSDT
            }
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
            meta: {
              instanceId: instance.id,
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
          return {
            status: "executed",
            reason: "grid_cancel_executed",
            orderIds: exchangeOrderId ? [exchangeOrderId] : undefined,
            metadata: {
              mode: "futures_grid",
              executionPath: executionExchange === "paper" ? "paper" : "direct_adapter",
              preserveReason: true
            },
            legacy: {
              outcome: "ok",
              intent: signal.legacyIntent,
              gate
            }
          };
        } catch (error) {
          return {
            status: "blocked",
            reason: `grid_cancel_failed:${String(error)}`,
            metadata: {
              mode: "futures_grid",
              executionPath: executionExchange === "paper" ? "paper" : "direct_adapter",
              preserveReason: true
            },
            legacy: {
              outcome: "blocked",
              intent: signal.legacyIntent,
              gate
            }
          };
        }
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
        let delegated: ExecutionResult;
        if (executionExchange === "paper") {
          try {
            const order = mappedIntent.order ?? {};
            const fillPriceRaw = Number(order.price ?? markPrice ?? NaN);
            const fillPrice = Number.isFinite(fillPriceRaw) && fillPriceRaw > 0 ? fillPriceRaw : markPrice;
            if (order.type === "limit") {
              const qty = Number(order.qty ?? NaN);
              if (!Number.isFinite(qty) || qty <= 0) {
                delegated = {
                  status: "blocked",
                  reason: "paper_invalid_qty",
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "blocked",
                    intent: mappedIntent,
                    gate
                  }
                };
              } else {
                const placed = await placePaperLimitOrderForRunner({
                  exchangeAccountId: ctx.bot.exchangeAccountId,
                  symbol: ctx.bot.symbol,
                  side: mappedIntent.side === "long" ? "buy" : "sell",
                  qty,
                  price: fillPrice,
                  reduceOnly: order.reduceOnly === true,
                  clientOrderId: plannerIntent.clientOrderId ?? null
                });
                delegated = {
                  status: "executed",
                  reason: "grid_paper_limit_order_open",
                  orderIds: placed.orderId ? [placed.orderId] : undefined,
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "ok",
                    intent: mappedIntent,
                    gate
                  }
                };
              }
            } else if (order.reduceOnly === true) {
              const closed = await closePaperPositionForRunner({
                exchangeAccountId: ctx.bot.exchangeAccountId,
                symbol: ctx.bot.symbol,
                fillPrice
              });
              if (!closed.orderId || closed.closedQty <= 0) {
                delegated = {
                  status: "noop",
                  reason: "reduce_only_no_position",
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "ok",
                    intent: mappedIntent,
                    gate
                  }
                };
              } else {
                delegated = {
                  status: "executed",
                  reason: "grid_paper_close_executed",
                  orderIds: [closed.orderId],
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "ok",
                    intent: mappedIntent,
                    gate
                  }
                };
              }
            } else {
              const qty = Number(order.qty ?? NaN);
              if (!Number.isFinite(qty) || qty <= 0) {
                delegated = {
                  status: "blocked",
                  reason: "paper_invalid_qty",
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "blocked",
                    intent: mappedIntent,
                    gate
                  }
                };
              } else {
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
                delegated = {
                  status: "executed",
                  reason: "grid_paper_order_executed",
                  orderIds: placed.orderId ? [placed.orderId] : undefined,
                  metadata: {
                    mode: "futures_grid",
                    executionPath: "paper",
                    preserveReason: true
                  },
                  legacy: {
                    outcome: "ok",
                    intent: mappedIntent,
                    gate
                  }
                };
              }
            }
          } catch (error) {
            delegated = {
              status: "blocked",
              reason: `paper_place_order_failed:${String(error)}`,
              metadata: {
                mode: "futures_grid",
                executionPath: "paper",
                preserveReason: true
              },
              legacy: {
                outcome: "blocked",
                intent: mappedIntent,
                gate
              }
            };
          }
        } else if (!adapter) {
          delegated = {
            status: "blocked",
            reason: "adapter_unavailable",
            metadata: {
              mode: "futures_grid",
              preserveReason: true
            },
            legacy: {
              outcome: "blocked",
              intent: mappedIntent,
              gate
            }
          };
        } else {
          try {
            const placed = await executeMappedIntentViaAdapter({
              adapter,
              botSymbol: ctx.bot.symbol,
              intent: mappedIntent
            });
            delegated = {
              status: "executed",
              reason: "grid_adapter_executed",
              orderIds: placed.orderId ? [placed.orderId] : undefined,
              metadata: {
                mode: "futures_grid",
                executionPath: "direct_adapter",
                preserveReason: true
              },
              legacy: {
                outcome: "ok",
                intent: mappedIntent,
                gate
              }
            };
          } catch (error) {
            if (mappedIntent.order?.reduceOnly === true && isNoPositionToCloseError(error)) {
              delegated = {
                status: "noop",
                reason: "reduce_only_no_position",
                metadata: {
                  mode: "futures_grid",
                  executionPath: "direct_adapter",
                  preserveReason: true
                },
                legacy: {
                  outcome: "ok",
                  intent: mappedIntent,
                  gate
                }
              };
              delegatedResults.push(delegated);
              continue;
            }
            const raw = String(error);
            const reason = /unknown symbol|symbolunknown/i.test(raw)
              ? `symbol_unknown:${raw}`
              : `adapter_place_order_failed:${raw}`;
            delegated = {
              status: "blocked",
              reason,
              metadata: {
                mode: "futures_grid",
                executionPath: "direct_adapter",
                preserveReason: true
              },
              legacy: {
                outcome: "blocked",
                intent: mappedIntent,
                gate
              }
            };
          }
        }

        delegatedResults.push(delegated);
        const hasSlPrice = toPositiveNumberOrNull(plannerIntent.slPrice) !== null;
        const hasTpPrice = toPositiveNumberOrNull(plannerIntent.tpPrice) !== null;
        if (
          delegated.status === "executed"
          && plannerIntent.reduceOnly === true
          && (hasTpPrice || hasSlPrice)
        ) {
          terminalIntentHit = hasSlPrice ? "sl" : "tp";
        }

        if (delegated.status === "executed" && plannerIntent.clientOrderId) {
          const firstOrderId = Array.isArray(delegated.orderIds) && delegated.orderIds.length > 0
            ? delegated.orderIds[0]
            : null;
          await createGridBotOrderMapEntry({
            instanceId: instance.id,
            botId: ctx.bot.id,
            clientOrderId: plannerIntent.clientOrderId,
            exchangeOrderId: firstOrderId,
            gridLeg: plannerIntent.gridLeg === "short" ? "short" : "long",
            gridIndex: Math.max(0, Math.trunc(Number(plannerIntent.gridIndex ?? 0))),
            intentType: plannerIntent.reduceOnly
              ? (hasSlPrice ? "sl" : hasTpPrice ? "tp" : "rebalance")
              : "entry",
            side: plannerIntent.side === "sell" ? "sell" : "buy",
            price: plannerIntent.price ?? null,
            qty: plannerIntent.qty ?? null,
            reduceOnly: plannerIntent.reduceOnly === true,
            status: "open"
          });
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
        stateJson: plan.nextStateJson,
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
          meta: {
            instanceId: instance.id,
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
          markPrice
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
          meta: {
            instanceId: instance.id,
            reason: archivedReason,
            terminalTpHits,
            terminalSlHits,
            terminalIntentHit,
            canceledOrders: cancelSummary.canceled,
            cancelErrors: cancelSummary.failed,
            closedResidualPosition: closeSummary.closed,
            closeResidualReason: closeSummary.reason
          }
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

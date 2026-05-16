import type { ExecutionMode, ExecutionResult } from "./types.js";
import type { AdapterMarkPriceDiagnostic } from "./futuresVenueRuntime.js";
import { toOrderMarkPrice } from "./modeUtils.js";
import { getGridOrderResubmissionGuard } from "./recovery.js";

const GRID_NOISE_RISK_EVENT_THROTTLE_MS = 120_000;
const GRID_NOISE_RISK_EVENT_CACHE_MAX = 2_000;
const gridNoiseRiskEventCache = new Map<string, number>();

function isEntryLikeIntentType(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "entry" || normalized === "rebalance";
}

export function selectCancelableEntryOrders(
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

export function shouldThrottleGridNoiseRiskEvent(botId: string, signature: string, now: Date): boolean {
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

export function readMarkPrice(signal: Parameters<ExecutionMode["execute"]>[0]): number | null {
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

export function hasSignalMarketSnapshot(signal: Parameters<ExecutionMode["execute"]>[0]): boolean {
  const metadata = signal.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  const snapshotKeys = ["markPrice", "lastPr", "last", "price", "close", "indexPrice", "lastPrice", "mark"];
  if (snapshotKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return true;
  }
  const ticker = record.ticker;
  return Boolean(ticker && typeof ticker === "object" && !Array.isArray(ticker));
}

export function resolveGridMarketDataFailure(params: {
  signal: Parameters<ExecutionMode["execute"]>[0];
  adapterPresent: boolean;
  adapterMarkPriceDiagnostic?: AdapterMarkPriceDiagnostic | null;
  paperMarketDataVenue?: string | null;
}): {
  code: "market_snapshot_unavailable" | "mark_price_unavailable";
  reason: "grid_market_snapshot_unavailable" | "grid_mark_price_unavailable";
  details: Record<string, unknown>;
} {
  const signalSnapshotAvailable = hasSignalMarketSnapshot(params.signal);
  const adapterDiagnostic = params.adapterMarkPriceDiagnostic ?? null;
  const adapterSnapshotAvailable = adapterDiagnostic?.snapshotAvailable === true;
  const marketSnapshotAvailable = signalSnapshotAvailable || adapterSnapshotAvailable;
  const code = marketSnapshotAvailable ? "mark_price_unavailable" : "market_snapshot_unavailable";
  const reason = marketSnapshotAvailable ? "grid_mark_price_unavailable" : "grid_market_snapshot_unavailable";
  return {
    code,
    reason,
    details: {
      marketSnapshotAvailable,
      signalSnapshotAvailable,
      adapterSnapshotAvailable,
      snapshotSource: signalSnapshotAvailable
        ? "signal"
        : adapterDiagnostic?.snapshotSource ?? "none",
      markPriceFallback: params.paperMarketDataVenue === "binance"
        ? "binance_perp_fallback_failed"
        : params.adapterPresent
          ? "adapter_ticker_failed"
          : "adapter_unavailable",
      markPriceDiagnostics: adapterDiagnostic
        ? {
            symbol: adapterDiagnostic.symbol,
            exchangeSymbol: adapterDiagnostic.exchangeSymbol,
            errorCategory: adapterDiagnostic.errorCategory,
            priceSource: adapterDiagnostic.priceSource,
            snapshotSource: adapterDiagnostic.snapshotSource,
            snapshotAvailable: adapterDiagnostic.snapshotAvailable,
            attemptedSources: adapterDiagnostic.attemptedSources,
            retryCount: adapterDiagnostic.retryCount,
            staleCacheAgeMs: adapterDiagnostic.staleCacheAgeMs,
            usedCachedSnapshot: adapterDiagnostic.usedCachedSnapshot,
            endpointFailures: adapterDiagnostic.endpointFailures
          }
        : null
    }
  };
}

export function resolveGridOrderPlacementFailure(
  delegatedResults: ExecutionResult[]
): {
  reason: string;
  details: Record<string, unknown>;
} | null {
  const failed = delegatedResults.find((entry) =>
    entry.status === "blocked"
    && (
      entry.reason === "adapter_unavailable"
      || entry.reason.startsWith("adapter_place_order_failed:")
      || entry.reason.startsWith("adapter_place_order_pending:")
      || entry.reason.startsWith("paper_place_order_failed:")
      || entry.reason.startsWith("symbol_unknown:")
    )
  );
  if (!failed) return null;
  return {
    reason: failed.reason,
    details: {
      retryCategory: failed.metadata?.retryCategory ?? null,
      retryReasonCode: failed.metadata?.retryReasonCode ?? null,
      txHash: failed.metadata?.txHash ?? null,
      candidateOrderId: failed.metadata?.candidateOrderId ?? null
    }
  };
}

import { ManualTradingError, normalizeSymbolInput, type TradingAccount } from "../trading.js";
import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";

type GridVenueCacheDeps = {
  readGridVenueConstraintCache(params: {
    db: any;
    exchange: string;
    symbol: string;
    ttlSec: number;
  }): Promise<{
    minQty?: number | null;
    qtyStep?: number | null;
    priceTick?: number | null;
    minNotionalUSDT?: number | null;
    feeRateTaker?: number | null;
    markPrice?: number | null;
  } | null>;
  upsertGridVenueConstraintCache(params: {
    db: any;
    exchange: string;
    symbol: string;
    minQty: number | null;
    qtyStep: number | null;
    priceTick: number | null;
    minNotionalUSDT: number;
    feeRateTaker: number;
    feeRateMaker: number | null;
    markPrice: number;
  }): Promise<void>;
};

type GridVenueContextDeps = GridVenueCacheDeps & {
  db: any;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId: string): Promise<{
    selectedAccount: TradingAccount;
    marketDataAccount: TradingAccount;
  }>;
  normalizeExchangeValue(value: unknown): string;
  createPerpMarketDataClient(account: TradingAccount, source: string): PerpMarketDataClient;
  logger: { warn(message: string): void };
};

export type GridVenueContext = {
  markPrice: number;
  marketDataVenue: "bitget" | "binance" | "hyperliquid" | string;
  venueConstraints: {
    minQty: number | null;
    qtyStep: number | null;
    priceTick: number | null;
    minNotional: number | null;
    feeRate: number | null;
  };
  feeBufferPct: number;
  mmrPct: number;
  liqDistanceMinPct: number;
  warnings: string[];
};

function readPositiveOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readGridEnvNumber(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const parsed = Number(process.env[name] ?? fallback);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (bounds?.min !== undefined) next = Math.max(bounds.min, next);
  if (bounds?.max !== undefined) next = Math.min(bounds.max, next);
  return next;
}

async function fetchBinancePerpPublicMarkPrice(symbol: string): Promise<number | null> {
  const normalized = normalizeSymbolInput(symbol) || String(symbol ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${encodeURIComponent(normalized)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    return readPositiveOrNull((payload as Record<string, unknown>).price);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createGridVenueContextResolver(deps: GridVenueContextDeps) {
  return async function resolveGridVenueContext(params: {
    userId: string;
    exchangeAccountId: string;
    symbol: string;
  }): Promise<GridVenueContext> {
    const resolved = await deps.resolveMarketDataTradingAccount(params.userId, params.exchangeAccountId);
    const selectedExchange = deps.normalizeExchangeValue(String(resolved.selectedAccount.exchange ?? ""));
    const exchange = String(resolved.marketDataAccount.exchange ?? "").trim().toLowerCase();
    const marketDataAccount = resolved.marketDataAccount;
    const normalizePaperPreviewConstraints =
      selectedExchange === "paper" && (exchange === "binance" || exchange === "hyperliquid");
    const symbol = normalizeSymbolInput(params.symbol) || String(params.symbol ?? "").trim().toUpperCase();
    const warnings: string[] = [];
    const fallbackMinNotional = readGridEnvNumber("GRID_MIN_NOTIONAL_FALLBACK_USDT", 5, { min: 0 });
    const feeRateFallbackPct = readGridEnvNumber("GRID_FEE_RATE_FALLBACK_PCT", 0.06, { min: 0, max: 20 });
    const feeBufferPct = readGridEnvNumber("GRID_MIN_INVEST_FEE_BUFFER_PCT", 1.0, { min: 0, max: 25 });
    const mmrPct = readGridEnvNumber("GRID_LIQ_MMR_DEFAULT_PCT", 0.75, { min: 0.01, max: 20 });
    const liqDistanceMinPct = readGridEnvNumber("GRID_LIQ_DISTANCE_MIN_PCT", 8, { min: 0, max: 100 });
    const cacheTtlSec = readGridEnvNumber("GRID_VENUE_CACHE_TTL_SEC", 120, { min: 10, max: 3600 });
    const staleCacheTtlSec = readGridEnvNumber("GRID_VENUE_STALE_CACHE_TTL_SEC", 86400, { min: 60, max: 604800 });
    const perpClient = deps.createPerpMarketDataClient(marketDataAccount, "/grid/venue-context");

    let markPrice: number | null = null;
    let minQty: number | null = null;
    let qtyStep: number | null = null;
    let priceTick: number | null = null;
    let liveFetchOk = false;
    try {
      try {
        if (typeof perpClient.getTicker === "function") {
          const ticker = await perpClient.getTicker(symbol);
          markPrice = readPositiveOrNull(ticker.mark) ?? readPositiveOrNull(ticker.last);
        }
        if (!(Number.isFinite(Number(markPrice)) && Number(markPrice) > 0) && typeof perpClient.getLastPrice === "function") {
          markPrice = readPositiveOrNull(await perpClient.getLastPrice(symbol));
        }

        const symbols = await perpClient.listSymbols();
        const row = symbols.find((entry) => {
          const candidate = normalizeSymbolInput(entry.symbol) || String(entry.symbol ?? "").trim().toUpperCase();
          return candidate === symbol;
        });
        if (row) {
          minQty = readPositiveOrNull(row.minQty);
          qtyStep = readPositiveOrNull(row.stepSize);
          priceTick = readPositiveOrNull(row.tickSize);
        } else {
          warnings.push("constraints_missing_or_fallback_used");
        }
        liveFetchOk = true;
      } catch (error) {
        warnings.push("live_constraints_unavailable");
        deps.logger.warn(`grid venue context live fetch failed: exchange=${exchange} symbol=${symbol} err=${String(error)}`);
      }
    } finally {
      try {
        await perpClient.close();
      } catch {
        // ignore close errors
      }
    }

    if ((!markPrice || markPrice <= 0) || (minQty == null && qtyStep == null && priceTick == null)) {
      const cached = await deps.readGridVenueConstraintCache({
        db: deps.db,
        exchange,
        symbol,
        ttlSec: cacheTtlSec
      }).catch(() => null);
      if (cached) {
        if (!(Number.isFinite(Number(markPrice)) && Number(markPrice) > 0) && cached.markPrice && cached.markPrice > 0) {
          markPrice = cached.markPrice;
        }
        if (minQty == null) minQty = readPositiveOrNull(cached.minQty);
        if (qtyStep == null) qtyStep = readPositiveOrNull(cached.qtyStep);
        if (priceTick == null) priceTick = readPositiveOrNull(cached.priceTick);
        warnings.push("constraints_cache_fallback_used");
      }
    }

    if ((!markPrice || markPrice <= 0) || (minQty == null && qtyStep == null && priceTick == null)) {
      const staleCached = await deps.readGridVenueConstraintCache({
        db: deps.db,
        exchange,
        symbol,
        ttlSec: staleCacheTtlSec
      }).catch(() => null);
      if (staleCached) {
        if (!(Number.isFinite(Number(markPrice)) && Number(markPrice) > 0) && staleCached.markPrice && staleCached.markPrice > 0) {
          markPrice = staleCached.markPrice;
        }
        if (minQty == null) minQty = readPositiveOrNull(staleCached.minQty);
        if (qtyStep == null) qtyStep = readPositiveOrNull(staleCached.qtyStep);
        if (priceTick == null) priceTick = readPositiveOrNull(staleCached.priceTick);
        warnings.push("constraints_cache_stale_fallback_used");
      }
    }

    if (!(Number.isFinite(Number(markPrice)) && Number(markPrice) > 0) && exchange === "hyperliquid") {
      const publicFallbackMarkPrice = await fetchBinancePerpPublicMarkPrice(symbol).catch(() => null);
      if (publicFallbackMarkPrice && publicFallbackMarkPrice > 0) {
        markPrice = publicFallbackMarkPrice;
        warnings.push("mark_price_public_fallback_used");
      }
    }

    if (!(Number.isFinite(Number(markPrice)) && Number(markPrice) > 0)) {
      throw new ManualTradingError("grid_mark_price_unavailable", 422, "grid_mark_price_unavailable");
    }

    const cacheMinQty = minQty;
    const cacheQtyStep = qtyStep;
    const cachePriceTick = priceTick;
    const cacheDynamicNotional = cacheMinQty && cacheMinQty > 0 ? cacheMinQty * Number(markPrice) : null;
    const cacheMinNotional = Number(
      Math.max(
        fallbackMinNotional,
        cacheDynamicNotional && Number.isFinite(cacheDynamicNotional) && cacheDynamicNotional > 0
          ? cacheDynamicNotional
          : 0
      ).toFixed(8)
    );
    if (normalizePaperPreviewConstraints) {
      minQty = null;
      qtyStep = null;
    }

    const dynamicNotional = minQty && minQty > 0 ? minQty * Number(markPrice) : null;
    const minNotional = Number(
      Math.max(
        fallbackMinNotional,
        dynamicNotional && Number.isFinite(dynamicNotional) && dynamicNotional > 0 ? dynamicNotional : 0
      ).toFixed(8)
    );
    if (!dynamicNotional && !normalizePaperPreviewConstraints) {
      warnings.push("constraints_missing_or_fallback_used");
    }

    if (liveFetchOk) {
      void deps.upsertGridVenueConstraintCache({
        db: deps.db,
        exchange,
        symbol,
        minQty: cacheMinQty,
        qtyStep: cacheQtyStep,
        priceTick: cachePriceTick,
        minNotionalUSDT: cacheMinNotional,
        feeRateTaker: feeRateFallbackPct,
        feeRateMaker: null,
        markPrice: Number(markPrice)
      }).catch(() => {
        // best effort only
      });
    }

    return {
      markPrice: Number(markPrice),
      marketDataVenue: exchange,
      venueConstraints: {
        minQty,
        qtyStep,
        priceTick,
        minNotional,
        feeRate: feeRateFallbackPct
      },
      feeBufferPct,
      mmrPct,
      liqDistanceMinPct,
      warnings
    };
  };
}

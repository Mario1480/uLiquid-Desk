import {
  type BinanceFuturesAdapter,
  type BingxFuturesAdapter,
  type BitgetFuturesAdapter,
  createResolvedFuturesAdapter,
  type HyperliquidFuturesAdapter,
  type MexcFuturesAdapter
} from "@mm/futures-exchange";
import { ManualTradingError, type PerpPriceReader, type TradingAccount } from "../trading-contracts.js";
import { normalizePerpDerivativesSnapshot, type PerpDerivativesSnapshot } from "./perp-derivatives-normalization.js";

export { normalizePerpDerivativesSnapshot, type PerpDerivativesSnapshot } from "./perp-derivatives-normalization.js";

type SupportedFuturesAdapter = BinanceFuturesAdapter | BingxFuturesAdapter | BitgetFuturesAdapter | HyperliquidFuturesAdapter | MexcFuturesAdapter;

type PerpSymbolItem = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  minLeverage: number | null;
  maxLeverage: number | null;
  quoteAsset: string | null;
  baseAsset: string | null;
};

export type PerpMarketDataClient = PerpPriceReader & {
  listSymbols(): Promise<PerpSymbolItem[]>;
  getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown>;
  getTicker(symbol: string): Promise<{
    symbol: string;
    last: number | null;
    mark: number | null;
    bid: number | null;
    ask: number | null;
    ts: number | null;
    raw: unknown;
  }>;
  getDepth(
    symbol: string,
    limit?: number
  ): Promise<{
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    ts: number | null;
    raw: unknown;
  }>;
  getTrades(
    symbol: string,
    limit?: number
  ): Promise<Array<{
    symbol: string;
    price: number | null;
    qty: number | null;
    side: string | null;
    ts: number | null;
    raw: unknown;
  }>>;
  getDerivativesSnapshot(symbol: string): Promise<PerpDerivativesSnapshot>;
  close(): Promise<void>;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const parsed = toNumber(record[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizedObservedAt(value: unknown): { observedAt: string; sourceTimestampProvided: boolean } {
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0) return { observedAt: new Date().toISOString(), sourceTimestampProvided: false };
  const millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  const date = new Date(millis);
  return Number.isFinite(date.getTime())
    ? { observedAt: date.toISOString(), sourceTimestampProvided: true }
    : { observedAt: new Date().toISOString(), sourceTimestampProvided: false };
}

function normalizeCanonicalSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toTimeframeGranularity(value?: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1m") return "1m";
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h" || normalized === "1hutc") return "1H";
  if (normalized === "4h" || normalized === "4hutc") return "4H";
  if (normalized === "1d" || normalized === "1dutc") return "1D";
  return "15m";
}

function toBinanceInterval(value?: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1m") return "1m";
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h" || normalized === "1hutc") return "1h";
  if (normalized === "4h" || normalized === "4hutc") return "4h";
  if (normalized === "1d" || normalized === "1dutc") return "1d";
  return "15m";
}

function toBingxInterval(value?: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1m") return "1m";
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h" || normalized === "1hutc") return "1h";
  if (normalized === "4h" || normalized === "4hutc") return "4h";
  if (normalized === "1d" || normalized === "1dutc") return "1d";
  return "15m";
}

const PERP_SYMBOL_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH"] as const;

function splitCanonicalPerpSymbol(value: string): { base: string; quote: string } | null {
  const canonical = normalizeCanonicalSymbol(value);
  for (const quote of PERP_SYMBOL_QUOTES) {
    if (canonical.endsWith(quote) && canonical.length > quote.length) {
      return {
        base: canonical.slice(0, -quote.length),
        quote
      };
    }
  }
  return null;
}

function toBingxSwapSymbol(value: string): string {
  const raw = String(value ?? "").trim().toUpperCase();
  const separated = raw.match(/^([A-Z0-9]+)[/-]([A-Z0-9]+)$/);
  if (separated) return `${separated[1]}-${separated[2]}`;
  const split = splitCanonicalPerpSymbol(raw);
  return split ? `${split.base}-${split.quote}` : normalizeCanonicalSymbol(raw);
}

function precisionToStep(value: unknown): number | null {
  const precision = toNumber(value);
  if (precision === null || precision < 0) return null;
  return Number(`1e-${Math.trunc(precision)}`);
}

function parseOrderBookLevels(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value
    .map((level) => {
      if (!Array.isArray(level)) return null;
      const price = toNumber(level[0]);
      const qty = toNumber(level[1]);
      if (price === null || qty === null) return null;
      return [price, qty] as [number, number];
    })
    .filter((level): level is [number, number] => level !== null);
}

function isBingxApiStateEnabled(value: unknown): boolean {
  const normalized = String(value ?? "true").trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "disabled";
}

function isOpaqueCandleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();
  return normalized.includes("unknown error occurred")
    || normalized.includes("http 400")
    || normalized.includes("http 500");
}

class FuturesAdapterPerpMarketDataClient implements PerpMarketDataClient {
  constructor(
    private readonly adapter: SupportedFuturesAdapter,
    private readonly venue: "bitget" | "hyperliquid" | "mexc"
  ) {}

  async listSymbols(): Promise<PerpSymbolItem[]> {
    await this.adapter.contractCache.warmup();
    return this.adapter.contractCache.snapshot()
      .map((contract) => {
        const contractSize =
          Number.isFinite(Number(contract.contractSize)) && Number(contract.contractSize) > 0
            ? Number(contract.contractSize)
            : 1;
      return {
        symbol: contract.canonicalSymbol,
        exchangeSymbol: contract.exchangeSymbol,
        status: contract.apiAllowed ? "online" : "offline",
        tradable: contract.apiAllowed,
        tickSize: contract.tickSize,
        stepSize:
          contract.stepSize !== null && contract.stepSize !== undefined
            ? Number((Number(contract.stepSize) * contractSize).toFixed(8))
            : contract.stepSize,
        minQty:
          contract.minVol !== null && contract.minVol !== undefined
            ? Number((Number(contract.minVol) * contractSize).toFixed(8))
            : contract.minVol,
        maxQty:
          contract.maxVol !== null && contract.maxVol !== undefined
            ? Number((Number(contract.maxVol) * contractSize).toFixed(8))
            : contract.maxVol,
        minLeverage: contract.minLeverage ?? null,
        maxLeverage: contract.maxLeverage ?? null,
        quoteAsset: contract.quoteAsset ?? null,
        baseAsset: contract.baseAsset ?? null
      };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    try {
      const exchangeSymbol = await this.adapter.toExchangeSymbol(params.symbol);
      const granularity = params.granularity ?? toTimeframeGranularity(params.timeframe);
      return this.adapter.marketApi.getCandles({
        symbol: exchangeSymbol,
        productType: this.adapter.productType as any,
        granularity,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.limit ?? 500
      });
    } catch (error) {
      if (isOpaqueCandleError(error)) {
        return [];
      }
      throw error;
    }
  }

  async getTicker(symbol: string) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getTicker(exchangeSymbol, this.adapter.productType as any);
    const row = Array.isArray(raw) ? toRecord(raw[0] ?? null) : toRecord(raw);
    const last = pickNumber(row, ["lastPr", "last", "price", "close", "lastPrice"]);
    const mark = pickNumber(row, ["markPrice", "mark", "indexPrice", "markPx", "oraclePx", "fairPrice"]) ?? last;
    return {
      symbol: normalizeCanonicalSymbol(symbol),
      last,
      mark,
      bid: pickNumber(row, ["bidPr", "bidPrice", "bid", "bestBid", "bid1"]),
      ask: pickNumber(row, ["askPr", "askPrice", "ask", "bestAsk", "ask1"]),
      ts: pickNumber(row, ["ts", "timestamp", "time", "t"]),
      raw
    };
  }

  async getDepth(symbol: string, limit = 50) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getDepth(exchangeSymbol, limit, this.adapter.productType as any);
    const row = toRecord(raw) ?? {};
    const parseLevels = (value: unknown): Array<[number, number]> => {
      if (!Array.isArray(value)) return [];
      return value
        .map((level) => {
          if (!Array.isArray(level)) return null;
          const price = toNumber(level[0]);
          const qty = toNumber(level[1]);
          if (price === null || qty === null) return null;
          return [price, qty] as [number, number];
        })
        .filter((level): level is [number, number] => level !== null);
    };
    return {
      bids: parseLevels(row.bids),
      asks: parseLevels(row.asks),
      ts: pickNumber(row, ["ts", "timestamp", "time", "t", "uTime"]),
      raw
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const raw = await this.adapter.marketApi.getTrades(exchangeSymbol, limit, this.adapter.productType as any);
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((entry) => {
      const row = toRecord(entry);
      return {
        symbol: normalizeCanonicalSymbol(symbol),
        price: pickNumber(row, ["price", "px", "fillPrice", "p"]),
        qty: pickNumber(row, ["size", "qty", "q", "fillSize", "sz", "amount", "v"]),
        side: row?.side ? String(row.side).toLowerCase() : row?.S ? String(row.S).toLowerCase() : null,
        ts: pickNumber(row, ["ts", "timestamp", "cTime", "time", "t", "T"]),
        raw: entry
      };
    });
  }

  async getDerivativesSnapshot(symbol: string): Promise<PerpDerivativesSnapshot> {
    const exchangeSymbol = await this.adapter.toExchangeSymbol(symbol);
    const marketApi = this.adapter.marketApi as unknown as {
      getTicker(symbol: string, productType?: unknown): Promise<unknown>;
      getFundingRate?(symbol: string): Promise<unknown>;
      getMetaAndAssetCtxs?(): Promise<unknown>;
    };
    if (this.venue === "bitget") {
      const payload = await marketApi.getTicker(exchangeSymbol, this.adapter.productType);
      return normalizePerpDerivativesSnapshot({ venue: "bitget", symbol, primary: payload });
    }
    if (this.venue === "hyperliquid") {
      const payload = await marketApi.getMetaAndAssetCtxs?.();
      return normalizePerpDerivativesSnapshot({ venue: "hyperliquid", symbol, primary: payload });
    }
    if (this.venue === "mexc") {
      const [fundingPayload, tickerPayload] = await Promise.all([
        marketApi.getFundingRate?.(exchangeSymbol) ?? Promise.resolve(null),
        marketApi.getTicker(exchangeSymbol, this.adapter.productType)
      ]);
      return normalizePerpDerivativesSnapshot({ venue: "mexc", symbol, primary: fundingPayload, secondary: tickerPayload });
    }
    return {
      fundingRate: null,
      fundingIntervalHours: null,
      openInterest: null,
      openInterestUnit: "unknown",
      contractSize: null,
      markPrice: null,
      observedAt: new Date().toISOString(),
      sourceTimestampProvided: false,
      warnings: ["derivatives_snapshot_unsupported"]
    };
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    try {
      const ticker = await this.getTicker(symbol);
      const direct = ticker.mark ?? ticker.last;
      if (Number.isFinite(Number(direct)) && Number(direct) > 0) {
        return Number(direct);
      }
    } catch {
      // fallback below
    }
    try {
      const candles = await this.getCandles({
        symbol,
        granularity: "1m",
        limit: 3
      });
      if (!Array.isArray(candles)) return null;
      const rows = candles.slice().reverse();
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const close = toNumber(row[4]);
        if (close !== null && close > 0) return close;
      }
      return null;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}

class BinanceUsdMPerpClient implements PerpMarketDataClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  }

  private async fetchJson(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const search = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, String(value));
      }
    }
    const url = `${this.baseUrl}${path}${search.size > 0 ? `?${search.toString()}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        throw new ManualTradingError(
          `binance_perp_market_data_http_${response.status}`,
          response.status >= 500 ? 502 : 400,
          "binance_perp_market_data_failed"
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof ManualTradingError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ManualTradingError(
          "binance_perp_market_data_timeout",
          504,
          "binance_perp_market_data_timeout"
        );
      }
      throw new ManualTradingError(
        "binance_perp_market_data_network_error",
        502,
        "binance_perp_market_data_network_error"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async listSymbols(): Promise<PerpSymbolItem[]> {
    const payload = await this.fetchJson("/fapi/v1/exchangeInfo");
    const record = toRecord(payload);
    const symbols = Array.isArray(record?.symbols) ? record?.symbols : [];
    return symbols
      .map((entry) => {
        const row = toRecord(entry);
        const symbol = normalizeCanonicalSymbol(String(row?.symbol ?? ""));
        const contractType = String(row?.contractType ?? "").toUpperCase();
        const status = String(row?.status ?? "");
        const quoteAsset = row?.quoteAsset ? String(row.quoteAsset).toUpperCase() : null;
        const baseAsset = row?.baseAsset ? String(row.baseAsset).toUpperCase() : null;
        const filters = Array.isArray(row?.filters) ? row.filters : [];
        let tickSize: number | null = null;
        let stepSize: number | null = null;
        let minQty: number | null = null;
        let maxQty: number | null = null;
        for (const filterRaw of filters) {
          const filter = toRecord(filterRaw);
          const filterType = String(filter?.filterType ?? "");
          if (filterType === "PRICE_FILTER") {
            tickSize = toNumber(filter?.tickSize);
          } else if (filterType === "LOT_SIZE" || filterType === "MARKET_LOT_SIZE") {
            stepSize = toNumber(filter?.stepSize) ?? stepSize;
            minQty = toNumber(filter?.minQty) ?? minQty;
            maxQty = toNumber(filter?.maxQty) ?? maxQty;
          }
        }
        return {
          symbol,
          exchangeSymbol: symbol,
          status,
          tradable: status.toUpperCase() === "TRADING",
          tickSize,
          stepSize,
          minQty,
          maxQty,
          minLeverage: null,
          maxLeverage: null,
          quoteAsset,
          baseAsset,
          contractType
        };
      })
      .filter((row) => row.symbol.length > 0 && row.contractType === "PERPETUAL")
      .map(({ contractType: _ignored, ...row }) => row)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    const symbol = normalizeCanonicalSymbol(params.symbol);
    const interval = toBinanceInterval(params.granularity ?? params.timeframe);
    const payload = await this.fetchJson("/fapi/v1/klines", {
      symbol,
      interval,
      limit: Math.max(20, Math.min(1000, Math.trunc(params.limit ?? 500))),
      startTime: params.startTime,
      endTime: params.endTime
    });
    return Array.isArray(payload) ? payload : [];
  }

  async getTicker(symbol: string) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const raw = await this.fetchJson("/fapi/v1/ticker/bookTicker", {
      symbol: normalized
    });
    const row = toRecord(raw);
    const bid = toNumber(row?.bidPrice ?? row?.bid);
    const ask = toNumber(row?.askPrice ?? row?.ask);
    const last = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    return {
      symbol: normalized,
      last,
      mark: last,
      bid,
      ask,
      ts: null,
      raw
    };
  }

  async getDepth(symbol: string, limit = 50) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const requestedLimit = Number.isFinite(limit) ? Math.max(5, Math.min(200, Math.trunc(limit))) : 50;
    // Binance accepts discrete depth sizes; retain the caller's bounded coverage.
    const providerLimit = [5, 10, 20, 50, 100, 500].find(value => value >= requestedLimit)!;
    const raw = await this.fetchJson("/fapi/v1/depth", {
      symbol: normalized,
      limit: providerLimit
    });
    const row = toRecord(raw);
    const parseLevels = (value: unknown): Array<[number, number]> => {
      if (!Array.isArray(value)) return [];
      return value
        .map((level) => {
          if (!Array.isArray(level)) return null;
          const price = toNumber(level[0]);
          const qty = toNumber(level[1]);
          if (price === null || qty === null) return null;
          return [price, qty] as [number, number];
        })
        .filter((level): level is [number, number] => level !== null);
    };
    return {
      bids: parseLevels(row?.bids).slice(0, requestedLimit),
      asks: parseLevels(row?.asks).slice(0, requestedLimit),
      ts: toNumber(row?.E ?? row?.T),
      raw
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const normalized = normalizeCanonicalSymbol(symbol);
    const raw = await this.fetchJson("/fapi/v1/trades", {
      symbol: normalized,
      limit: Math.max(1, Math.min(1000, Math.trunc(limit)))
    });
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((entry) => {
      const row = toRecord(entry);
      const isBuyerMaker = Boolean(row?.isBuyerMaker ?? row?.m);
      return {
        symbol: normalized,
        price: toNumber(row?.price ?? row?.p),
        qty: toNumber(row?.qty ?? row?.q),
        side: isBuyerMaker ? "sell" : "buy",
        ts: toNumber(row?.time ?? row?.T),
        raw: entry
      };
    });
  }

  async getDerivativesSnapshot(symbol: string): Promise<PerpDerivativesSnapshot> {
    const normalized = normalizeCanonicalSymbol(symbol);
    const [premiumPayload, interestPayload] = await Promise.all([
      this.fetchJson("/fapi/v1/premiumIndex", { symbol: normalized }),
      this.fetchJson("/fapi/v1/openInterest", { symbol: normalized })
    ]);
    return normalizePerpDerivativesSnapshot({ venue: "binance", symbol: normalized, primary: premiumPayload, secondary: interestPayload });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const normalized = normalizeCanonicalSymbol(symbol);
    try {
      const raw = await this.fetchJson("/fapi/v1/ticker/price", { symbol: normalized });
      const row = toRecord(raw);
      const direct = toNumber(row?.price);
      if (direct !== null && direct > 0) return direct;
    } catch {
      // Fallback below.
    }
    const ticker = await this.getTicker(normalized);
    return Number.isFinite(Number(ticker.last)) && Number(ticker.last) > 0 ? Number(ticker.last) : null;
  }

  async close(): Promise<void> {
    // public REST client has no persistent resources
  }
}

class BingxUsdMPerpClient implements PerpMarketDataClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.BINGX_REST_BASE_URL ?? "https://open-api.bingx.com").replace(/\/+$/, "");
  }

  private async fetchJson(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const search = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, String(value));
      }
    }
    const url = `${this.baseUrl}${path}${search.size > 0 ? `?${search.toString()}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      const record = toRecord(payload);
      const code = record?.code === undefined ? 0 : Number(record.code);
      if (!response.ok || code !== 0) {
        throw new ManualTradingError(
          `bingx_perp_market_data_http_${response.status}`,
          response.status >= 500 ? 502 : 400,
          "bingx_perp_market_data_failed"
        );
      }
      return record && Object.prototype.hasOwnProperty.call(record, "data") ? record.data : payload;
    } catch (error) {
      if (error instanceof ManualTradingError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ManualTradingError(
          "bingx_perp_market_data_timeout",
          504,
          "bingx_perp_market_data_timeout"
        );
      }
      throw new ManualTradingError(
        "bingx_perp_market_data_network_error",
        502,
        "bingx_perp_market_data_network_error"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async listSymbols(): Promise<PerpSymbolItem[]> {
    const payload = await this.fetchJson("/openApi/swap/v2/quote/contracts");
    const rows = Array.isArray(payload) ? payload : [];
    return rows
      .map((entry) => {
        const row = toRecord(entry);
        const exchangeSymbol = String(row?.symbol ?? "");
        const symbol = normalizeCanonicalSymbol(exchangeSymbol);
        const status = String(row?.status ?? "");
        const openEnabled = isBingxApiStateEnabled(row?.apiStateOpen);
        const closeEnabled = isBingxApiStateEnabled(row?.apiStateClose);
        return {
          symbol,
          exchangeSymbol,
          status,
          tradable: status === "1" && openEnabled && closeEnabled,
          tickSize: precisionToStep(row?.pricePrecision),
          stepSize: precisionToStep(row?.quantityPrecision),
          minQty: toNumber(row?.tradeMinQuantity ?? row?.tradeMinLimit),
          maxQty: null,
          minLeverage: null,
          maxLeverage: null,
          quoteAsset: row?.currency ? String(row.currency).toUpperCase() : null,
          baseAsset: row?.asset ? String(row.asset).toUpperCase() : null
        };
      })
      .filter((row) => row.symbol.length > 0 && row.exchangeSymbol.length > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe?: string;
    granularity?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown> {
    const symbol = toBingxSwapSymbol(params.symbol);
    const interval = toBingxInterval(params.granularity ?? params.timeframe);
    const payload = await this.fetchJson("/openApi/swap/v3/quote/klines", {
      symbol,
      interval,
      limit: Math.max(20, Math.min(1000, Math.trunc(params.limit ?? 500))),
      startTime: params.startTime,
      endTime: params.endTime
    });
    return Array.isArray(payload) ? payload : [];
  }

  async getTicker(symbol: string) {
    const exchangeSymbol = toBingxSwapSymbol(symbol);
    const raw = await this.fetchJson("/openApi/swap/v2/quote/bookTicker", {
      symbol: exchangeSymbol
    });
    const rawRecord = toRecord(raw);
    const row = toRecord(rawRecord?.book_ticker ?? rawRecord?.bookTicker ?? raw);
    const bid = toNumber(row?.bid_price ?? row?.bidPrice ?? row?.bid);
    const ask = toNumber(row?.ask_price ?? row?.askPrice ?? row?.ask);
    const last = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    return {
      symbol: normalizeCanonicalSymbol(symbol),
      last,
      mark: last,
      bid,
      ask,
      ts: pickNumber(row, ["time", "ts", "timestamp", "T", "lastUpdateId"]),
      raw
    };
  }

  async getDepth(symbol: string, limit = 50) {
    const exchangeSymbol = toBingxSwapSymbol(symbol);
    const requestedLimit = Number.isFinite(limit) ? Math.max(5, Math.min(200, Math.trunc(limit))) : 50;
    // BingX accepts discrete sizes; preserve the caller's normalized coverage.
    const providerLimit = [5, 10, 20, 50, 100, 500].find(value => value >= requestedLimit)!;
    const raw = await this.fetchJson("/openApi/swap/v2/quote/depth", {
      symbol: exchangeSymbol,
      limit: providerLimit
    });
    const row = toRecord(raw);
    return {
      bids: parseOrderBookLevels(row?.bids).slice(0, requestedLimit),
      asks: parseOrderBookLevels(row?.asks).slice(0, requestedLimit),
      ts: pickNumber(row, ["T", "ts", "timestamp", "time", "t"]),
      raw
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const exchangeSymbol = toBingxSwapSymbol(symbol);
    const raw = await this.fetchJson("/openApi/swap/v2/quote/trades", {
      symbol: exchangeSymbol,
      limit: Math.max(1, Math.min(100, Math.trunc(limit)))
    });
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((entry) => {
      const row = toRecord(entry);
      const isBuyerMaker = typeof row?.isBuyerMaker === "boolean" ? row.isBuyerMaker : null;
      return {
        symbol: normalizeCanonicalSymbol(symbol),
        price: toNumber(row?.price ?? row?.p),
        qty: toNumber(row?.qty ?? row?.q),
        side: isBuyerMaker === null ? null : isBuyerMaker ? "sell" : "buy",
        ts: pickNumber(row, ["time", "ts", "timestamp", "T"]),
        raw: entry
      };
    });
  }

  async getDerivativesSnapshot(_symbol: string): Promise<PerpDerivativesSnapshot> {
    return normalizePerpDerivativesSnapshot({ venue: "bingx", symbol: _symbol });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const exchangeSymbol = toBingxSwapSymbol(symbol);
    try {
      const raw = await this.fetchJson("/openApi/swap/v2/quote/price", { symbol: exchangeSymbol });
      const row = toRecord(raw);
      const direct = toNumber(row?.price);
      if (direct !== null && direct > 0) return direct;
    } catch {
      // Fallback below.
    }
    const ticker = await this.getTicker(symbol);
    return Number.isFinite(Number(ticker.last)) && Number(ticker.last) > 0 ? Number(ticker.last) : null;
  }

  async close(): Promise<void> {
    // public REST client has no persistent resources
  }
}

export function createPerpMarketDataClient(account: TradingAccount): PerpMarketDataClient {
  const exchange = String(account.exchange ?? "").trim().toLowerCase();
  if (exchange === "binance") {
    return new BinanceUsdMPerpClient();
  }
  if (exchange === "bingx") {
    return new BingxUsdMPerpClient();
  }

  const adapterResult = createResolvedFuturesAdapter({
    exchange: account.exchange,
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    passphrase: account.passphrase
  });
  if (adapterResult.kind !== "adapter") {
    throw new ManualTradingError(adapterResult.resolution.code, 400, adapterResult.resolution.code);
  }
  return new FuturesAdapterPerpMarketDataClient(adapterResult.adapter, exchange as "bitget" | "hyperliquid" | "mexc");
}

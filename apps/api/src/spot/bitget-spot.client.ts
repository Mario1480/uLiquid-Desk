import { ManualTradingError, type NormalizedOrder } from "../trading.js";
import {
  isBitgetHttpError,
  requestBitgetApi,
  type BitgetQuery
} from "../bitget/bitget-http.js";
import {
  mapSpotOrderRow,
  mapSpotSymbolRow,
  mapSpotTickerRow,
  mapSpotTradeRow,
  marketTimeframeToBitgetSpotGranularity,
  normalizeSpotSymbol,
  selectSpotSummary
} from "./bitget-spot.mapper.js";
import type {
  BitgetSpotBalanceRow,
  BitgetSpotDepthRow,
  BitgetSpotHttpMethod,
  BitgetSpotOpenOrderRow,
  BitgetSpotPlaceOrderInput,
  BitgetSpotPlaceOrderResult,
  BitgetSpotSymbolRow,
  BitgetSpotTickerRow,
  BitgetSpotTradeRow
} from "./bitget-spot.types.js";

type BitgetSpotClientConfig = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  baseUrl?: string;
};

type SpotSymbolMeta = {
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = toRecord(value);
  if (!record) return [];
  for (const key of ["list", "items", "orderList", "entrustedList", "data"]) {
    const row = record[key];
    if (Array.isArray(row)) return row;
  }
  return [];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const row of value) {
      const rec = toRecord(row);
      if (rec) return rec;
    }
    return null;
  }
  return toRecord(value);
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNotFoundError(error: unknown): boolean {
  if (isBitgetHttpError(error)) {
    return error.code === "bitget_endpoint_not_found" || error.status === 404;
  }
  const message = String(error ?? "").toLowerCase();
  return message.includes("404") || message.includes("not found") || message.includes("path");
}

function mapBitgetSpotError(error: unknown): ManualTradingError {
  if (error instanceof ManualTradingError) return error;
  if (!isBitgetHttpError(error)) {
    return new ManualTradingError("bitget_spot_network_error", 502, "bitget_spot_network_error");
  }

  if (error.code === "bitget_auth_failed") {
    return new ManualTradingError(`Bitget spot request failed: ${error.message}`, 401, "bitget_spot_auth_failed");
  }
  if (error.code === "bitget_endpoint_not_found") {
    return new ManualTradingError(`Bitget spot request failed: ${error.message}`, 502, "bitget_spot_endpoint_not_found");
  }
  if (error.code === "bitget_timeout") {
    return new ManualTradingError("bitget_spot_timeout", 504, "bitget_spot_timeout");
  }
  if (error.code === "bitget_network_error") {
    return new ManualTradingError("bitget_spot_network_error", 502, "bitget_spot_network_error");
  }
  if (error.code === "bitget_bad_response") {
    return new ManualTradingError("bitget_spot_bad_response", 502, "bitget_spot_bad_response");
  }

  const status = error.status >= 500 ? 502 : error.status >= 400 ? error.status : 400;
  return new ManualTradingError(`Bitget spot request failed: ${error.message}`, status, "bitget_spot_request_failed");
}

function countDecimals(value: number): number {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) {
    const [base, expPart] = text.split("e-");
    const exponent = Number(expPart);
    const baseDecimals = (base.split(".")[1] ?? "").length;
    if (Number.isFinite(exponent)) {
      return Math.min(12, Math.max(0, exponent + baseDecimals));
    }
  }
  return Math.min(12, Math.max(0, (text.split(".")[1] ?? "").length));
}

function formatDecimal(value: number, decimals: number): string {
  const safeDecimals = Math.max(0, Math.min(12, Math.trunc(decimals)));
  return value
    .toFixed(safeDecimals)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

export class BitgetSpotClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly apiPassphrase: string;
  private symbolMetaCache: Map<string, SpotSymbolMeta> | null = null;

  constructor(config: BitgetSpotClientConfig) {
    this.apiKey = config.apiKey.trim();
    this.apiSecret = config.apiSecret.trim();
    this.apiPassphrase = config.apiPassphrase.trim();
    this.baseUrl = (config.baseUrl ?? process.env.BITGET_REST_BASE_URL ?? "https://api.bitget.com").replace(/\/+$/, "");
    if (!this.apiKey || !this.apiSecret || !this.apiPassphrase) {
      throw new ManualTradingError("bitget_passphrase_required", 400, "bitget_passphrase_required");
    }
  }

  private async request<T>(params: {
    path: string;
    method?: BitgetSpotHttpMethod;
    query?: BitgetQuery;
    body?: unknown;
    auth?: boolean;
  }): Promise<T> {
    try {
      return await requestBitgetApi<T>({
        baseUrl: this.baseUrl,
        path: params.path,
        method: params.method ?? "GET",
        query: params.query,
        body: params.body,
        auth: params.auth
          ? {
              apiKey: this.apiKey,
              apiSecret: this.apiSecret,
              apiPassphrase: this.apiPassphrase
            }
          : undefined,
        timeoutMs: 12_000,
        retryMode: "safe_get",
        maxAttempts: params.method === "GET" || params.method === undefined ? 2 : 1
      });
    } catch (error) {
      throw mapBitgetSpotError(error);
    }
  }

  async listSymbols() {
    const data = await this.request<BitgetSpotSymbolRow[]>({
      path: "/api/v2/spot/public/symbols"
    });

    return toArray(data)
      .map((row) => mapSpotSymbolRow((row ?? {}) as BitgetSpotSymbolRow))
      .filter((row): row is NonNullable<ReturnType<typeof mapSpotSymbolRow>> => Boolean(row))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  private async getSymbolMeta(symbol: string): Promise<SpotSymbolMeta | null> {
    const normalizedSymbol = normalizeSpotSymbol(symbol);
    if (!normalizedSymbol) return null;
    if (!this.symbolMetaCache) {
      const symbols = await this.listSymbols();
      this.symbolMetaCache = new Map(
        symbols.map((row) => [
          row.symbol,
          {
            stepSize: Number.isFinite(Number(row.stepSize)) ? Number(row.stepSize) : null,
            minQty: Number.isFinite(Number(row.minQty)) ? Number(row.minQty) : null,
            maxQty: Number.isFinite(Number(row.maxQty)) ? Number(row.maxQty) : null
          }
        ])
      );
    }
    return this.symbolMetaCache.get(normalizedSymbol) ?? null;
  }

  private async normalizeOrderSize(symbol: string, qtyRaw: number): Promise<string> {
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
    }

    const meta = await this.getSymbolMeta(symbol);
    const stepSize = Number(meta?.stepSize ?? NaN);
    const minQty = Number(meta?.minQty ?? NaN);
    const maxQty = Number(meta?.maxQty ?? NaN);
    const hasStep = Number.isFinite(stepSize) && stepSize > 0;
    const decimals = hasStep ? countDecimals(stepSize) : 6;

    let normalized = hasStep
      ? Math.floor(qty / stepSize) * stepSize
      : Number(qty.toFixed(decimals));
    normalized = Number(normalized.toFixed(decimals));

    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new ManualTradingError("quantity_below_min", 400, "quantity_below_min");
    }
    if (Number.isFinite(minQty) && minQty > 0 && normalized + 1e-12 < minQty) {
      throw new ManualTradingError("quantity_below_min", 400, "quantity_below_min");
    }
    if (Number.isFinite(maxQty) && maxQty > 0 && normalized - 1e-12 > maxQty) {
      throw new ManualTradingError("quantity_above_max", 400, "quantity_above_max");
    }

    return formatDecimal(normalized, decimals);
  }

  async getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown> {
    return this.request<unknown>({
      path: "/api/v2/spot/market/candles",
      query: {
        symbol: normalizeSpotSymbol(params.symbol),
        granularity: marketTimeframeToBitgetSpotGranularity(params.timeframe),
        limit: Math.max(20, Math.min(1000, Math.trunc(params.limit)))
      }
    });
  }

  async getTicker(symbol: string) {
    const data = await this.request<BitgetSpotTickerRow[] | Record<string, unknown>>({
      path: "/api/v2/spot/market/tickers",
      query: {
        symbol: normalizeSpotSymbol(symbol)
      }
    });

    const row = firstRecord(data) as BitgetSpotTickerRow | null;
    return mapSpotTickerRow(row ?? {}, symbol);
  }

  async getDepth(symbol: string, limit = 50): Promise<BitgetSpotDepthRow> {
    const data = await this.request<BitgetSpotDepthRow>({
      path: "/api/v2/spot/market/orderbook",
      query: {
        symbol: normalizeSpotSymbol(symbol),
        type: "step0",
        limit: Math.max(1, Math.min(200, Math.trunc(limit)))
      }
    });

    return {
      asks: Array.isArray((data as any)?.asks) ? (data as any).asks : [],
      bids: Array.isArray((data as any)?.bids) ? (data as any).bids : [],
      ts: (data as any)?.ts
    };
  }

  async getTrades(symbol: string, limit = 60) {
    const data = await this.request<BitgetSpotTradeRow[] | Record<string, unknown>>({
      path: "/api/v2/spot/market/fills",
      query: {
        symbol: normalizeSpotSymbol(symbol),
        limit: Math.max(1, Math.min(100, Math.trunc(limit)))
      }
    });

    return toArray(data)
      .map((row) => mapSpotTradeRow((row ?? {}) as BitgetSpotTradeRow, symbol));
  }

  async getBalances(): Promise<BitgetSpotBalanceRow[]> {
    const data = await this.request<BitgetSpotBalanceRow[]>({
      path: "/api/v2/spot/account/assets",
      auth: true
    });

    return toArray(data).map((row) => (row ?? {}) as BitgetSpotBalanceRow);
  }

  async getSummary(preferredCurrency = "USDT") {
    const balances = await this.getBalances();
    return selectSpotSummary(balances, preferredCurrency);
  }

  async getOpenOrders(symbol?: string): Promise<NormalizedOrder[]> {
    const query = symbol ? { symbol: normalizeSpotSymbol(symbol) } : undefined;

    let raw: unknown;
    try {
      raw = await this.request<BitgetSpotOpenOrderRow[] | Record<string, unknown>>({
        path: "/api/v2/spot/trade/unfilled-orders",
        query,
        auth: true
      });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      raw = await this.request<BitgetSpotOpenOrderRow[] | Record<string, unknown>>({
        path: "/api/v2/spot/trade/open-orders",
        query,
        auth: true
      });
    }

    return toArray(raw)
      .map((row) => mapSpotOrderRow((row ?? {}) as BitgetSpotOpenOrderRow))
      .filter((row): row is NormalizedOrder => Boolean(row));
  }

  async placeOrder(input: BitgetSpotPlaceOrderInput): Promise<BitgetSpotPlaceOrderResult> {
    if (input.type === "limit" && (!Number.isFinite(input.price) || Number(input.price) <= 0)) {
      throw new ManualTradingError("limit_requires_price", 400, "limit_requires_price");
    }

    const symbol = normalizeSpotSymbol(input.symbol);
    const isMarketBuy = input.type === "market" && input.side === "buy";
    let normalizedSize: string;
    if (isMarketBuy) {
      const price = Number(await this.getLastPrice(symbol));
      if (!Number.isFinite(price) || price <= 0) {
        throw new ManualTradingError("spot_market_price_unavailable", 422, "spot_market_price_unavailable");
      }
      const quoteAmount = Number(input.qty) * price;
      if (!Number.isFinite(quoteAmount) || quoteAmount < 1) {
        throw new ManualTradingError("quantity_below_min_quote", 400, "quantity_below_min_quote");
      }
      // Bitget spot market-buy size is quote amount with max 6 decimals.
      normalizedSize = formatDecimal(quoteAmount, 6);
    } else {
      normalizedSize = await this.normalizeOrderSize(symbol, input.qty);
    }

    const body: Record<string, unknown> = {
      symbol,
      side: input.side,
      orderType: input.type,
      size: normalizedSize
    };

    if (input.type === "limit") {
      body.force = "gtc";
      body.price = String(input.price);
    }

    const data = await this.request<Record<string, unknown>>({
      path: "/api/v2/spot/trade/place-order",
      method: "POST",
      body,
      auth: true
    });

    const orderId = String((data as any)?.orderId ?? (data as any)?.clientOid ?? "").trim();
    if (!orderId) {
      throw new ManualTradingError("bitget_spot_place_order_missing_id", 502, "bitget_spot_place_order_missing_id");
    }

    return { orderId };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request<Record<string, unknown>>({
      path: "/api/v2/spot/trade/cancel-order",
      method: "POST",
      body: {
        symbol: normalizeSpotSymbol(symbol),
        orderId
      },
      auth: true
    });
  }

  async cancelAll(symbol?: string): Promise<{ requested: number; cancelled: number; failed: number }> {
    if (!symbol) {
      const open = await this.getOpenOrders();
      if (open.length === 0) {
        return {
          requested: 0,
          cancelled: 0,
          failed: 0
        };
      }
      const results = await Promise.allSettled(
        open.map((row) => this.cancelOrder(row.symbol, row.orderId))
      );
      const cancelled = results.filter((row) => row.status === "fulfilled").length;
      return {
        requested: results.length,
        cancelled,
        failed: results.length - cancelled
      };
    }

    const normalized = normalizeSpotSymbol(symbol);
    try {
      await this.request<Record<string, unknown>>({
        path: "/api/v2/spot/trade/cancel-symbol-order",
        method: "POST",
        body: {
          symbol: normalized
        },
        auth: true
      });
      return {
        requested: 1,
        cancelled: 1,
        failed: 0
      };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const open = await this.getOpenOrders(normalized);
      const results = await Promise.allSettled(open.map((row) => this.cancelOrder(normalized, row.orderId)));
      const cancelled = results.filter((row) => row.status === "fulfilled").length;
      return {
        requested: results.length,
        cancelled,
        failed: results.length - cancelled
      };
    }
  }

  async editOrder(params: {
    symbol: string;
    orderId: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
  }): Promise<{ orderId: string }> {
    await this.cancelOrder(params.symbol, params.orderId);
    const replacement = await this.placeOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      price: params.price
    });
    return {
      orderId: replacement.orderId
    };
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(symbol);
    return toNumber(ticker.last) ?? toNumber(ticker.mark) ?? null;
  }
}

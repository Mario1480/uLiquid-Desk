import crypto from "node:crypto";
import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import { nowMs } from "@mm/core";
import { fromExchangeSymbol, toExchangeSymbol } from "../symbols.js";
import { checkMins, normalizePrice, normalizeQty, type SymbolMeta } from "./binance.meta.js";

type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | undefined>;
  auth?: "NONE" | "SIGNED";
};

export type BinanceSpotSymbolInfo = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  quoteAsset: string | null;
  baseAsset: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number) {
  return Math.floor(ms * (0.8 + Math.random() * 0.4));
}

function parseNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const pairs: [string, string][] = entries.map(([k, v]) => [k, String(v)]);
  return new URLSearchParams(pairs).toString();
}

function mapOrderStatus(status: string): Order["status"] {
  const s = String(status || "").toUpperCase();
  if (s === "NEW" || s === "PARTIALLY_FILLED") return "open";
  if (s === "FILLED") return "filled";
  if (s === "CANCELED" || s === "PENDING_CANCEL") return "canceled";
  if (s === "REJECTED" || s === "EXPIRED" || s === "EXPIRED_IN_MATCH") return "rejected";
  return "unknown";
}

function sideFromValue(value: unknown): "buy" | "sell" {
  return String(value || "").toUpperCase() === "SELL" ? "sell" : "buy";
}

export function buildBinanceSignature(query: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

export class BinanceRestClient {
  private static queue: Promise<unknown> = Promise.resolve();
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.BINANCE_MIN_GAP_MS || "120");
  private readonly metaCache = new Map<string, { meta: SymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: string[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private readonly recvWindow = Number(process.env.BINANCE_RECV_WINDOW || "5000");

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = BinanceRestClient.queue.then(fn, fn);
    BinanceRestClient.queue = run.catch(() => undefined);
    return run;
  }

  private async parseJson(res: Response, label: string): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    if (text.includes("Just a moment") || text.includes("cf-browser-verification")) {
      throw new Error("IP_NOT_WHITELISTED_OR_WAF_BLOCK");
    }
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`[binance] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<T> {
    return BinanceRestClient.enqueue(async () => {
      const { method, path, params = {}, auth = "NONE" } = opts;
      const url = new URL(path, this.baseUrl);

      let query = buildQuery(params);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };

      if (auth === "SIGNED") {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error("[binance] missing api credentials");
        }
        const signedParams: Record<string, string | number> = {
          ...params,
          timestamp: nowMs(),
          recvWindow: this.recvWindow
        };
        query = buildQuery(signedParams);
        const signature = buildBinanceSignature(query, this.apiSecret);
        query = `${query}&signature=${signature}`;
        headers["X-MBX-APIKEY"] = this.apiKey;
      }

      if (query) url.search = query;

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - BinanceRestClient.lastRequestAt;
        if (gap < BinanceRestClient.minGapMs) {
          await sleep(BinanceRestClient.minGapMs - gap);
        }
        BinanceRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, {
          method,
          headers,
          body: undefined
        });

        if (res.status === 404) {
          throw new Error("BASE_URL_OR_PATH_INVALID");
        }

        const json = await this.parseJson(res, `${method} ${path}`);
        const hasApiError = json && typeof json === "object" && (json.code !== undefined || json.msg !== undefined);
        const code = hasApiError ? Number(json.code) : 0;
        if (!res.ok || (hasApiError && Number.isFinite(code) && code !== 0)) {
          const msg = json?.msg || json?.message || res.statusText || "request_failed";
          const err = new Error(`Binance API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await sleep(withJitter(backoff));
            attempt += 1;
            continue;
          }
          throw err;
        }

        return json as T;
      }
    });
  }

  private async getExchangeInfo(): Promise<any> {
    return this.request<any>({ method: "GET", path: "/api/v3/exchangeInfo", auth: "NONE" });
  }

  private parseSymbolMeta(row: any): SymbolMeta {
    const filters = Array.isArray(row?.filters) ? row.filters : [];
    const priceFilter = filters.find((f: any) => f?.filterType === "PRICE_FILTER") ?? {};
    const lotSize = filters.find((f: any) => f?.filterType === "LOT_SIZE") ?? {};
    const minNotionalFilter =
      filters.find((f: any) => f?.filterType === "MIN_NOTIONAL") ??
      filters.find((f: any) => f?.filterType === "NOTIONAL") ??
      {};

    return {
      symbol: String(row?.symbol || ""),
      priceStep: parseNumber(priceFilter?.tickSize) || undefined,
      qtyStep: parseNumber(lotSize?.stepSize) || undefined,
      minQty: parseNumber(lotSize?.minQty) || undefined,
      minNotional:
        parseNumber(minNotionalFilter?.minNotional) || parseNumber(minNotionalFilter?.notional) || undefined,
      pricePrecision: Number(row?.quotePrecision ?? row?.baseAssetPrecision ?? 8),
      qtyPrecision: Number(row?.baseAssetPrecision ?? 8)
    };
  }

  private parseSymbolInfo(row: any): BinanceSpotSymbolInfo {
    const filters = Array.isArray(row?.filters) ? row.filters : [];
    const priceFilter = filters.find((f: any) => f?.filterType === "PRICE_FILTER") ?? {};
    const lotSize = filters.find((f: any) => f?.filterType === "LOT_SIZE") ?? {};
    const exchangeSymbol = String(row?.symbol || "").toUpperCase();
    const status = String(row?.status || "").toUpperCase();
    return {
      symbol: fromExchangeSymbol("binance", exchangeSymbol),
      exchangeSymbol,
      status: status === "TRADING" ? "online" : "offline",
      tradable: status === "TRADING" && row?.isSpotTradingAllowed !== false,
      tickSize: parseNumber(priceFilter?.tickSize) || null,
      stepSize: parseNumber(lotSize?.stepSize) || null,
      minQty: parseNumber(lotSize?.minQty) || null,
      maxQty: parseNumber(lotSize?.maxQty) || null,
      quoteAsset: row?.quoteAsset ? String(row.quoteAsset).toUpperCase() : null,
      baseAsset: row?.baseAsset ? String(row.baseAsset).toUpperCase() : null
    };
  }

  private async getSymbolMeta(symbol: string): Promise<SymbolMeta | undefined> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const cached = this.metaCache.get(exSymbol);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) {
      return cached.meta;
    }

    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : [];
    const row = list.find((x: any) => String(x?.symbol || "").toUpperCase() === exSymbol.toUpperCase());
    if (!row) return undefined;
    const meta = this.parseSymbolMeta(row);
    this.metaCache.set(exSymbol, { meta, ts: Date.now() });
    return meta;
  }

  async listSymbols(): Promise<string[]> {
    const cached = this.symbolCache.get("symbols");
    if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) {
      return cached.symbols;
    }

    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : [];
    const symbols = list
      .filter((x: any) => String(x?.status || "").toUpperCase() === "TRADING")
      .filter((x: any) => x?.isSpotTradingAllowed !== false)
      .map((x: any) => fromExchangeSymbol("binance", String(x.symbol || "")))
      .filter(Boolean);

    this.symbolCache.set("symbols", { symbols, ts: Date.now() });
    return symbols;
  }

  async listSymbolDetails(): Promise<BinanceSpotSymbolInfo[]> {
    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : [];
    return list
      .map((row: any) => this.parseSymbolInfo(row))
      .filter((row: BinanceSpotSymbolInfo) => Boolean(row.symbol))
      .sort((a: BinanceSpotSymbolInfo, b: BinanceSpotSymbolInfo) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown[]> {
    const exSymbol = toExchangeSymbol("binance", params.symbol);
    return this.request<unknown[]>({
      method: "GET",
      path: "/api/v3/klines",
      params: {
        symbol: exSymbol,
        interval: params.timeframe,
        limit: Math.min(1000, Math.max(1, params.limit))
      },
      auth: "NONE"
    });
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v3/ticker/bookTicker",
      params: { symbol: exSymbol },
      auth: "NONE"
    });

    const bid = parseNumber(json?.bidPrice);
    const ask = parseNumber(json?.askPrice);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

    return {
      mid,
      bid,
      ask,
      last: mid,
      ts: Date.now()
    };
  }

  async getDepth(symbol: string, limit = 50): Promise<{
    asks: Array<[string | number, string | number]>;
    bids: Array<[string | number, string | number]>;
    ts?: string | number;
  }> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v3/depth",
      params: {
        symbol: exSymbol,
        limit: Math.min(5000, Math.max(1, limit))
      },
      auth: "NONE"
    });
    return {
      asks: Array.isArray(json?.asks) ? json.asks : [],
      bids: Array.isArray(json?.bids) ? json.bids : [],
      ts: json?.lastUpdateId
    };
  }

  async getTrades(symbol: string, limit = 60): Promise<Array<{
    symbol: string;
    price: number | null;
    qty: number | null;
    side: string | null;
    ts: number | null;
  }>> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const rows = await this.request<any[]>({
      method: "GET",
      path: "/api/v3/trades",
      params: {
        symbol: exSymbol,
        limit: Math.min(1000, Math.max(1, limit))
      },
      auth: "NONE"
    });
    return (Array.isArray(rows) ? rows : []).map((row: any) => ({
      symbol: fromExchangeSymbol("binance", exSymbol),
      price: parseNumber(row?.price) || null,
      qty: parseNumber(row?.qty) || null,
      side: row?.isBuyerMaker === true ? "sell" : row?.isBuyerMaker === false ? "buy" : null,
      ts: parseNumber(row?.time) || null
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({ method: "GET", path: "/api/v3/account", auth: "SIGNED" });
    const list = Array.isArray(json?.balances) ? json.balances : [];
    return list
      .map((b: any) => ({
        asset: String(b?.asset || "").toUpperCase(),
        free: parseNumber(b?.free),
        locked: parseNumber(b?.locked)
      }))
      .filter((b: Balance) => Boolean(b.asset));
  }

  async getSummary(preferredCurrency = "USDT"): Promise<{ equity: number | null; available: number | null; currency: string }> {
    const currency = String(preferredCurrency || "USDT").toUpperCase();
    const balances = await this.getBalances();
    const preferred = balances.find((row) => row.asset === currency);
    if (!preferred) {
      return {
        equity: null,
        available: null,
        currency
      };
    }
    return {
      equity: (preferred.free ?? 0) + (preferred.locked ?? 0),
      available: preferred.free ?? 0,
      currency
    };
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const exSymbol = symbol ? toExchangeSymbol("binance", symbol) : undefined;
    const json = await this.request<any[]>({
      method: "GET",
      path: "/api/v3/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });

    const rows = Array.isArray(json) ? json : [];
    return rows.map((row: any) => {
      const qty = parseNumber(row.origQty);
      const executed = parseNumber(row.executedQty);
      const left = qty > executed ? qty - executed : qty;
      return {
        id: String(row.orderId ?? ""),
        symbol: fromExchangeSymbol("binance", row.symbol || exSymbol || ""),
        side: sideFromValue(row.side),
        price: parseNumber(row.price),
        qty: left,
        status: mapOrderStatus(String(row.status || "NEW")),
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined
      } as Order;
    });
  }

  async placeOrder(q: Quote): Promise<Order> {
    const exSymbol = toExchangeSymbol("binance", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);

    const params: Record<string, string | number | undefined> = {
      symbol: exSymbol,
      side: q.side.toUpperCase(),
      newClientOrderId: q.clientOrderId
    };

    let normalizedPrice = 0;
    let normalizedQty = 0;

    if (q.type === "market") {
      params.type = "MARKET";
      if (q.side === "buy" && q.quoteQty && q.quoteQty > 0) {
        params.quoteOrderQty = q.quoteQty;
      } else {
        normalizedQty = normalizeQty(q.qty ?? 0, meta);
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
          throw new Error("[binance] QTY_NORMALIZED_TO_ZERO");
        }
        params.quantity = normalizedQty;
      }
    } else {
      normalizedPrice = normalizePrice(q.price ?? 0, meta);
      normalizedQty = normalizeQty(q.qty ?? 0, meta);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        throw new Error("[binance] PRICE_NORMALIZED_TO_ZERO");
      }
      if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
        throw new Error("[binance] QTY_NORMALIZED_TO_ZERO");
      }

      const minCheck = checkMins({ price: normalizedPrice, qty: normalizedQty, meta });
      if (!minCheck.ok) {
        throw new Error(`[binance] min check failed: ${minCheck.reason}`);
      }

      if (q.postOnly) {
        params.type = "LIMIT_MAKER";
      } else {
        params.type = "LIMIT";
        params.timeInForce = "GTC";
      }
      params.price = normalizedPrice;
      params.quantity = normalizedQty;
    }

    const json = await this.request<any>({ method: "POST", path: "/api/v3/order", params, auth: "SIGNED" });
    return {
      id: String(json?.orderId ?? ""),
      symbol: q.symbol,
      side: q.side,
      price: normalizedPrice || parseNumber(q.price),
      qty: normalizedQty || parseNumber(q.qty),
      status: "open",
      clientOrderId: String(json?.clientOrderId ?? params.newClientOrderId ?? "") || undefined
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    await this.request({
      method: "DELETE",
      path: "/api/v3/order",
      params: { symbol: exSymbol, orderId },
      auth: "SIGNED"
    });
  }

  async cancelAll(symbol?: string): Promise<void> {
    if (!symbol) {
      const open = await this.getOpenOrders();
      await Promise.allSettled(open.map((order) => this.cancelOrder(order.symbol, order.id)));
      return;
    }
    const exSymbol = symbol ? toExchangeSymbol("binance", symbol) : undefined;
    await this.request({
      method: "DELETE",
      path: "/api/v3/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/api/v3/ticker/price",
      params: { symbol: exSymbol },
      auth: "NONE"
    });
    const price = parseNumber(json?.price);
    return price > 0 ? price : null;
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    const exSymbol = toExchangeSymbol("binance", symbol);
    const limit = Math.min(1000, Math.max(1, params?.limit ?? 500));
    const json = await this.request<any[]>({
      method: "GET",
      path: "/api/v3/myTrades",
      params: {
        symbol: exSymbol,
        startTime: params?.startTimeMs,
        limit
      },
      auth: "SIGNED"
    });

    const rows = Array.isArray(json) ? json : [];
    return rows.map((row: any) => {
      const price = parseNumber(row.price);
      const qty = parseNumber(row.qty);
      const notional = parseNumber(row.quoteQty) || price * qty;
      return {
        id: String(row.id ?? `${row.orderId}-${row.time}`),
        orderId: row.orderId !== undefined ? String(row.orderId) : undefined,
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined,
        side: row.isBuyer === false ? "sell" : "buy",
        price,
        qty,
        notional,
        timestamp: parseNumber(row.time)
      } as MyTrade;
    });
  }
}

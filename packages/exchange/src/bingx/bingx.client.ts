import type { Balance, MidPrice, MyTrade, Order, Quote } from "@mm/core";
import { nowMs } from "@mm/core";
import { fromExchangeSymbol, toExchangeSymbol } from "../symbols.js";
import {
  checkMins,
  normalizePrice,
  normalizeQty,
  precisionToStep,
  type BingxSymbolMeta
} from "./bingx.meta.js";
import {
  buildBingxQueryString,
  buildSignedBingxQuery,
  type BingxSignableValue
} from "./bingx.signing.js";

type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, BingxSignableValue>;
  auth?: "NONE" | "SIGNED";
};

export type BingxSpotSymbolInfo = {
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

function toRows(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["rows", "list", "orders", "trades", "balances", "data"]) {
      if (Array.isArray(record[key])) return record[key] as any[];
    }
  }
  return [];
}

function mapOrderStatus(status: unknown): Order["status"] {
  const s = String(status || "").toUpperCase();
  if (s === "NEW" || s === "PARTIALLY_FILLED" || s === "PENDING" || s === "LIVE") return "open";
  if (s === "FILLED" || s === "FULLY_FILLED") return "filled";
  if (s === "CANCELED" || s === "CANCELLED" || s === "PENDING_CANCEL") return "canceled";
  if (s === "REJECTED" || s === "EXPIRED") return "rejected";
  return "unknown";
}

function sideFromValue(value: unknown): "buy" | "sell" {
  return String(value || "").toUpperCase() === "SELL" ? "sell" : "buy";
}

function statusIsTradable(row: any): boolean {
  const status = String(row?.status ?? "").trim().toUpperCase();
  const buy = String(row?.apiStateBuy ?? row?.apiState ?? "").trim().toLowerCase();
  const sell = String(row?.apiStateSell ?? row?.apiState ?? "").trim().toLowerCase();
  const statusOk = status === "0" || status === "TRADING" || status === "ONLINE" || status === "";
  const buyOk = !buy || buy === "true" || buy === "1" || buy === "normal";
  const sellOk = !sell || sell === "true" || sell === "1" || sell === "normal";
  return statusOk && buyOk && sellOk;
}

function pickOrderId(row: any): string {
  return String(row?.orderId ?? row?.orderID ?? row?.id ?? "").trim();
}

function normalizeSpotSymbol(symbol: string): string {
  return fromExchangeSymbol("bingx", symbol);
}

export class BingxRestClient {
  private static queue: Promise<unknown> = Promise.resolve();
  private static lastRequestAt = 0;
  private static readonly minGapMs = Number(process.env.BINGX_MIN_GAP_MS || "120");
  private readonly metaCache = new Map<string, { meta: BingxSymbolMeta; ts: number }>();
  private readonly metaTtlMs = 10 * 60_000;
  private readonly symbolCache = new Map<string, { symbols: string[]; ts: number }>();
  private readonly symbolCacheTtlMs = 15 * 60_000;
  private readonly recvWindow = Number(process.env.BINGX_RECV_WINDOW_MS || "5000");

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private static async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = BingxRestClient.queue.then(fn, fn);
    BingxRestClient.queue = run.catch(() => undefined);
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
      throw new Error(`[bingx] ${label} non-JSON response ${res.status} ${res.statusText}: ${snippet}`);
    }
  }

  private async request<T>(opts: RequestOpts): Promise<T> {
    return BingxRestClient.enqueue(async () => {
      const { method, path, params = {}, auth = "NONE" } = opts;
      const url = new URL(path, this.baseUrl);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json"
      };

      let query = buildBingxQueryString(params);
      if (auth === "SIGNED") {
        if (!this.apiKey || !this.apiSecret) {
          throw new Error("[bingx] missing api credentials");
        }
        query = buildSignedBingxQuery({
          params,
          secret: this.apiSecret,
          timestampMs: nowMs(),
          recvWindowMs: this.recvWindow
        });
        headers["X-BX-APIKEY"] = this.apiKey;
      }
      if (query) url.search = query;

      const maxRetries = 2;
      let attempt = 0;
      while (true) {
        const now = Date.now();
        const gap = now - BingxRestClient.lastRequestAt;
        if (gap < BingxRestClient.minGapMs) {
          await sleep(BingxRestClient.minGapMs - gap);
        }
        BingxRestClient.lastRequestAt = Date.now();

        const res = await fetch(url, { method, headers, body: undefined });
        if (res.status === 404) throw new Error("BASE_URL_OR_PATH_INVALID");

        const json = await this.parseJson(res, `${method} ${path}`);
        const hasApiError = json && typeof json === "object" && (json.code !== undefined || json.msg !== undefined);
        const code = hasApiError ? Number(json.code) : 0;
        if (!res.ok || (hasApiError && Number.isFinite(code) && code !== 0)) {
          const msg = json?.msg || json?.message || res.statusText || "request_failed";
          const err = new Error(`BingX API error ${res.status}: ${msg} (${JSON.stringify(json)})`);
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await sleep(withJitter(backoff));
            attempt += 1;
            continue;
          }
          throw err;
        }

        return (hasApiError && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : json) as T;
      }
    });
  }

  private async getExchangeInfo(): Promise<any> {
    return this.request<any>({ method: "GET", path: "/openApi/spot/v1/common/symbols", auth: "NONE" });
  }

  private parseSymbolMeta(row: any): BingxSymbolMeta {
    return {
      symbol: String(row?.symbol || ""),
      priceStep: parseNumber(row?.tickSize) || precisionToStep(Number(row?.pricePrecision)),
      qtyStep: parseNumber(row?.stepSize) || precisionToStep(Number(row?.quantityPrecision)),
      minQty: parseNumber(row?.minQty) || undefined,
      minNotional: parseNumber(row?.minNotional) || undefined,
      pricePrecision: Number.isFinite(Number(row?.pricePrecision)) ? Number(row.pricePrecision) : undefined,
      qtyPrecision: Number.isFinite(Number(row?.quantityPrecision)) ? Number(row.quantityPrecision) : undefined
    };
  }

  private parseSymbolInfo(row: any): BingxSpotSymbolInfo {
    const exchangeSymbol = String(row?.symbol || "").toUpperCase();
    const [baseAsset, quoteAsset] = exchangeSymbol.includes("-")
      ? exchangeSymbol.split("-")
      : [String(row?.baseAsset ?? row?.baseCoin ?? ""), String(row?.quoteAsset ?? row?.quoteCoin ?? "")];
    const tradable = statusIsTradable(row);
    return {
      symbol: normalizeSpotSymbol(exchangeSymbol),
      exchangeSymbol,
      status: tradable ? "online" : "offline",
      tradable,
      tickSize: parseNumber(row?.tickSize) || null,
      stepSize: parseNumber(row?.stepSize) || null,
      minQty: parseNumber(row?.minQty) || null,
      maxQty: parseNumber(row?.maxQty) || null,
      quoteAsset: quoteAsset ? quoteAsset.toUpperCase() : null,
      baseAsset: baseAsset ? baseAsset.toUpperCase() : null
    };
  }

  private async getSymbolMeta(symbol: string): Promise<BingxSymbolMeta | undefined> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const cached = this.metaCache.get(exSymbol);
    if (cached && Date.now() - cached.ts < this.metaTtlMs) return cached.meta;

    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : toRows(info);
    const row = list.find((x: any) => String(x?.symbol || "").toUpperCase() === exSymbol.toUpperCase());
    if (!row) return undefined;
    const meta = this.parseSymbolMeta(row);
    this.metaCache.set(exSymbol, { meta, ts: Date.now() });
    return meta;
  }

  async listSymbols(): Promise<string[]> {
    const cached = this.symbolCache.get("symbols");
    if (cached && Date.now() - cached.ts < this.symbolCacheTtlMs) return cached.symbols;
    const details = await this.listSymbolDetails();
    const symbols = details.filter((row) => row.tradable).map((row) => row.symbol);
    this.symbolCache.set("symbols", { symbols, ts: Date.now() });
    return symbols;
  }

  async listSymbolDetails(): Promise<BingxSpotSymbolInfo[]> {
    const info = await this.getExchangeInfo();
    const list = Array.isArray(info?.symbols) ? info.symbols : toRows(info);
    return list
      .map((row: any) => this.parseSymbolInfo(row))
      .filter((row: BingxSpotSymbolInfo) => Boolean(row.symbol))
      .sort((a: BingxSpotSymbolInfo, b: BingxSpotSymbolInfo) => a.symbol.localeCompare(b.symbol));
  }

  async getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown[]> {
    const exSymbol = toExchangeSymbol("bingx", params.symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v2/market/kline",
      params: {
        symbol: exSymbol,
        interval: params.timeframe,
        limit: Math.min(1000, Math.max(1, params.limit))
      },
      auth: "NONE"
    });
    return Array.isArray(json) ? json : toRows(json);
  }

  async getTicker(symbol: string): Promise<MidPrice> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/ticker/bookTicker",
      params: { symbol: exSymbol },
      auth: "NONE"
    });
    const row = Array.isArray(json) ? json[0] : json?.book_ticker ?? json;
    const bid = parseNumber(row?.bidPrice ?? row?.bid_price);
    const ask = parseNumber(row?.askPrice ?? row?.ask_price);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    return {
      mid,
      bid,
      ask,
      last: mid,
      ts: parseNumber(row?.time ?? row?.timestamp) || Date.now()
    };
  }

  async getDepth(symbol: string, limit = 50): Promise<{
    asks: Array<[string | number, string | number]>;
    bids: Array<[string | number, string | number]>;
    ts?: string | number;
  }> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/market/depth",
      params: {
        symbol: exSymbol,
        limit: Math.min(1000, Math.max(1, limit))
      },
      auth: "NONE"
    });
    return {
      asks: Array.isArray(json?.asks) ? json.asks : [],
      bids: Array.isArray(json?.bids) ? json.bids : [],
      ts: json?.ts ?? json?.time ?? json?.lastUpdateId
    };
  }

  async getTrades(symbol: string, limit = 60): Promise<Array<{
    symbol: string;
    price: number | null;
    qty: number | null;
    side: string | null;
    ts: number | null;
  }>> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const rows = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/market/trades",
      params: {
        symbol: exSymbol,
        limit: Math.min(1000, Math.max(1, limit))
      },
      auth: "NONE"
    });
    return toRows(rows).map((row: any) => ({
      symbol: normalizeSpotSymbol(exSymbol),
      price: parseNumber(row?.price) || null,
      qty: parseNumber(row?.qty ?? row?.quantity) || null,
      side: row?.side ? String(row.side).toLowerCase() : row?.isBuyerMaker === true ? "sell" : row?.isBuyerMaker === false ? "buy" : null,
      ts: parseNumber(row?.time ?? row?.timestamp ?? row?.ts) || null
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const json = await this.request<any>({ method: "GET", path: "/openApi/spot/v1/account/balance", auth: "SIGNED" });
    const list = toRows(json?.balances ?? json);
    return list
      .map((b: any) => ({
        asset: String(b?.asset ?? b?.coin ?? b?.currency ?? "").toUpperCase(),
        free: parseNumber(b?.free ?? b?.available ?? b?.availableBalance),
        locked: parseNumber(b?.locked ?? b?.frozen ?? b?.freeze ?? b?.hold)
      }))
      .filter((b: Balance) => Boolean(b.asset));
  }

  async getSummary(preferredCurrency = "USDT"): Promise<{ equity: number | null; available: number | null; currency: string }> {
    const currency = String(preferredCurrency || "USDT").toUpperCase();
    const balances = await this.getBalances();
    const preferred = balances.find((row) => row.asset === currency);
    if (!preferred) return { equity: null, available: null, currency };
    return {
      equity: (preferred.free ?? 0) + (preferred.locked ?? 0),
      available: preferred.free ?? 0,
      currency
    };
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const exSymbol = symbol ? toExchangeSymbol("bingx", symbol) : undefined;
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/trade/openOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });

    return toRows(json).map((row: any) => {
      const qty = parseNumber(row.origQty ?? row.quantity ?? row.qty);
      const executed = parseNumber(row.executedQty ?? row.executedQuantity ?? row.dealQuantity);
      const left = qty > executed ? qty - executed : qty;
      return {
        id: pickOrderId(row),
        symbol: normalizeSpotSymbol(row.symbol || exSymbol || ""),
        side: sideFromValue(row.side),
        price: parseNumber(row.price),
        qty: left,
        status: mapOrderStatus(row.status),
        clientOrderId: row.clientOrderId ?? row.clientOrderID ? String(row.clientOrderId ?? row.clientOrderID) : undefined
      } as Order;
    });
  }

  async placeOrder(q: Quote): Promise<Order> {
    const exSymbol = toExchangeSymbol("bingx", q.symbol);
    const meta = await this.getSymbolMeta(q.symbol);
    const params: Record<string, BingxSignableValue> = {
      symbol: exSymbol,
      side: q.side.toUpperCase(),
      newClientOrderId: q.clientOrderId
    };

    let normalizedPrice = 0;
    let normalizedQty = 0;

    if (q.type === "market") {
      params.type = "MARKET";
      if (q.side === "buy") {
        if (!q.quoteQty || q.quoteQty <= 0) {
          throw new Error("[bingx] quoteQty required for market buy");
        }
        params.quoteOrderQty = q.quoteQty;
      } else {
        normalizedQty = normalizeQty(q.qty ?? 0, meta);
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw new Error("[bingx] QTY_NORMALIZED_TO_ZERO");
        params.quantity = normalizedQty;
      }
    } else {
      normalizedPrice = normalizePrice(q.price ?? 0, meta);
      normalizedQty = normalizeQty(q.qty ?? 0, meta);
      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) throw new Error("[bingx] PRICE_NORMALIZED_TO_ZERO");
      if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw new Error("[bingx] QTY_NORMALIZED_TO_ZERO");
      const minCheck = checkMins({ price: normalizedPrice, qty: normalizedQty, meta });
      if (!minCheck.ok) throw new Error(`[bingx] min check failed: ${minCheck.reason}`);
      params.type = "LIMIT";
      params.timeInForce = q.postOnly ? "PostOnly" : "GTC";
      params.price = normalizedPrice;
      params.quantity = normalizedQty;
    }

    const json = await this.request<any>({
      method: "POST",
      path: "/openApi/spot/v1/trade/order",
      params,
      auth: "SIGNED"
    });
    return {
      id: pickOrderId(json),
      symbol: q.symbol,
      side: q.side,
      price: normalizedPrice || parseNumber(q.price),
      qty: normalizedQty || parseNumber(q.qty),
      status: "open",
      clientOrderId: String(json?.clientOrderId ?? json?.clientOrderID ?? params.newClientOrderId ?? "") || undefined
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    await this.request({
      method: "POST",
      path: "/openApi/spot/v1/trade/cancel",
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
    const exSymbol = toExchangeSymbol("bingx", symbol);
    await this.request({
      method: "POST",
      path: "/openApi/spot/v1/trade/cancelOpenOrders",
      params: { symbol: exSymbol },
      auth: "SIGNED"
    });
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v2/ticker/price",
      params: { symbol: exSymbol },
      auth: "NONE"
    });
    const row = Array.isArray(json) ? json[0] : json;
    const price = parseNumber(row?.price ?? row?.lastPrice ?? row?.close);
    return price > 0 ? price : null;
  }

  async getMyTrades(symbol: string, params?: { startTimeMs?: number; limit?: number }): Promise<MyTrade[]> {
    const exSymbol = toExchangeSymbol("bingx", symbol);
    const limit = Math.min(1000, Math.max(1, params?.limit ?? 500));
    const json = await this.request<any>({
      method: "GET",
      path: "/openApi/spot/v1/trade/myTrades",
      params: {
        symbol: exSymbol,
        startTime: params?.startTimeMs,
        limit
      },
      auth: "SIGNED"
    });

    return toRows(json).map((row: any) => {
      const price = parseNumber(row.price);
      const qty = parseNumber(row.qty ?? row.quantity);
      return {
        id: String(row.id ?? row.tradeId ?? `${row.orderId}-${row.time ?? row.timestamp}`),
        orderId: row.orderId !== undefined ? String(row.orderId) : undefined,
        clientOrderId: row.clientOrderId ? String(row.clientOrderId) : undefined,
        side: sideFromValue(row.side ?? (row.isBuyer === false ? "SELL" : "BUY")),
        price,
        qty,
        notional: parseNumber(row.quoteQty ?? row.quoteQuantity ?? row.amount) || price * qty,
        timestamp: parseNumber(row.time ?? row.timestamp ?? row.ts)
      } as MyTrade;
    });
  }
}

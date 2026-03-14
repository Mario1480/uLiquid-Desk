import { Hyperliquid } from "hyperliquid";
import { ManualTradingError, type NormalizedOrder } from "../trading.js";
import {
  normalizeSpotSymbol,
  selectSpotSummary
} from "./bitget-spot.mapper.js";

type HyperliquidSpotClientConfig = {
  apiKey: string;
  apiSecret: string;
  vaultAddress?: string | null;
  baseUrl?: string;
  testnet?: boolean;
};

type SpotSymbolRow = {
  symbol: string;
  exchangeSymbol: string;
  actualPairSymbol: string;
  internalSymbol: string;
  assetIndex: number;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  quoteAsset: string | null;
  baseAsset: string | null;
  baseDecimals: number;
};

const DISPLAY_ASSET_ALIASES: Record<string, string> = {
  UBTC: "BTC",
  UETH: "ETH",
  USDT0: "USDT"
};

type RecentTradeRow = {
  coin?: string;
  px?: string | number;
  sz?: string | number;
  side?: string;
  time?: number;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function envFlagEnabled(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
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
  return value
    .toFixed(Math.max(0, Math.min(12, Math.trunc(decimals))))
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

function normalizeWalletAddress(value: string, field: "apiKey" | "vaultAddress"): string {
  const normalized = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new ManualTradingError(
      `hyperliquid_${field}_invalid`,
      400,
      `hyperliquid_${field}_invalid`
    );
  }
  return normalized;
}

function toDisplayAssetSymbol(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return DISPLAY_ASSET_ALIASES[normalized] ?? normalized;
}

function normalizePrivateKey(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new ManualTradingError(
      "hyperliquid_api_secret_invalid",
      400,
      "hyperliquid_api_secret_invalid"
    );
  }
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
}

function mapHyperliquidSpotError(error: unknown): ManualTradingError {
  if (error instanceof ManualTradingError) return error;
  const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
  const lower = message.toLowerCase();
  if (lower.includes("insufficient")) {
    return new ManualTradingError(
      `hyperliquid_spot_request_failed: ${message}`,
      400,
      "spot_insufficient_balance"
    );
  }
  if (lower.includes("invalid") || lower.includes("not found") || lower.includes("unknown")) {
    return new ManualTradingError(
      `hyperliquid_spot_request_failed: ${message}`,
      400,
      "hyperliquid_spot_request_failed"
    );
  }
  return new ManualTradingError(
    `hyperliquid_spot_request_failed: ${message}`,
    502,
    "hyperliquid_spot_request_failed"
  );
}

function isOpaqueHyperliquidCandleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();
  return normalized.includes("unknown error occurred")
    || normalized.includes("http 400")
    || normalized.includes("http 500");
}

function normalizeOrderSide(value: unknown): "buy" | "sell" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "b" || raw === "buy") return "buy";
  if (raw === "a" || raw === "sell") return "sell";
  return null;
}

function derivePriceWithSlippage(
  referencePrice: number,
  side: "buy" | "sell",
  slippage: number
): number {
  const multiplier = side === "buy" ? 1 + slippage : 1 - slippage;
  return Number((referencePrice * multiplier).toFixed(8));
}

export class HyperliquidSpotClient {
  readonly sdk: Hyperliquid;
  readonly baseUrl: string;
  readonly walletAddress: string;
  readonly vaultAddress: string | null;
  readonly accountAddress: string;
  private symbolsCache: SpotSymbolRow[] | null = null;
  private readonly marketOrderSlippage: number;

  constructor(config: HyperliquidSpotClientConfig) {
    this.walletAddress = normalizeWalletAddress(config.apiKey, "apiKey");
    this.vaultAddress = config.vaultAddress
      ? normalizeWalletAddress(config.vaultAddress, "vaultAddress")
      : null;
    this.accountAddress = this.vaultAddress ?? this.walletAddress;
    const privateKey = normalizePrivateKey(config.apiSecret);
    const baseUrl = String(
      config.baseUrl ??
        process.env.HYPERLIQUID_SPOT_REST_BASE_URL ??
        process.env.HYPERLIQUID_REST_BASE_URL ??
        "https://api.hyperliquid.xyz"
    ).replace(/\/+$/, "");
    this.baseUrl = baseUrl;
    this.marketOrderSlippage = Number(
      process.env.HYPERLIQUID_SPOT_MARKET_SLIPPAGE_PCT ?? "0.05"
    ) / 100;

    this.sdk = new Hyperliquid({
      enableWs: false,
      privateKey,
      walletAddress: this.walletAddress,
      vaultAddress: this.vaultAddress ?? undefined,
      testnet: config.testnet ?? baseUrl.toLowerCase().includes("testnet")
    });
  }

  private async readSymbols(): Promise<SpotSymbolRow[]> {
    if (this.symbolsCache) return this.symbolsCache;

    const raw = await this.sdk.info.spot.getSpotMetaAndAssetCtxs(true);
    const meta = Array.isArray(raw) ? raw[0] : null;
    if (!meta || !Array.isArray(meta.tokens) || !Array.isArray(meta.universe)) {
      throw new ManualTradingError(
        "hyperliquid_spot_meta_invalid",
        502,
        "hyperliquid_spot_meta_invalid"
      );
    }

    const tokensByIndex = new Map<number, { name: string; szDecimals: number }>(
      meta.tokens.map((token: any) => [
        Number(token.index),
        {
          name: String(token.name ?? "").toUpperCase(),
          szDecimals: Number(token.szDecimals ?? 0)
        }
      ])
    );

    const mapped: SpotSymbolRow[] = [];
    for (const market of meta.universe) {
        const [baseIndex, quoteIndex] = Array.isArray(market.tokens) ? market.tokens : [];
        const base = tokensByIndex.get(Number(baseIndex));
        const quote = tokensByIndex.get(Number(quoteIndex));
        if (!base || !quote) continue;
        const displayBase = toDisplayAssetSymbol(base.name);
        const displayQuote = toDisplayAssetSymbol(quote.name);
        const canonical = normalizeSpotSymbol(`${displayBase}${displayQuote}`);
        const actualPairSymbol = normalizeSpotSymbol(`${base.name}${quote.name}`);
        if (!canonical) continue;
        const exchangeSymbol = String(market.name ?? `${base.name}/${quote.name}`);
        const internalSymbol = `${base.name}-SPOT`;
        const stepSize =
          base.szDecimals >= 0 ? Number(`1e-${Math.max(0, Math.trunc(base.szDecimals))}`) : null;
        mapped.push({
          symbol: canonical,
          exchangeSymbol,
          actualPairSymbol,
          internalSymbol,
          assetIndex: Number(market.index ?? 0),
          status: "online",
          tradable: true,
          tickSize: null,
          stepSize,
          minQty: stepSize,
          maxQty: null,
          quoteAsset: displayQuote,
          baseAsset: displayBase,
          baseDecimals: Math.max(0, Math.trunc(base.szDecimals))
        });
      }
    this.symbolsCache = mapped.sort((a, b) => a.symbol.localeCompare(b.symbol));

    return this.symbolsCache;
  }

  private async requireSymbol(input: string): Promise<SpotSymbolRow> {
    const normalized = normalizeSpotSymbol(input);
    const symbols = await this.readSymbols();
    const row =
      symbols.find((entry) => entry.symbol === normalized) ??
      symbols.find((entry) => entry.actualPairSymbol === normalized) ??
      symbols.find((entry) => entry.exchangeSymbol.toUpperCase() === String(input ?? "").trim().toUpperCase()) ??
      symbols.find((entry) => entry.internalSymbol.toUpperCase() === String(input ?? "").trim().toUpperCase());
    if (!row) {
      throw new ManualTradingError(
        `hyperliquid_spot_symbol_unknown:${String(input ?? "")}`,
        404,
        "spot_symbol_unknown"
      );
    }
    return row;
  }

  private async postInfo<T>(payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/info`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`hyperliquid_info_failed:${response.status}:${message}`);
    }
    return response.json() as Promise<T>;
  }

  private async getReferencePrice(row: SpotSymbolRow): Promise<number> {
    const mids = await this.sdk.info.getAllMids();
    const internalMid = toNumber((mids as Record<string, unknown>)[row.internalSymbol]);
    if (internalMid && internalMid > 0) return internalMid;
    const ticker = await this.getTicker(row.symbol);
    const fallback = toNumber(ticker.last) ?? toNumber(ticker.bid) ?? toNumber(ticker.ask);
    if (fallback && fallback > 0) return fallback;
    throw new ManualTradingError(
      "hyperliquid_spot_price_unavailable",
      502,
      "hyperliquid_spot_price_unavailable"
    );
  }

  private async normalizeOrderSize(row: SpotSymbolRow, qtyRaw: number): Promise<string> {
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
    }
    const decimals = row.baseDecimals;
    const normalized = Number(qty.toFixed(decimals));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new ManualTradingError("quantity_below_min", 400, "quantity_below_min");
    }
    return formatDecimal(normalized, decimals);
  }

  async listSymbols() {
    return this.readSymbols();
  }

  async getCandles(params: {
    symbol: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    limit: number;
  }): Promise<unknown> {
    try {
      const row = await this.requireSymbol(params.symbol);
      const intervalMs = {
        "1m": 60_000,
        "5m": 5 * 60_000,
        "15m": 15 * 60_000,
        "1h": 60 * 60_000,
        "4h": 4 * 60 * 60_000,
        "1d": 24 * 60 * 60_000
      }[params.timeframe];
      const endTime = Date.now();
      const startTime = endTime - Math.max(1, Math.trunc(params.limit)) * intervalMs;
      const rows = await this.sdk.info.getCandleSnapshot(
        row.internalSymbol,
        params.timeframe,
        startTime,
        endTime
      );
      return Array.isArray(rows)
        ? rows.map((entry: any) => ({
            ts: toNumber(entry.t ?? entry.time ?? entry.T),
            open: toNumber(entry.o),
            high: toNumber(entry.h),
            low: toNumber(entry.l),
            close: toNumber(entry.c),
            volume: toNumber(entry.v)
          }))
        : [];
    } catch (error) {
      // Hyperliquid sometimes answers spot candle requests for thin/new assets with
      // an opaque 4xx/5xx instead of returning an empty set. Treat that like
      // "no candles yet" so the desk can stay usable.
      if (isOpaqueHyperliquidCandleError(error)) {
        return [];
      }
      throw mapHyperliquidSpotError(error);
    }
  }

  async getTicker(symbol: string) {
    try {
      const row = await this.requireSymbol(symbol);
      const [metaAndCtx, book] = await Promise.all([
        this.sdk.info.spot.getSpotMetaAndAssetCtxs(true),
        this.sdk.info.getL2Book(row.internalSymbol).catch(() => null)
      ]);
      const assetCtxs = Array.isArray(metaAndCtx) ? metaAndCtx[1] : [];
      const assetCtx =
        Array.isArray(assetCtxs) && row.assetIndex >= 0
          ? assetCtxs[row.assetIndex] ?? null
          : null;
      const bids = Array.isArray((book as any)?.levels?.[0]) ? (book as any).levels[0] : [];
      const asks = Array.isArray((book as any)?.levels?.[1]) ? (book as any).levels[1] : [];
      return {
        symbol: row.symbol,
        last: toNumber(assetCtx?.midPx) ?? toNumber(assetCtx?.markPx),
        mark: toNumber(assetCtx?.markPx) ?? toNumber(assetCtx?.midPx),
        bid: toNumber(bids[0]?.px),
        ask: toNumber(asks[0]?.px),
        ts: null
      };
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async getDepth(symbol: string, _limit = 50) {
    try {
      const row = await this.requireSymbol(symbol);
      const book = await this.sdk.info.getL2Book(row.internalSymbol);
      const bids = Array.isArray((book as any)?.levels?.[0]) ? (book as any).levels[0] : [];
      const asks = Array.isArray((book as any)?.levels?.[1]) ? (book as any).levels[1] : [];
      return {
        asks: asks.map((level: any) => [level.px, level.sz] as [string | number, string | number]),
        bids: bids.map((level: any) => [level.px, level.sz] as [string | number, string | number]),
        ts: undefined
      };
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async getTrades(symbol: string, limit = 60) {
    try {
      const row = await this.requireSymbol(symbol);
      const items = await this.postInfo<RecentTradeRow[]>({
        type: "recentTrades",
        coin: row.exchangeSymbol
      });
      return (Array.isArray(items) ? items : [])
        .slice(-Math.max(1, Math.min(500, Math.trunc(limit))))
        .map((entry) => ({
          symbol: row.symbol,
          price: toNumber(entry.px),
          qty: toNumber(entry.sz),
          side: normalizeOrderSide(entry.side),
          ts: toNumber(entry.time)
        }));
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async getBalances() {
    try {
      const state = await this.sdk.info.spot.getSpotClearinghouseState(this.accountAddress, true);
      const balances = Array.isArray((state as any)?.balances) ? (state as any).balances : [];
      return balances.map((row: any) => {
        const total = toNumber(row.total) ?? 0;
        const hold = toNumber(row.hold) ?? 0;
        const available = Math.max(0, total - hold);
        const asset = String(row.coin ?? "").toUpperCase();
        return {
          coin: asset,
          asset,
          available: formatDecimal(available, 8),
          frozen: formatDecimal(hold, 8),
          locked: formatDecimal(hold, 8),
          lock: formatDecimal(hold, 8)
        };
      });
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async getSummary(preferredCurrency = "USDC") {
    try {
      const balances = await this.getBalances();
      return selectSpotSummary(
        balances.map((row) => ({
          coin: String(row.coin ?? row.asset ?? "").toUpperCase(),
          available: String(row.available ?? "0"),
          frozen: String(row.frozen ?? row.locked ?? row.lock ?? "0")
        })),
        preferredCurrency
      );
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async getOpenOrders(symbol?: string): Promise<NormalizedOrder[]> {
    try {
      const requested = symbol ? await this.requireSymbol(symbol) : null;
      const items = await this.sdk.info.getUserOpenOrders(this.accountAddress, true);
      const symbols = await this.readSymbols();
      const byExchange = new Map(symbols.map((row) => [row.exchangeSymbol.toUpperCase(), row]));
      const mapped: NormalizedOrder[] = [];
      for (const entry of Array.isArray(items) ? items : []) {
          const symbolRow =
            byExchange.get(String(entry.coin ?? "").toUpperCase()) ??
            null;
          if (!symbolRow) continue;
          if (requested && symbolRow.symbol !== requested.symbol) continue;
          const side = normalizeOrderSide(entry.side);
          mapped.push({
            orderId: String(entry.oid ?? "").trim(),
            symbol: symbolRow.symbol,
            side,
            type: "limit",
            status: "open",
            price: toNumber(entry.limitPx),
            qty: toNumber(entry.sz),
            triggerPrice: null,
            takeProfitPrice: null,
            stopLossPrice: null,
            reduceOnly: false,
            createdAt: toNumber(entry.timestamp)
              ? new Date(Number(entry.timestamp)).toISOString()
              : null,
            raw: entry
          });
        }
      return mapped.filter((entry) => entry.orderId.length > 0);
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async placeOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
  }): Promise<{ orderId: string }> {
    try {
      const row = await this.requireSymbol(input.symbol);
      const size = await this.normalizeOrderSize(row, input.qty);
      const limitPx =
        input.type === "limit"
          ? Number(input.price)
          : derivePriceWithSlippage(
              await this.getReferencePrice(row),
              input.side,
              this.marketOrderSlippage
            );
      if (!Number.isFinite(limitPx) || limitPx <= 0) {
        throw new ManualTradingError("invalid_price", 400, "invalid_price");
      }
      const response = await this.sdk.exchange.placeOrder({
        coin: row.internalSymbol,
        is_buy: input.side === "buy",
        sz: size,
        limit_px: formatDecimal(limitPx, 8),
        order_type: {
          limit: {
            tif: input.type === "limit" ? "Gtc" : "Ioc"
          }
        },
        reduce_only: false
      });
      const status = Array.isArray(response?.response?.data?.statuses)
        ? response.response.data.statuses[0]
        : null;
      const orderId = String(status?.resting?.oid ?? status?.filled?.oid ?? "").trim();
      if (!orderId) {
        throw new ManualTradingError(
          "hyperliquid_spot_order_missing_id",
          502,
          "hyperliquid_spot_order_missing_id"
        );
      }
      return { orderId };
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async editOrder(input: {
    symbol: string;
    orderId: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
  }): Promise<{ orderId: string }> {
    await this.cancelOrder(input.symbol, input.orderId);
    return this.placeOrder(input);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      const row = await this.requireSymbol(symbol);
      const oid = Number(orderId);
      if (!Number.isFinite(oid)) {
        throw new ManualTradingError("invalid_order_id", 400, "invalid_order_id");
      }
      await this.sdk.exchange.cancelOrder({
        coin: row.internalSymbol,
        o: oid
      });
    } catch (error) {
      throw mapHyperliquidSpotError(error);
    }
  }

  async cancelAll(symbol?: string): Promise<{ requested: number; cancelled: number; failed: number }> {
    const before = await this.getOpenOrders(symbol);
    let cancelled = 0;
    let failed = 0;
    for (const order of before) {
      try {
        await this.cancelOrder(order.symbol, order.orderId);
        cancelled += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      requested: before.length,
      cancelled,
      failed
    };
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(symbol);
    return toNumber(ticker.last) ?? toNumber(ticker.mark);
  }
}

export function isHyperliquidSpotTestnet(): boolean {
  return envFlagEnabled("HYPERLIQUID_TESTNET", false);
}

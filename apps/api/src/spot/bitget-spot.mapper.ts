import type { NormalizedOrder, NormalizedPosition } from "../trading.js";
import type {
  BitgetSpotBalanceRow,
  BitgetSpotOpenOrderRow,
  BitgetSpotSymbolRow,
  BitgetSpotSummary,
  BitgetSpotTickerRow,
  BitgetSpotTradeRow
} from "./bitget-spot.types.js";

const KNOWN_QUOTES = [
  "USDT",
  "USDC",
  "BTC",
  "ETH",
  "EUR",
  "USD",
  "BRL",
  "TRY",
  "JPY",
  "GBP"
];

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function precisionToStep(value: unknown): number | null {
  const precision = Number(value);
  if (!Number.isFinite(precision) || precision < 0 || precision > 18) return null;
  return Number((1 / Math.pow(10, precision)).toFixed(18));
}

export function normalizeSpotSymbol(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function splitCanonicalSymbol(symbol: string): { baseAsset: string | null; quoteAsset: string | null } {
  const normalized = normalizeSpotSymbol(symbol);
  for (const quote of KNOWN_QUOTES) {
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, normalized.length - quote.length);
    if (!base) continue;
    return {
      baseAsset: base,
      quoteAsset: quote
    };
  }
  return {
    baseAsset: null,
    quoteAsset: null
  };
}

export function marketTimeframeToBitgetSpotGranularity(
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
): string {
  if (timeframe === "1m") return "1min";
  if (timeframe === "5m") return "5min";
  if (timeframe === "15m") return "15min";
  if (timeframe === "1h") return "1h";
  if (timeframe === "4h") return "4h";
  return "1day";
}

export function isSpotSymbolTradable(status: unknown): boolean {
  const text = String(status ?? "").trim().toLowerCase();
  if (!text) return true;
  if (text === "online" || text === "listed" || text === "normal") return true;
  if (text === "1") return true;
  return false;
}

export function mapSpotSymbolRow(row: BitgetSpotSymbolRow): {
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
} | null {
  const symbol = normalizeSpotSymbol(row.symbol);
  if (!symbol) return null;

  const split = splitCanonicalSymbol(symbol);
  const baseAsset = String(row.baseCoin ?? split.baseAsset ?? "").trim().toUpperCase() || null;
  const quoteAsset = String(row.quoteCoin ?? split.quoteAsset ?? "").trim().toUpperCase() || null;

  return {
    symbol,
    exchangeSymbol: symbol,
    status: String(row.status ?? "").trim() || "unknown",
    tradable: isSpotSymbolTradable(row.status),
    tickSize: toNumber(row.priceStep) ?? precisionToStep(row.priceScale),
    stepSize: toNumber(row.quantityStep) ?? precisionToStep(row.quantityScale),
    minQty: toNumber(row.minTradeAmount),
    maxQty: toNumber(row.maxTradeAmount),
    quoteAsset,
    baseAsset
  };
}

export function mapSpotTickerRow(row: BitgetSpotTickerRow, symbol: string): {
  symbol: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  ts: number | null;
} {
  const normalizedSymbol = normalizeSpotSymbol(row.symbol) || normalizeSpotSymbol(symbol);
  const last = toNumber(row.lastPr);
  const bid = toNumber(row.bidPr);
  const ask = toNumber(row.askPr);
  return {
    symbol: normalizedSymbol,
    last,
    mark: last,
    bid,
    ask,
    ts: toNumber(row.ts)
  };
}

export function mapSpotOrderStatus(status: unknown): string {
  const text = String(status ?? "").trim().toLowerCase();
  if (!text) return "open";
  if (["new", "init", "live", "partially_filled", "partial_fill"].includes(text)) return "open";
  if (["filled", "full_fill"].includes(text)) return "filled";
  if (["cancelled", "canceled", "cancel", "partial_canceled"].includes(text)) return "cancelled";
  return text;
}

export function mapSpotOrderRow(row: BitgetSpotOpenOrderRow): NormalizedOrder | null {
  const orderId = String(row.orderId ?? "").trim();
  const symbol = normalizeSpotSymbol(row.symbol);
  if (!orderId || !symbol) return null;

  const size = toNumber(row.size ?? row.baseVolume);
  const filledAmount = toNumber(row.filledAmount) ?? 0;
  const qty =
    size !== null && size > 0
      ? Math.max(0, Number((size - Math.max(0, filledAmount)).toFixed(8)))
      : null;

  return {
    orderId,
    symbol,
    side: String(row.side ?? "").toLowerCase() || null,
    type: String(row.orderType ?? "").toLowerCase() || null,
    status: mapSpotOrderStatus(row.status),
    price: toNumber(row.price),
    qty,
    triggerPrice: null,
    takeProfitPrice: null,
    stopLossPrice: null,
    reduceOnly: false,
    createdAt: row.cTime ? new Date(Number(row.cTime)).toISOString() : null,
    raw: row
  };
}

export function selectSpotSummary(
  balances: BitgetSpotBalanceRow[],
  preferredCurrency = "USDT"
): BitgetSpotSummary {
  const normalizedPreferred = String(preferredCurrency).trim().toUpperCase() || "USDT";
  const pick =
    balances.find((row) => String(row.coin ?? "").toUpperCase() === normalizedPreferred) ??
    balances[0] ??
    null;

  if (!pick) {
    return {
      equity: null,
      available: null,
      currency: normalizedPreferred
    };
  }

  const available = toNumber(pick.available);
  const frozen =
    toNumber(pick.frozen) ??
    toNumber(pick.locked) ??
    toNumber(pick.lock);

  return {
    equity:
      available === null && frozen === null
        ? null
        : (available ?? 0) + (frozen ?? 0),
    available,
    currency: String(pick.coin ?? normalizedPreferred).toUpperCase()
  };
}

export function toSpotPositionFromHolding(params: {
  symbol: string;
  qty: number;
  entryPrice: number;
  markPrice: number | null;
}): NormalizedPosition {
  const unrealizedPnl =
    params.markPrice !== null
      ? (params.markPrice - params.entryPrice) * params.qty
      : null;

  return {
    symbol: normalizeSpotSymbol(params.symbol),
    side: "long",
    size: Number(params.qty.toFixed(8)),
    entryPrice: Number(params.entryPrice.toFixed(8)),
    markPrice: params.markPrice,
    unrealizedPnl,
    takeProfitPrice: null,
    stopLossPrice: null
  };
}

export function mapSpotTradeRow(row: BitgetSpotTradeRow, fallbackSymbol: string): {
  symbol: string;
  price: number | null;
  qty: number | null;
  side: string | null;
  ts: number | null;
} {
  return {
    symbol: normalizeSpotSymbol(row.symbol) || normalizeSpotSymbol(fallbackSymbol),
    price: toNumber(row.price),
    qty: toNumber(row.size),
    side: row.side ? String(row.side).toLowerCase() : null,
    ts: toNumber(row.ts)
  };
}

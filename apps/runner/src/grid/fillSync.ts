import crypto from "node:crypto";
import type { ActiveFuturesBot, GridBotInstanceRuntime } from "../db.js";
import {
  createGridBotFillEventEntry,
  findGridBotOrderMapByOrderRef
} from "../db.js";

type NormalizedFillRow = {
  exchangeOrderId: string | null;
  exchangeFillId: string | null;
  clientOrderId: string | null;
  side: "buy" | "sell";
  fillPrice: number;
  fillQty: number;
  fillNotionalUsd: number;
  feeUsd: number;
  fillTs: Date;
  symbol: string | null;
  rawJson: Record<string, unknown>;
};

export type GridFillSyncSummary = {
  fetched: number;
  normalized: number;
  inserted: number;
  duplicates: number;
  errors: number;
  terminalTpHits: number;
  terminalSlHits: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function baseSymbol(symbol: string): string {
  return symbol.replace(/(USDT|USDC|USD|PERP)$/i, "");
}

function symbolMatches(targetCanonical: string, source: string | null): boolean {
  if (!source) return true;
  const target = normalizeSymbol(targetCanonical);
  const candidate = normalizeSymbol(source);
  if (!target || !candidate) return true;
  if (target === candidate) return true;
  if (target.endsWith(candidate) || candidate.endsWith(target)) return true;
  return baseSymbol(target) === baseSymbol(candidate);
}

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const root = asRecord(raw);
  if (!root) return [];
  const directCandidates = [
    root.data,
    root.rows,
    root.list,
    root.items,
    root.result,
    root.results,
    root.fills
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (!nested) continue;
    const nestedArrays = [nested.data, nested.rows, nested.list, nested.items, nested.result];
    for (const nestedCandidate of nestedArrays) {
      if (Array.isArray(nestedCandidate)) return nestedCandidate;
    }
  }
  return [];
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 9999999999 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return parseTimestamp(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function readFirstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toStringValue(row[key]);
    if (value) return value;
  }
  return null;
}

function readFirstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeFillRow(raw: unknown): NormalizedFillRow | null {
  const row = asRecord(raw);
  if (!row) return null;

  const fillPrice = readFirstNumber(row, ["fillPrice", "priceAvg", "price", "tradePrice", "p"]);
  const fillQty = readFirstNumber(row, ["fillQty", "baseVolume", "size", "qty", "tradeQty", "sz", "vol"]);
  if (!Number.isFinite(fillPrice) || !Number.isFinite(fillQty)) return null;
  if (Number(fillPrice) <= 0 || Number(fillQty) <= 0) return null;

  const sideRaw = String(
    row.side ?? row.tradeSide ?? row.direction ?? row.dir ?? row.takerSide ?? row.S ?? ""
  ).trim().toLowerCase();
  const side: "buy" | "sell" = sideRaw.includes("sell") || sideRaw === "short" ? "sell" : "buy";

  const fillTs = parseTimestamp(
    row.fillTs ?? row.fillTime ?? row.ts ?? row.time ?? row.timestamp ?? row.cTime ?? row.uTime
  );
  if (!fillTs) return null;

  const feeUsd = readFirstNumber(row, ["feeUsd", "fillFee", "tradeFee", "execFee", "fee", "commission"]) ?? 0;
  const fillNotionalUsd =
    readFirstNumber(row, ["fillNotionalUsd", "quoteVolume", "notionalUsd", "notional", "amount"]) ??
    Number(fillPrice) * Number(fillQty);

  return {
    exchangeOrderId: readFirstString(row, ["orderId", "oid", "order_id", "ordId", "o"]),
    exchangeFillId: readFirstString(row, ["fillId", "tradeId", "tid", "id"]),
    clientOrderId: readFirstString(row, ["clientOrderId", "clientOid", "client_id", "clOrdId"]),
    side,
    fillPrice: Number(fillPrice),
    fillQty: Number(fillQty),
    fillNotionalUsd: Number(fillNotionalUsd),
    feeUsd: Number(feeUsd),
    fillTs,
    symbol: readFirstString(row, ["symbol", "instId", "coin", "s"]),
    rawJson: row
  };
}

async function fetchRawFillRows(
  adapter: any,
  botSymbol: string
): Promise<unknown[]> {
  if (!adapter) return [];
  const exchangeSymbol = await (async () => {
    try {
      if (typeof adapter.toExchangeSymbol === "function") {
        return await adapter.toExchangeSymbol(botSymbol);
      }
    } catch {
      // ignore symbol conversion failures and use canonical fallback
    }
    return botSymbol;
  })();

  const tradeApi = (adapter as any).tradeApi;
  if (tradeApi && typeof tradeApi.getFills === "function") {
    const raw = await tradeApi.getFills({
      symbol: exchangeSymbol,
      limit: 150
    });
    return extractRows(raw);
  }
  if (tradeApi && typeof tradeApi.listOrderDeals === "function") {
    const raw = await tradeApi.listOrderDeals({
      symbol: exchangeSymbol,
      pageSize: 200
    });
    return extractRows(raw);
  }
  if (typeof (adapter as any).getFills === "function") {
    const raw = await (adapter as any).getFills({
      symbol: exchangeSymbol,
      limit: 150
    });
    return extractRows(raw);
  }
  return [];
}

function buildDedupeKey(params: {
  instanceId: string;
  fill: NormalizedFillRow;
}): string {
  const basis = [
    params.instanceId,
    params.fill.exchangeFillId ?? "",
    params.fill.exchangeOrderId ?? "",
    params.fill.clientOrderId ?? "",
    params.fill.side,
    params.fill.fillPrice.toFixed(12),
    params.fill.fillQty.toFixed(12),
    params.fill.fillTs.toISOString()
  ].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex");
}

export const __fillSyncTestUtils = {
  symbolMatches,
  extractRows,
  normalizeFillRow,
  buildDedupeKey
};

export async function syncGridFillEvents(params: {
  instance: GridBotInstanceRuntime;
  bot: ActiveFuturesBot;
  adapter: any;
}): Promise<GridFillSyncSummary> {
  const rows = await fetchRawFillRows(params.adapter, params.bot.symbol);
  const normalized = rows
    .map((row) => normalizeFillRow(row))
    .filter((row): row is NormalizedFillRow => Boolean(row))
    .filter((row) => symbolMatches(params.bot.symbol, row.symbol))
    .sort((a, b) => a.fillTs.getTime() - b.fillTs.getTime())
    .slice(0, 200);

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let terminalTpHits = 0;
  let terminalSlHits = 0;
  const orderRefCache = new Map<string, {
    gridLeg: "long" | "short";
    gridIndex: number;
    intentType: "entry" | "tp" | "sl" | "rebalance";
    reduceOnly: boolean;
  } | null>();

  for (const fill of normalized) {
    try {
      const refKey = `${fill.clientOrderId ?? ""}|${fill.exchangeOrderId ?? ""}`;
      let orderRef = orderRefCache.get(refKey) ?? null;
      if (!orderRefCache.has(refKey)) {
        orderRef = await findGridBotOrderMapByOrderRef({
          instanceId: params.instance.id,
          clientOrderId: fill.clientOrderId,
          exchangeOrderId: fill.exchangeOrderId
        });
        orderRefCache.set(refKey, orderRef);
      }

      const created = await createGridBotFillEventEntry({
        instanceId: params.instance.id,
        botId: params.instance.botId,
        exchangeOrderId: fill.exchangeOrderId,
        exchangeFillId: fill.exchangeFillId,
        clientOrderId: fill.clientOrderId,
        fillPrice: fill.fillPrice,
        fillQty: fill.fillQty,
        fillNotionalUsd: fill.fillNotionalUsd,
        feeUsd: fill.feeUsd,
        side: fill.side,
        gridLeg: orderRef?.gridLeg ?? (fill.side === "sell" ? "short" : "long"),
        gridIndex: orderRef?.gridIndex ?? 0,
        fillTs: fill.fillTs,
        dedupeKey: buildDedupeKey({
          instanceId: params.instance.id,
          fill
        }),
        rawJson: fill.rawJson
      });
      if (created) {
        inserted += 1;
        if (orderRef?.intentType === "tp") terminalTpHits += 1;
        if (orderRef?.intentType === "sl") terminalSlHits += 1;
      } else {
        duplicates += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return {
    fetched: rows.length,
    normalized: normalized.length,
    inserted,
    duplicates,
    errors,
    terminalTpHits,
    terminalSlHits
  };
}

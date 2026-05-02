import crypto from "node:crypto";
import { orderReferenceInputsMatch } from "@mm/futures-exchange";
import type { ActiveFuturesBot, GridBotInstanceRuntime } from "../db.js";
import {
  createGridBotFillEventEntry,
  findGridBotOrderMapByOrderRef,
  updateGridBotOrderMapStatus,
  upsertBotOrderEntry
} from "../db.js";

type NormalizedFillRow = {
  exchangeOrderId: string | null;
  exchangeFillId: string | null;
  clientOrderId: string | null;
  cloid: string | null;
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

function toIdentifierString(value: unknown): string | null {
  if (typeof value === "string") return toStringValue(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "bigint") return value.toString();
  return null;
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

function readFirstIdentifier(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toIdentifierString(row[key]);
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

function normalizeFillSide(value: unknown): "buy" | "sell" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "s"
    || normalized === "a"
    || normalized === "ask"
    || normalized.includes("sell")
    || normalized.includes("open short")
    || normalized.includes("close long")
    || normalized === "short"
  ) {
    return "sell";
  }
  if (
    normalized === "b"
    || normalized === "bid"
    || normalized.includes("buy")
    || normalized.includes("open long")
    || normalized.includes("close short")
    || normalized === "long"
  ) {
    return "buy";
  }
  return "buy";
}

function normalizeFillRow(raw: unknown): NormalizedFillRow | null {
  const row = asRecord(raw);
  if (!row) return null;

  const fillPrice = readFirstNumber(row, ["fillPrice", "priceAvg", "price", "tradePrice", "p", "px"]);
  const fillQty = readFirstNumber(row, ["fillQty", "baseVolume", "size", "qty", "tradeQty", "sz", "vol"]);
  if (!Number.isFinite(fillPrice) || !Number.isFinite(fillQty)) return null;
  if (Number(fillPrice) <= 0 || Number(fillQty) <= 0) return null;

  const side = normalizeFillSide(
    row.side ?? row.tradeSide ?? row.direction ?? row.dir ?? row.takerSide ?? row.S
  );

  const fillTs = parseTimestamp(
    row.fillTs ?? row.fillTime ?? row.ts ?? row.time ?? row.timestamp ?? row.cTime ?? row.uTime
  );
  if (!fillTs) return null;

  const feeUsd = readFirstNumber(row, ["feeUsd", "fillFee", "tradeFee", "execFee", "fee", "commission"]) ?? 0;
  const fillNotionalUsd =
    readFirstNumber(row, ["fillNotionalUsd", "quoteVolume", "notionalUsd", "notional", "amount"]) ??
    Number(fillPrice) * Number(fillQty);

  return {
    exchangeOrderId: readFirstIdentifier(row, ["orderId", "oid", "order_id", "ordId", "o"]),
    exchangeFillId: readFirstIdentifier(row, ["fillId", "tradeId", "tid", "id"]),
    clientOrderId: readFirstString(row, ["clientOrderId", "clientOid", "client_id", "clOrdId"]),
    cloid: readFirstString(row, ["cloid"]),
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

function isMatchedOrderTerminalFill(params: {
  fillQty: number;
  orderQty?: number | null;
  rawJson: Record<string, unknown>;
}): boolean {
  if (isTerminalFillRow(params.rawJson)) return true;
  const orderQty = Number(params.orderQty ?? NaN);
  if (!Number.isFinite(orderQty) || orderQty <= 0) return false;
  const tolerance = Math.max(1e-12, Math.abs(orderQty) * 1e-8);
  return params.fillQty + tolerance >= orderQty;
}

function fillMatchesOrderRef(params: {
  fill: Pick<NormalizedFillRow, "clientOrderId" | "exchangeOrderId" | "cloid">;
  orderRef: {
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  };
}): boolean {
  return orderReferenceInputsMatch({
    clientOrderId: params.fill.clientOrderId,
    exchangeOrderId: params.fill.exchangeOrderId,
    cloid: params.fill.cloid
  }, {
    clientOrderId: params.orderRef.clientOrderId,
    exchangeOrderId: params.orderRef.exchangeOrderId
  });
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

function isTerminalFillRow(rawJson: Record<string, unknown>): boolean {
  const status = String(
    rawJson.status
    ?? rawJson.orderStatus
    ?? rawJson.ordStatus
    ?? rawJson.state
    ?? rawJson.tradeStatus
    ?? ""
  ).trim().toLowerCase();
  if (status.includes("filled") || status === "full_fill" || status === "done" || status === "closed") {
    return true;
  }

  const remainingQty = readFirstNumber(rawJson, ["remainingQty", "remainQty", "leavesQty", "left", "remaining"]);
  if (remainingQty !== null && remainingQty <= 1e-12) return true;

  const orderQty = readFirstNumber(rawJson, ["orderQty", "origQty", "sz", "qty", "size"]);
  const cumulativeQty = readFirstNumber(rawJson, ["filledQty", "cumQty", "accFillSz", "executedQty"]);
  if (orderQty !== null && cumulativeQty !== null && cumulativeQty + 1e-12 >= orderQty) {
    return true;
  }
  return false;
}

function resolveSyncedBotOrderStatus(terminalFill: boolean): "FILLED" | "PARTIALLY_FILLED" {
  return terminalFill ? "FILLED" : "PARTIALLY_FILLED";
}

export const __fillSyncTestUtils = {
  symbolMatches,
  extractRows,
  normalizeFillRow,
  buildDedupeKey,
  isTerminalFillRow,
  isMatchedOrderTerminalFill,
  fillMatchesOrderRef,
  resolveSyncedBotOrderStatus
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
    clientOrderId: string | null;
    exchangeOrderId: string | null;
    gridLeg: "long" | "short";
    gridIndex: number;
    intentType: "entry" | "tp" | "sl" | "rebalance";
    reduceOnly: boolean;
    qty: number | null;
  } | null>();

  for (const fill of normalized) {
    try {
      const refKey = `${fill.clientOrderId ?? ""}|${fill.exchangeOrderId ?? ""}|${fill.cloid ?? ""}`;
      let orderRef = orderRefCache.get(refKey) ?? null;
      if (!orderRefCache.has(refKey)) {
        orderRef = await findGridBotOrderMapByOrderRef({
          instanceId: params.instance.id,
          clientOrderId: fill.clientOrderId,
          exchangeOrderId: fill.exchangeOrderId,
          cloid: fill.cloid
        });
        if (!orderRef && fill.cloid) {
          orderRef = await findGridBotOrderMapByOrderRef({
            instanceId: params.instance.id,
            cloid: fill.cloid
          });
        }
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
      const terminalFill = orderRef
        ? isMatchedOrderTerminalFill({
            fillQty: fill.fillQty,
            orderQty: orderRef.qty,
            rawJson: fill.rawJson
          })
        : isTerminalFillRow(fill.rawJson);
      if (created && params.bot.botVaultExecution?.botVaultId) {
        const localClientOrderId = fill.clientOrderId ?? orderRef?.clientOrderId ?? null;
        const localExchangeOrderId = orderRef?.exchangeOrderId ?? fill.exchangeOrderId;
        await upsertBotOrderEntry({
          botVaultId: params.bot.botVaultExecution.botVaultId,
          exchange: params.bot.exchange,
          symbol: params.bot.symbol,
          side: fill.side === "sell" ? "SELL" : "BUY",
          orderType: "LIMIT",
          status: resolveSyncedBotOrderStatus(terminalFill),
          clientOrderId: localClientOrderId,
          exchangeOrderId: localExchangeOrderId,
          price: fill.fillPrice,
          qty: fill.fillQty,
          reduceOnly: orderRef?.reduceOnly === true,
          metadata: {
            source: "runner_fill_sync",
            gridLeg: orderRef?.gridLeg ?? null,
            gridIndex: orderRef?.gridIndex ?? null,
            intentType: orderRef?.intentType ?? null
          }
        });
      }
      if (created) {
        if (orderRef && terminalFill) {
          await updateGridBotOrderMapStatus({
            instanceId: params.instance.id,
            clientOrderId: fill.clientOrderId ?? orderRef.clientOrderId,
            exchangeOrderId: orderRef.exchangeOrderId ?? fill.cloid ?? fill.exchangeOrderId,
            status: "filled"
          });
        }
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

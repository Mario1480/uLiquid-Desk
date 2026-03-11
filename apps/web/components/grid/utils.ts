import { ApiError } from "../../lib/api";
import type { ExchangeAccount, GridFillsResponse } from "./types";

export type GridCycleRow = {
  id: string;
  key: string;
  openFill: GridFillsResponse["items"][number];
  closeFill: GridFillsResponse["items"][number] | null;
  realizedPnlUsd: number | null;
  releasedProfitUsd: number;
};

export function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = typeof error.payload?.reason === "string" ? error.payload.reason.trim() : "";
    const suffix = reason ? `: ${reason}` : "";
    return `${error.message}${suffix} (HTTP ${error.status})`;
  }
  if (error && typeof error === "object" && "message" in error) return String((error as any).message ?? error);
  return String(error);
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return parsed.toFixed(digits);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleString();
}

export function createIdempotencyKey(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function isPerpCapable(account: ExchangeAccount): boolean {
  if (typeof account.supportsPerpManual === "boolean") return account.supportsPerpManual;
  return true;
}

export function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.NEXT_PUBLIC_GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

export function formatVaultExecutionProviderLabel(value: string | null | undefined): string {
  const provider = String(value ?? "").trim().toLowerCase();
  if (!provider) return "n/a";
  if (provider === "hyperliquid_demo") return "HyperVaults Demo";
  if (provider === "hyperliquid") return "HyperVaults Live";
  if (provider === "mock") return "Mock Provider";
  return String(value);
}

export function distancePctFromMark(price: number | null | undefined, mark: number | null | undefined): number | null {
  const parsedPrice = Number(price ?? NaN);
  const parsedMark = Number(mark ?? NaN);
  if (!Number.isFinite(parsedPrice) || !Number.isFinite(parsedMark) || parsedMark <= 0) return null;
  return ((parsedPrice - parsedMark) / parsedMark) * 100;
}

export function buildGridCycles(fills: GridFillsResponse["items"]): GridCycleRow[] {
  const ascending = [...fills].sort((a, b) => new Date(a.fillTs).getTime() - new Date(b.fillTs).getTime());
  const pendingBuysBySellIndex = new Map<number, Array<GridPendingCycleLot>>();
  const pendingSellsByBuyIndex = new Map<number, Array<GridPendingCycleLot>>();
  const cycles: GridCycleRow[] = [];

  for (const fill of ascending) {
    const fillQty = Number(fill.fillQty ?? 0);
    if (!Number.isFinite(fillQty) || fillQty <= 0) continue;
    const fillFeeUsd = Number(fill.feeUsd ?? 0);
    const openingIntent = inferGridFillIntentType(fill);
    let remainingQty = fillQty;
    const expectedMatchIndex = fill.side === "buy" ? fill.gridIndex : fill.gridIndex;
    const matchingQueue = fill.side === "buy" ? pendingSellsByBuyIndex : pendingBuysBySellIndex;

    while (remainingQty > 0) {
      const lot = peekPendingLot(matchingQueue, expectedMatchIndex);
      if (!lot) break;
      const matchedQty = Math.min(remainingQty, lot.qty);
      const closeFeePart = allocateFeePart(fillFeeUsd, matchedQty, fillQty);
      const realized = computeCycleRealizedPnl(lot, fill, matchedQty, closeFeePart);
      cycles.push({
        id: `${lot.fill.id}:${fill.id}:${cycles.length}`,
        key: `${lot.fill.gridLeg}:${lot.fill.gridIndex}->${fill.gridIndex}`,
        openFill: lot.fill,
        closeFill: fill,
        realizedPnlUsd: realized,
        releasedProfitUsd: realized
      });
      lot.qty = Number((lot.qty - matchedQty).toFixed(12));
      remainingQty = Number((remainingQty - matchedQty).toFixed(12));
      if (lot.qty <= 0) shiftPendingLot(matchingQueue, expectedMatchIndex);
    }

    if (remainingQty > 0) {
      const openFee = allocateFeePart(fillFeeUsd, remainingQty, fillQty);
      const pendingLot: GridPendingCycleLot = {
        fill,
        qty: Number(remainingQty.toFixed(12)),
        feePerUnit: remainingQty > 0 ? openFee / remainingQty : 0,
        intentType: openingIntent
      };
      const expectedCloseIndex = fill.side === "buy" ? fill.gridIndex + 1 : fill.gridIndex - 1;
      const targetQueue = fill.side === "buy" ? pendingBuysBySellIndex : pendingSellsByBuyIndex;
      pushPendingLot(targetQueue, expectedCloseIndex, pendingLot);
    }
  }

  appendOpenCycles(cycles, pendingBuysBySellIndex);
  appendOpenCycles(cycles, pendingSellsByBuyIndex);

  return cycles.sort((a, b) => {
    if (a.closeFill && !b.closeFill) return -1;
    if (!a.closeFill && b.closeFill) return 1;
    const left = new Date(a.closeFill?.fillTs ?? a.openFill.fillTs).getTime();
    const right = new Date(b.closeFill?.fillTs ?? b.openFill.fillTs).getTime();
    return right - left;
  });
}

type GridPendingCycleLot = {
  fill: GridFillsResponse["items"][number];
  qty: number;
  feePerUnit: number;
  intentType: "entry" | "rebalance";
};

function inferGridFillIntentType(fill: GridFillsResponse["items"][number]): "entry" | "rebalance" {
  const rawIntent = String(fill.rawJson && typeof fill.rawJson === "object" ? (fill.rawJson as Record<string, unknown>).intentType ?? "" : "").trim().toLowerCase();
  if (rawIntent === "entry") return "entry";
  if (rawIntent === "rebalance" || rawIntent === "tp" || rawIntent === "sl") return "rebalance";
  if (fill.gridLeg === "short") {
    return fill.side === "sell" ? "entry" : "rebalance";
  }
  return fill.side === "buy" ? "entry" : "rebalance";
}

function allocateFeePart(totalFee: number, partQty: number, totalQty: number): number {
  if (!Number.isFinite(totalFee) || totalFee <= 0) return 0;
  if (!Number.isFinite(partQty) || partQty <= 0) return 0;
  if (!Number.isFinite(totalQty) || totalQty <= 0) return 0;
  return totalFee * (partQty / totalQty);
}

function pushPendingLot(
  pendingByExpectedIndex: Map<number, Array<GridPendingCycleLot>>,
  expectedIndex: number,
  lot: GridPendingCycleLot
) {
  const current = pendingByExpectedIndex.get(expectedIndex) ?? [];
  current.push(lot);
  pendingByExpectedIndex.set(expectedIndex, current);
}

function peekPendingLot(
  pendingByExpectedIndex: Map<number, Array<GridPendingCycleLot>>,
  expectedIndex: number
): GridPendingCycleLot | null {
  const current = pendingByExpectedIndex.get(expectedIndex) ?? [];
  return current[0] ?? null;
}

function shiftPendingLot(
  pendingByExpectedIndex: Map<number, Array<GridPendingCycleLot>>,
  expectedIndex: number
) {
  const current = pendingByExpectedIndex.get(expectedIndex) ?? [];
  current.shift();
  if (current.length === 0) {
    pendingByExpectedIndex.delete(expectedIndex);
    return;
  }
  pendingByExpectedIndex.set(expectedIndex, current);
}

function computeCycleRealizedPnl(
  openLot: GridPendingCycleLot,
  closeFill: GridFillsResponse["items"][number],
  matchedQty: number,
  closeFeePart: number
): number {
  const openFillNotional = Number(openLot.fill.fillNotionalUsd ?? 0);
  const closeFillNotional = Number(closeFill.fillNotionalUsd ?? 0);
  const openQty = Math.max(Number(openLot.fill.fillQty ?? 0), 1e-12);
  const closeQty = Math.max(Number(closeFill.fillQty ?? 0), 1e-12);
  const openUnitNotional = openFillNotional / openQty;
  const closeUnitNotional = closeFillNotional / closeQty;
  const openFeePart = openLot.feePerUnit * matchedQty;
  if (openLot.fill.side === "buy") {
    return (closeUnitNotional - openUnitNotional) * matchedQty - openFeePart - closeFeePart;
  }
  return (openUnitNotional - closeUnitNotional) * matchedQty - openFeePart - closeFeePart;
}

function appendOpenCycles(
  cycles: GridCycleRow[],
  pendingByExpectedIndex: Map<number, Array<GridPendingCycleLot>>
) {
  const openLots = [...pendingByExpectedIndex.values()].flat();
  for (const lot of openLots) {
    if (lot.qty <= 0) continue;
    cycles.push({
      id: `${lot.fill.id}:open`,
      key: `${lot.fill.gridLeg}:${lot.fill.gridIndex}`,
      openFill: lot.fill,
      closeFill: null,
      realizedPnlUsd: null,
      releasedProfitUsd: 0
    });
  }
}

export function deriveUnrealizedPnlFromSnapshot(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  const qty = Number(record.qty ?? NaN);
  const entryPrice = Number(record.entryPrice ?? NaN);
  const markPrice = Number(record.markPrice ?? NaN);
  const side = String(record.side ?? "").trim().toLowerCase();
  if (!Number.isFinite(qty) || !Number.isFinite(entryPrice) || !Number.isFinite(markPrice) || qty <= 0) return null;
  if (side === "short") return (entryPrice - markPrice) * qty;
  if (side === "long") return (markPrice - entryPrice) * qty;
  return null;
}

export function buildSparklinePoints(values: number[], width = 880, height = 220): string {
  if (values.length <= 1) {
    return `0,${height / 2} ${width},${height / 2}`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1e-9);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

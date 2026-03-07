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

export function distancePctFromMark(price: number | null | undefined, mark: number | null | undefined): number | null {
  const parsedPrice = Number(price ?? NaN);
  const parsedMark = Number(mark ?? NaN);
  if (!Number.isFinite(parsedPrice) || !Number.isFinite(parsedMark) || parsedMark <= 0) return null;
  return ((parsedPrice - parsedMark) / parsedMark) * 100;
}

export function buildGridCycles(fills: GridFillsResponse["items"]): GridCycleRow[] {
  const ascending = [...fills].sort((a, b) => new Date(a.fillTs).getTime() - new Date(b.fillTs).getTime());
  const unmatched = new Map<string, GridFillsResponse["items"][number][]>();
  const cycles: GridCycleRow[] = [];

  for (const fill of ascending) {
    const legKey = String(fill.gridLeg ?? "long");
    const bucket = unmatched.get(legKey) ?? [];
    const intentType = inferGridFillIntentType(fill);
    if (intentType === "entry") {
      bucket.push(fill);
      unmatched.set(legKey, bucket);
      continue;
    }

    const matchIndex = findMatchingOpenFillIndex(fill, bucket);
    if (matchIndex >= 0) {
      const [openFill] = bucket.splice(matchIndex, 1);
      unmatched.set(legKey, bucket);
      const totalFees = Number(openFill.feeUsd ?? 0) + Number(fill.feeUsd ?? 0);
      const realized =
        openFill.side === "buy" && fill.side === "sell"
          ? Number(fill.fillNotionalUsd ?? 0) - Number(openFill.fillNotionalUsd ?? 0) - totalFees
          : openFill.side === "sell" && fill.side === "buy"
            ? Number(openFill.fillNotionalUsd ?? 0) - Number(fill.fillNotionalUsd ?? 0) - totalFees
            : null;

      cycles.push({
        id: `${openFill.id}:${fill.id}`,
        key: `${openFill.gridLeg}:${openFill.gridIndex}->${fill.gridIndex}`,
        openFill,
        closeFill: fill,
        realizedPnlUsd: realized,
        releasedProfitUsd: realized ?? 0
      });
      continue;
    }

    // Unmatched close-side fills are typically reductions against the seeded base
    // position or a previously persisted leg we cannot reconstruct from local fills.
    // They should not surface as fake "waiting" transactions in the user view.
  }

  for (const [key, bucket] of unmatched.entries()) {
    for (const openFill of bucket) {
      cycles.push({
        id: `${openFill.id}:open`,
        key: `${key}:${openFill.gridIndex}`,
        openFill,
        closeFill: null,
        realizedPnlUsd: null,
        releasedProfitUsd: 0
      });
    }
  }

  return cycles.sort((a, b) => {
    if (a.closeFill && !b.closeFill) return -1;
    if (!a.closeFill && b.closeFill) return 1;
    const left = new Date(a.closeFill?.fillTs ?? a.openFill.fillTs).getTime();
    const right = new Date(b.closeFill?.fillTs ?? b.openFill.fillTs).getTime();
    return right - left;
  });
}

function inferGridFillIntentType(fill: GridFillsResponse["items"][number]): "entry" | "rebalance" {
  const rawIntent = String(fill.rawJson && typeof fill.rawJson === "object" ? (fill.rawJson as Record<string, unknown>).intentType ?? "" : "").trim().toLowerCase();
  if (rawIntent === "entry") return "entry";
  if (rawIntent === "rebalance" || rawIntent === "tp" || rawIntent === "sl") return "rebalance";
  if (fill.gridLeg === "short") {
    return fill.side === "sell" ? "entry" : "rebalance";
  }
  return fill.side === "buy" ? "entry" : "rebalance";
}

function findMatchingOpenFillIndex(
  closeFill: GridFillsResponse["items"][number],
  bucket: GridFillsResponse["items"][number][]
): number {
  if (bucket.length === 0) return -1;
  if (closeFill.gridLeg === "short") {
    const expectedEntryIndex = Number(closeFill.gridIndex ?? 0) + 1;
    const exact = findLastIndex(bucket, (candidate) => candidate.side === "sell" && Number(candidate.gridIndex ?? 0) === expectedEntryIndex);
    if (exact >= 0) return exact;
    const fallback = findLastIndex(bucket, (candidate) => candidate.side === "sell" && Number(candidate.gridIndex ?? 0) >= Number(closeFill.gridIndex ?? 0));
    if (fallback >= 0) return fallback;
  } else {
    const expectedEntryIndex = Number(closeFill.gridIndex ?? 0) - 1;
    const exact = findLastIndex(bucket, (candidate) => candidate.side === "buy" && Number(candidate.gridIndex ?? 0) === expectedEntryIndex);
    if (exact >= 0) return exact;
    const fallback = findLastIndex(bucket, (candidate) => candidate.side === "buy" && Number(candidate.gridIndex ?? 0) <= Number(closeFill.gridIndex ?? 0));
    if (fallback >= 0) return fallback;
  }
  return -1;
}

function findLastIndex<T>(rows: T[], predicate: (value: T, index: number) => boolean): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index], index)) return index;
  }
  return -1;
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

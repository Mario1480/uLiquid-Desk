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
    if (error.payload?.error === "onchain_close_only_required") {
      return "Onchain close-only is required before this BotVault can be closed.";
    }
    if (error.payload?.error === "onchain_close_only_unavailable") {
      if (reason.includes("bot_vault_onchain_close_only_already_set:CLOSE_ONLY")) {
        return "This BotVault is already onchain close-only.";
      }
      if (reason.includes("bot_vault_onchain_close_only_already_set:CLOSED")) {
        return "This BotVault is already closed onchain.";
      }
      return "This BotVault cannot be switched to onchain close-only from its current onchain state.";
    }
    if (error.payload?.error === "onchain_hypercore_exit_required") {
      const settlementStepMatch = reason.match(/(?:^|:)settlementStep=([^:]+)/);
      const settlementErrorMatch = reason.match(/(?:^|:)settlementError=([^:]+)/);
      const settlementStep = settlementStepMatch?.[1] ?? "";
      let settlementError = "";
      if (settlementErrorMatch?.[1]) {
        try {
          settlementError = decodeURIComponent(settlementErrorMatch[1]);
        } catch {
          settlementError = settlementErrorMatch[1];
        }
      }
      if (settlementStep === "transfer_usdc_spot_to_evm") {
        const txHashMatch = settlementError.match(/0x[a-fA-F0-9]{64}/);
        const txSuffix = txHashMatch ? ` Failed tx: ${txHashMatch[0]}.` : "";
        return `Automatic HyperCore exit failed during spot -> HyperEVM transfer.${txSuffix} Keep this BotVault in close-only until settlement is complete.`;
      }
      if (settlementStep === "ensure_hypercore_exit_gas") {
        if (settlementError.includes("bot_vault_v3_hypercore_exit_gas_missing_in_close_only")) {
          return "Automatic HyperCore exit is stuck because the BotVault is already in close-only without enough HYPE gas for the final HyperEVM transfer.";
        }
        if (settlementError.includes("bot_vault_v3_hypercore_exit_gas_missing")) {
          return "Automatic HyperCore exit could not continue because the BotVault lacks HYPE gas for the final HyperEVM transfer.";
        }
      }
      return "HyperCore still holds funds or positions for this BotVault. Keep it in close-only until perp -> spot -> HyperEVM settlement is complete.";
    }
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

export function formatAdaptiveNumber(
  value: number | null | undefined,
  options?: {
    digits?: number;
    tinyDigits?: number;
    tinyThreshold?: number;
  }
): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  const digits = options?.digits ?? 2;
  const tinyDigits = options?.tinyDigits ?? 4;
  const tinyThreshold = options?.tinyThreshold ?? 0.1;
  const effectiveDigits = Math.abs(parsed) > 0 && Math.abs(parsed) < tinyThreshold ? tinyDigits : digits;
  return parsed.toFixed(effectiveDigits);
}

export function formatSignedPercent(
  value: number | null | undefined,
  options?: {
    digits?: number;
    tinyDigits?: number;
    tinyThreshold?: number;
  }
): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return `${parsed >= 0 ? "+" : ""}${formatAdaptiveNumber(parsed, options)}%`;
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

export function normalizeGridProvisioningPhase(value: string | null | undefined): string {
  const phase = String(value ?? "").trim().toLowerCase();
  switch (phase) {
    case "pending_signature":
    case "submitted_waiting_indexer":
    case "pending_reserve_signature":
    case "submitted_waiting_reserve_indexer":
    case "pending_hypercore_funding_signature":
    case "submitted_waiting_hypercore_funding_indexer":
    case "agent_launch_preparing":
    case "agent_refill_preparing":
    case "execution_active":
    case "ready":
    case "completed":
      return phase;
    default:
      return phase || "unknown";
  }
}

export function provisioningPhaseTone(value: string | null | undefined): "info" | "warning" | "success" {
  const phase = normalizeGridProvisioningPhase(value);
  if (phase === "execution_active" || phase === "ready" || phase === "completed") return "success";
  if (
    phase === "pending_signature"
    || phase === "pending_reserve_signature"
    || phase === "pending_hypercore_funding_signature"
  ) {
    return "warning";
  }
  return "info";
}

export function distancePctFromMark(price: number | null | undefined, mark: number | null | undefined): number | null {
  const parsedPrice = Number(price ?? NaN);
  const parsedMark = Number(mark ?? NaN);
  if (!Number.isFinite(parsedPrice) || !Number.isFinite(parsedMark) || parsedMark <= 0) return null;
  return ((parsedPrice - parsedMark) / parsedMark) * 100;
}

export function buildGridCycles(fills: GridFillsResponse["items"]): GridCycleRow[] {
  const ascending = [...fills].sort((a, b) => new Date(a.fillTs).getTime() - new Date(b.fillTs).getTime());
  const pendingBuysBySellIndex = new Map<string, Array<GridPendingCycleLot>>();
  const pendingSellsByBuyIndex = new Map<string, Array<GridPendingCycleLot>>();
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
      const exactMatch = peekPendingLot(matchingQueue, fill.gridLeg, expectedMatchIndex);
      const fallbackMatch = exactMatch ? null : findFallbackPendingLot(matchingQueue, fill);
      const matched = exactMatch
        ? { key: buildPendingLotKey(fill.gridLeg, expectedMatchIndex), lot: exactMatch }
        : fallbackMatch;
      const lot = matched?.lot ?? null;
      if (!lot || !matched) break;
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
      if (lot.qty <= 0) shiftPendingLot(matchingQueue, matched.key);
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
      pushPendingLot(targetQueue, fill.gridLeg, expectedCloseIndex, pendingLot);
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

function buildPendingLotKey(gridLeg: GridFillsResponse["items"][number]["gridLeg"], expectedIndex: number): string {
  return `${gridLeg}:${expectedIndex}`;
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

function allocateFeePart(totalFee: number, partQty: number, totalQty: number): number {
  if (!Number.isFinite(totalFee) || totalFee <= 0) return 0;
  if (!Number.isFinite(partQty) || partQty <= 0) return 0;
  if (!Number.isFinite(totalQty) || totalQty <= 0) return 0;
  return totalFee * (partQty / totalQty);
}

function pushPendingLot(
  pendingByExpectedIndex: Map<string, Array<GridPendingCycleLot>>,
  gridLeg: GridFillsResponse["items"][number]["gridLeg"],
  expectedIndex: number,
  lot: GridPendingCycleLot
) {
  const key = buildPendingLotKey(gridLeg, expectedIndex);
  const current = pendingByExpectedIndex.get(key) ?? [];
  current.push(lot);
  pendingByExpectedIndex.set(key, current);
}

function peekPendingLot(
  pendingByExpectedIndex: Map<string, Array<GridPendingCycleLot>>,
  gridLeg: GridFillsResponse["items"][number]["gridLeg"],
  expectedIndex: number
): GridPendingCycleLot | null {
  const current = pendingByExpectedIndex.get(buildPendingLotKey(gridLeg, expectedIndex)) ?? [];
  return current[0] ?? null;
}

function shiftPendingLot(
  pendingByExpectedIndex: Map<string, Array<GridPendingCycleLot>>,
  key: string
) {
  const current = pendingByExpectedIndex.get(key) ?? [];
  current.shift();
  if (current.length === 0) {
    pendingByExpectedIndex.delete(key);
    return;
  }
  pendingByExpectedIndex.set(key, current);
}

function findFallbackPendingLot(
  pendingByExpectedIndex: Map<string, Array<GridPendingCycleLot>>,
  closeFill: GridFillsResponse["items"][number]
): { key: string; lot: GridPendingCycleLot } | null {
  let best: { key: string; lot: GridPendingCycleLot; fillTsMs: number; gridDistance: number } | null = null;
  for (const [key, lots] of pendingByExpectedIndex.entries()) {
    const lot = lots[0];
    if (!lot) continue;
    if (lot.fill.gridLeg !== closeFill.gridLeg) continue;
    if (!isFallbackLotCompatible(lot.fill, closeFill)) continue;
    const fillTsMs = new Date(lot.fill.fillTs).getTime();
    const gridDistance = Math.abs(Number(closeFill.gridIndex ?? 0) - Number(lot.fill.gridIndex ?? 0));
    if (
      !best
      || fillTsMs < best.fillTsMs
      || (fillTsMs === best.fillTsMs && gridDistance < best.gridDistance)
    ) {
      best = { key, lot, fillTsMs, gridDistance };
    }
  }
  return best ? { key: best.key, lot: best.lot } : null;
}

function isFallbackLotCompatible(
  openFill: GridFillsResponse["items"][number],
  closeFill: GridFillsResponse["items"][number]
): boolean {
  if (openFill.gridLeg !== closeFill.gridLeg) return false;
  if (openFill.side === closeFill.side) return false;
  return new Date(closeFill.fillTs).getTime() >= new Date(openFill.fillTs).getTime();
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
  pendingByExpectedIndex: Map<string, Array<GridPendingCycleLot>>
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
  return computeGridUnrealizedPnl({
    qty: Number(readGridPositionValue(record, ["qty", "size", "szi"]) ?? NaN),
    entryPrice: Number(readGridPositionValue(record, ["entryPrice", "entryPx", "avgEntryPrice"]) ?? NaN),
    markPrice: Number(readGridPositionValue(record, ["markPrice", "markPx", "mark", "midPx", "indexPrice", "oraclePx", "price"]) ?? NaN),
    side: String(readGridPositionValue(record, ["side", "direction"]) ?? "").trim().toLowerCase()
  });
}

export function computeGridUnrealizedPnl(input: {
  qty: number | null | undefined;
  entryPrice: number | null | undefined;
  markPrice: number | null | undefined;
  side: string | null | undefined;
}): number | null {
  const qty = Number(input.qty ?? NaN);
  const entryPrice = Number(input.entryPrice ?? NaN);
  const markPrice = Number(input.markPrice ?? NaN);
  const side = String(input.side ?? "").trim().toLowerCase();
  if (!Number.isFinite(qty) || !Number.isFinite(entryPrice) || !Number.isFinite(markPrice) || qty <= 0) return null;
  if (side === "short") return (entryPrice - markPrice) * qty;
  if (side === "long") return (markPrice - entryPrice) * qty;
  return null;
}

export function readGridPositionValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[]
): unknown {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

export function computeGridRuntimeMarkPrice(input: {
  mid?: number | null;
  bid?: number | null;
  ask?: number | null;
} | null | undefined): number | null {
  const candidates = [input?.mid, input?.bid, input?.ask]
    .map((value) => Number(value ?? NaN))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return null;
  if (Number.isFinite(Number(input?.mid ?? NaN)) && Number(input?.mid) > 0) return Number(input?.mid);
  if (candidates.length >= 2) return Number(((candidates[0] + candidates[1]) / 2).toFixed(8));
  return candidates[0] ?? null;
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

import type { MarginMode } from "@mm/futures-core";

export type PositionRiskMetricsInput = {
  side: "long" | "short";
  size?: number | null;
  entryPrice?: number | null;
  markPrice?: number | null;
  unrealizedPnl?: number | null;
  leverage?: number | null;
  marginMode?: MarginMode | null;
  marginUsd?: number | null;
  notionalUsd?: number | null;
  liquidationPrice?: number | null;
  liquidationDistancePct?: number | null;
  roePct?: number | null;
  pnlPct?: number | null;
};

export type PositionRiskMetrics = {
  leverage: number | null;
  marginMode: MarginMode | null;
  marginUsd: number | null;
  notionalUsd: number | null;
  liquidationPrice: number | null;
  liquidationDistancePct: number | null;
  roePct: number | null;
  pnlPct: number | null;
};

export function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function pickFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function normalizePositionMarginMode(value: unknown): MarginMode | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw.includes("isolated") || raw === "fixed") return "isolated";
  if (raw === "2" || raw.includes("cross") || raw === "crossed" || raw === "full") return "cross";
  return null;
}

export function buildPositionRiskMetrics(input: PositionRiskMetricsInput): PositionRiskMetrics {
  const leverage = sanitizePositive(input.leverage);
  const entryPrice = sanitizePositive(input.entryPrice);
  const markPrice = sanitizePositive(input.markPrice);
  const size = sanitizePositive(input.size);
  const pnl = toFiniteNumberOrNull(input.unrealizedPnl);
  const priceForNotional = markPrice ?? entryPrice;
  const derivedNotional = size !== null && priceForNotional !== null ? size * priceForNotional : null;
  const notionalUsd = sanitizePositive(input.notionalUsd) ?? sanitizePositive(derivedNotional);
  const marginUsd = sanitizePositive(input.marginUsd) ?? (
    notionalUsd !== null && leverage !== null && leverage > 0 ? notionalUsd / leverage : null
  );
  const liquidationPrice = sanitizePositive(input.liquidationPrice);
  const liquidationDistancePct = toFiniteNumberOrNull(input.liquidationDistancePct) ?? (
    liquidationPrice !== null && markPrice !== null && markPrice > 0
      ? input.side === "short"
        ? ((liquidationPrice - markPrice) / markPrice) * 100
        : ((markPrice - liquidationPrice) / markPrice) * 100
      : null
  );
  const pnlPct = toFiniteNumberOrNull(input.pnlPct) ?? (
    pnl !== null && notionalUsd !== null && notionalUsd > 0 ? (pnl / notionalUsd) * 100 : null
  );
  const roePct = normalizeRoePct(input.roePct) ?? (
    pnl !== null && marginUsd !== null && marginUsd > 0 ? (pnl / marginUsd) * 100 : null
  );

  return {
    leverage,
    marginMode: input.marginMode ?? null,
    marginUsd,
    notionalUsd,
    liquidationPrice,
    liquidationDistancePct,
    roePct,
    pnlPct
  };
}

function sanitizePositive(value: unknown): number | null {
  const parsed = toFiniteNumberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizeRoePct(value: unknown): number | null {
  const parsed = toFiniteNumberOrNull(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

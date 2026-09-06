function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Preserve a reported zero price without turning it into a liquidation distance. */
export function normalizePositionLiquidation(input: {
  side: "long" | "short";
  markPrice?: unknown;
  liquidationPrice?: unknown;
  liquidationDistancePct?: unknown;
}): { liquidationPrice: number | null; liquidationDistancePct: number | null } {
  const reportedPrice = finiteNumber(input.liquidationPrice);
  const liquidationPrice = reportedPrice !== null && reportedPrice >= 0 ? reportedPrice : null;
  const markPrice = finiteNumber(input.markPrice);
  const liquidationDistancePct = liquidationPrice === 0 ? null : (
    finiteNumber(input.liquidationDistancePct) ?? (
      liquidationPrice !== null && markPrice !== null && markPrice > 0
        ? (input.side === "short" ? liquidationPrice - markPrice : markPrice - liquidationPrice) / markPrice * 100
        : null
    )
  );
  return { liquidationPrice, liquidationDistancePct };
}

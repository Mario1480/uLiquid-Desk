export type PositionEstimate = {
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  marginUsd: number | null;
};

export function estimatePnl(position: PositionEstimate, price: number): number | null {
  if (!(position.entryPrice && position.entryPrice > 0 && position.size > 0 && Number.isFinite(price) && price > 0)) return null;
  return (price - position.entryPrice) * position.size * (position.side === "long" ? 1 : -1);
}

export function priceFromRoe(position: PositionEstimate, roe: number): number | null {
  if (!(position.entryPrice && position.entryPrice > 0 && position.size > 0 && position.marginUsd && position.marginUsd > 0 && Number.isFinite(roe))) return null;
  const price = position.entryPrice + (position.side === "long" ? 1 : -1) * roe / 100 * position.marginUsd / position.size;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function partialCloseOrder(position: { symbol: string; side: "long" | "short"; size: number }, percentage: number, spot: boolean) {
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100 || !Number.isFinite(position.size) || position.size <= 0) throw new Error("invalid_close_percentage");
  return {
    symbol: position.symbol,
    type: "market" as const,
    side: spot ? "sell" as const : position.side === "long" ? "short" as const : "long" as const,
    qty: position.size * percentage / 100,
    ...(spot ? {} : { reduceOnly: true })
  };
}

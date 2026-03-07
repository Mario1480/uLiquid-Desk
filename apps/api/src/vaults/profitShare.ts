export const DEFAULT_PROFIT_SHARE_RATE = 0.3;

export function roundUsd(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function computeProfitShareFeeUsd(
  realizedNetUsd: number,
  rate = DEFAULT_PROFIT_SHARE_RATE
): number {
  const realized = Number(realizedNetUsd);
  const normalizedRate = Number(rate);
  if (!Number.isFinite(realized) || !Number.isFinite(normalizedRate)) return 0;
  if (realized <= 0 || normalizedRate <= 0) return 0;
  return roundUsd(realized * normalizedRate, 4);
}

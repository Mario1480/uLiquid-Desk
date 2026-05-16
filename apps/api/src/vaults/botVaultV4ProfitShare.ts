import { formatUnits, parseUnits } from "viem";
import { computeProfitShareAccounting } from "./feeSettlement.math.js";

function roundUsd(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function formatUsdAtomicToNumber(value: bigint): number {
  return roundUsd(Number(formatUnits(value, 6)), 6);
}

export function formatSignedUsdAtomicToNumber(value: bigint): number {
  const sign = value < 0n ? -1 : 1;
  const magnitude = value < 0n ? -value : value;
  return roundUsd(sign * Number(formatUnits(magnitude, 6)), 6);
}

export function toAtomicUsd(value: number): bigint {
  const rounded = roundUsd(toNonNegativeNumber(value), 6);
  return parseUnits(rounded.toFixed(6), 6);
}

export function toSignedAtomicUsd(value: number): bigint {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : 0;
  const sign = parsed < 0 ? -1n : 1n;
  return sign * toAtomicUsd(Math.abs(parsed));
}

export function computeV4ProfitShareRaw(params: {
  payoutProfitRaw: bigint;
  feeRatePctRaw: bigint;
  realizedClosedPnlUsd: number;
  highWaterMarkBeforeUsd: number;
}) {
  const realizedClosedPnlRaw = toSignedAtomicUsd(params.realizedClosedPnlUsd);
  const highWaterMarkBeforeRaw = toAtomicUsd(params.highWaterMarkBeforeUsd);
  const positiveRealizedClosedPnlRaw = realizedClosedPnlRaw > 0n ? realizedClosedPnlRaw : 0n;
  const feeableCapacityRaw = positiveRealizedClosedPnlRaw > highWaterMarkBeforeRaw
    ? positiveRealizedClosedPnlRaw - highWaterMarkBeforeRaw
    : 0n;
  const feeBaseRaw = params.payoutProfitRaw < feeableCapacityRaw
    ? params.payoutProfitRaw
    : feeableCapacityRaw;
  const feeAmountRaw = (feeBaseRaw * params.feeRatePctRaw) / 100n;
  const highWaterMarkAfterRaw = highWaterMarkBeforeRaw + feeBaseRaw;
  const accounting = computeProfitShareAccounting({
    realizedClosedPnlUsd: formatSignedUsdAtomicToNumber(realizedClosedPnlRaw),
    settledProfitUsd: formatUsdAtomicToNumber(highWaterMarkBeforeRaw),
    payoutProfitUsd: formatUsdAtomicToNumber(params.payoutProfitRaw),
    feeRatePct: Number(params.feeRatePctRaw)
  });

  return {
    feeBaseRaw,
    feeAmountRaw,
    realizedClosedPnlRaw,
    highWaterMarkBeforeRaw,
    highWaterMarkAfterRaw,
    realizedClosedPnlUsd: accounting.realizedClosedPnlUsd,
    highWaterMarkBeforeUsd: accounting.settledProfitBeforeUsd,
    highWaterMarkAfterUsd: formatUsdAtomicToNumber(highWaterMarkAfterRaw)
  };
}

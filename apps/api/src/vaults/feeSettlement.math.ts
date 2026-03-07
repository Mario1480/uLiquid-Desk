import { roundUsd } from "./profitShare.js";

export const DEFAULT_SETTLEMENT_FEE_RATE_PCT = 30;

export type FeeSettlementMode = "PROFIT_ONLY_WITHDRAW" | "FINAL_CLOSE";

export type FeeSettlementMathInput = {
  mode: FeeSettlementMode;
  requestedGrossUsd?: number;
  availableUsd: number;
  principalOutstandingUsd: number;
  realizedPnlNetUsd: number;
  highWaterMarkUsd: number;
  feeRatePct?: number;
};

export type FeeSettlementMathResult = {
  mode: FeeSettlementMode;
  requestedGrossUsd: number;
  grossTransferUsd: number;
  reservedReleaseUsd: number;
  principalComponentUsd: number;
  realizedProfitComponentUsd: number;
  feeableProfitCapacityBeforeUsd: number;
  feeBaseUsd: number;
  feeAmountUsd: number;
  netTransferUsd: number;
  highWaterMarkBeforeUsd: number;
  highWaterMarkAfterUsd: number;
  maxProfitOnlyWithdrawableUsd: number;
  feeRatePct: number;
};

function toNonNegative(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function computeProfitOnlyWithdrawableUsd(input: {
  availableUsd: number;
  principalOutstandingUsd: number;
}): number {
  const availableUsd = toNonNegative(input.availableUsd);
  const principalOutstandingUsd = toNonNegative(input.principalOutstandingUsd);
  return roundUsd(Math.max(0, availableUsd - principalOutstandingUsd), 4);
}

export function computeFeeSettlementMath(input: FeeSettlementMathInput): FeeSettlementMathResult {
  const feeRatePct = toNonNegative(input.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT);
  const feeRate = feeRatePct / 100;

  const availableUsd = roundUsd(toNonNegative(input.availableUsd), 6);
  const principalOutstandingUsd = roundUsd(toNonNegative(input.principalOutstandingUsd), 6);
  const realizedPnlNetUsd = roundUsd(Number.isFinite(Number(input.realizedPnlNetUsd)) ? Number(input.realizedPnlNetUsd) : 0, 6);
  const highWaterMarkBeforeUsd = roundUsd(toNonNegative(input.highWaterMarkUsd), 6);

  const maxProfitOnlyWithdrawableUsd = computeProfitOnlyWithdrawableUsd({
    availableUsd,
    principalOutstandingUsd
  });

  const requestedGrossUsd = roundUsd(toNonNegative(input.requestedGrossUsd ?? 0), 6);
  const grossTransferUsd = input.mode === "FINAL_CLOSE"
    ? roundUsd(availableUsd, 6)
    : roundUsd(Math.min(requestedGrossUsd, maxProfitOnlyWithdrawableUsd), 6);

  const principalComponentUsd = input.mode === "FINAL_CLOSE"
    ? roundUsd(Math.min(grossTransferUsd, principalOutstandingUsd), 6)
    : 0;
  const reservedReleaseUsd = input.mode === "FINAL_CLOSE" ? principalOutstandingUsd : 0;

  const realizedProfitComponentUsd = roundUsd(Math.max(0, grossTransferUsd - principalComponentUsd), 6);

  const feeableProfitCapacityBeforeUsd = roundUsd(
    Math.max(0, realizedPnlNetUsd - highWaterMarkBeforeUsd),
    6
  );

  const feeBaseUsd = roundUsd(
    Math.min(realizedProfitComponentUsd, feeableProfitCapacityBeforeUsd),
    6
  );

  const feeAmountUsd = roundUsd(Math.max(0, feeBaseUsd * feeRate), 4);
  const netTransferUsd = roundUsd(Math.max(0, grossTransferUsd - feeAmountUsd), 6);
  const highWaterMarkAfterUsd = roundUsd(highWaterMarkBeforeUsd + feeBaseUsd, 6);

  return {
    mode: input.mode,
    requestedGrossUsd,
    grossTransferUsd,
    reservedReleaseUsd,
    principalComponentUsd,
    realizedProfitComponentUsd,
    feeableProfitCapacityBeforeUsd,
    feeBaseUsd,
    feeAmountUsd,
    netTransferUsd,
    highWaterMarkBeforeUsd,
    highWaterMarkAfterUsd,
    maxProfitOnlyWithdrawableUsd,
    feeRatePct: roundUsd(feeRatePct, 6)
  };
}

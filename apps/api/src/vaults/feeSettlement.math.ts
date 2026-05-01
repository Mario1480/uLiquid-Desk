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
  realizedClosedPnlUsd: number;
  settledProfitBeforeUsd: number;
  settledProfitAfterUsd: number;
  feeableProfitCapacityBeforeUsd: number;
  feeBaseUsd: number;
  feeAmountUsd: number;
  netTransferUsd: number;
  highWaterMarkBeforeUsd: number;
  highWaterMarkAfterUsd: number;
  maxProfitOnlyWithdrawableUsd: number;
  feeRatePct: number;
};

export type ProfitShareAccountingInput = {
  realizedClosedPnlUsd: number;
  settledProfitUsd: number;
  payoutProfitUsd: number;
  feeRatePct?: number;
};

export type ProfitShareAccountingResult = {
  realizedClosedPnlUsd: number;
  settledProfitBeforeUsd: number;
  settledProfitAfterUsd: number;
  payoutProfitUsd: number;
  feeableProfitCapacityBeforeUsd: number;
  feeBaseUsd: number;
  feeAmountUsd: number;
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

export function computeProfitShareAccounting(input: ProfitShareAccountingInput): ProfitShareAccountingResult {
  const feeRatePct = roundUsd(toNonNegative(input.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT), 6);
  const feeRate = feeRatePct / 100;
  const realizedClosedPnlUsd = roundUsd(Number.isFinite(Number(input.realizedClosedPnlUsd)) ? Number(input.realizedClosedPnlUsd) : 0, 6);
  const settledProfitBeforeUsd = roundUsd(toNonNegative(input.settledProfitUsd), 6);
  const payoutProfitUsd = roundUsd(toNonNegative(input.payoutProfitUsd), 6);
  const feeableProfitCapacityBeforeUsd = roundUsd(
    Math.max(0, realizedClosedPnlUsd - settledProfitBeforeUsd),
    6
  );
  const feeBaseUsd = roundUsd(
    Math.min(payoutProfitUsd, feeableProfitCapacityBeforeUsd),
    6
  );
  const feeAmountUsd = roundUsd(Math.max(0, feeBaseUsd * feeRate), 4);
  const settledProfitAfterUsd = roundUsd(settledProfitBeforeUsd + feeBaseUsd, 6);

  return {
    realizedClosedPnlUsd,
    settledProfitBeforeUsd,
    settledProfitAfterUsd,
    payoutProfitUsd,
    feeableProfitCapacityBeforeUsd,
    feeBaseUsd,
    feeAmountUsd,
    feeRatePct
  };
}

export function computeFeeSettlementMath(input: FeeSettlementMathInput): FeeSettlementMathResult {
  const feeRatePct = toNonNegative(input.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT);

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

  const profitShare = computeProfitShareAccounting({
    realizedClosedPnlUsd: realizedPnlNetUsd,
    settledProfitUsd: highWaterMarkBeforeUsd,
    payoutProfitUsd: realizedProfitComponentUsd,
    feeRatePct
  });

  const feeAmountUsd = profitShare.feeAmountUsd;
  const netTransferUsd = roundUsd(Math.max(0, grossTransferUsd - feeAmountUsd), 6);

  return {
    mode: input.mode,
    requestedGrossUsd,
    grossTransferUsd,
    reservedReleaseUsd,
    principalComponentUsd,
    realizedProfitComponentUsd,
    realizedClosedPnlUsd: profitShare.realizedClosedPnlUsd,
    settledProfitBeforeUsd: profitShare.settledProfitBeforeUsd,
    settledProfitAfterUsd: profitShare.settledProfitAfterUsd,
    feeableProfitCapacityBeforeUsd: profitShare.feeableProfitCapacityBeforeUsd,
    feeBaseUsd: profitShare.feeBaseUsd,
    feeAmountUsd,
    netTransferUsd,
    highWaterMarkBeforeUsd,
    highWaterMarkAfterUsd: profitShare.settledProfitAfterUsd,
    maxProfitOnlyWithdrawableUsd,
    feeRatePct: profitShare.feeRatePct
  };
}

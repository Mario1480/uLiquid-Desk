export type MarginModeValue = "cross" | "isolated";

export type LiquidationEstimate = {
  long: number | null;
  short: number | null;
};

export type LiquidationEstimateInput = {
  entryPrice: number | null | undefined;
  quantity: number | null | undefined;
  leverage: number | null | undefined;
  marginMode: MarginModeValue;
  accountEquity?: number | null;
  availableMargin?: number | null;
};

function finitePositive(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

export function estimateLiquidationPrices(input: LiquidationEstimateInput): LiquidationEstimate {
  const entryPrice = finitePositive(input.entryPrice);
  const quantity = finitePositive(Math.abs(input.quantity ?? 0));
  const leverage = finitePositive(input.leverage);

  if (entryPrice === null || quantity === null || leverage === null) {
    return { long: null, short: null };
  }

  const notional = quantity * entryPrice;
  if (!Number.isFinite(notional) || notional <= 0) {
    return { long: null, short: null };
  }

  const isolatedCollateral = notional / leverage;
  const crossCollateral =
    finitePositive(input.accountEquity)
    ?? finitePositive(input.availableMargin)
    ?? isolatedCollateral;
  const collateral = input.marginMode === "cross" ? crossCollateral : isolatedCollateral;

  if (!Number.isFinite(collateral) || collateral <= 0) {
    return { long: null, short: null };
  }

  const maintenanceMarginRate = input.marginMode === "isolated" ? 0.004 : 0.005;
  const longDenominator = quantity * (1 - maintenanceMarginRate);
  const shortDenominator = quantity * (1 + maintenanceMarginRate);
  const longPrice = (notional - collateral) / longDenominator;
  const shortPrice = (notional + collateral) / shortDenominator;

  return {
    long: Number.isFinite(longPrice) && longPrice > 0 ? longPrice : null,
    short: Number.isFinite(shortPrice) && shortPrice > 0 ? shortPrice : null
  };
}

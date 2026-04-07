export const BOT_VAULT_V3_CREATE_FEE_USD = 1;

export type BotVaultFundingBreakdown = {
  investUsd: number;
  extraMarginUsd: number;
  createFeeUsd: number;
  totalFundingUsd: number;
};

function roundUsd(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function buildBotVaultFundingBreakdown(input: {
  investUsd: number;
  extraMarginUsd: number;
  includeCreateFee: boolean;
}): BotVaultFundingBreakdown {
  const investUsd = Math.max(0, Number(input.investUsd ?? 0));
  const extraMarginUsd = Math.max(0, Number(input.extraMarginUsd ?? 0));
  const createFeeUsd = input.includeCreateFee ? BOT_VAULT_V3_CREATE_FEE_USD : 0;

  return {
    investUsd: roundUsd(investUsd, 4),
    extraMarginUsd: roundUsd(extraMarginUsd, 4),
    createFeeUsd: roundUsd(createFeeUsd, 4),
    totalFundingUsd: roundUsd(investUsd + extraMarginUsd + createFeeUsd, 4)
  };
}

export const MICROUSD_PER_USD = 1_000_000n;
export const MICROUSD_PER_CREDIT = 1_000n;
export const TOKENS_PER_PRICE_UNIT = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;

export type AiTokenUsage = {
  inputTokens: bigint;
  cachedInputTokens: bigint;
  cacheWriteTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
};

export type AiPricingSnapshot = {
  id: string;
  provider: "openai";
  model: string;
  serviceTier: "default";
  processingRegion: "global";
  inputMicrousdPerMillion: bigint;
  cachedInputMicrousdPerMillion: bigint;
  cacheWriteMicrousdPerMillion: bigint | null;
  outputMicrousdPerMillion: bigint;
  longContextThresholdTokens: number | null;
  longInputMultiplierBps: number | null;
  longOutputMultiplierBps: number | null;
  markupBps: number;
  revision: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

export type AiUsageCostBreakdown = {
  uncachedInputMicrousd: bigint;
  cachedInputMicrousd: bigint;
  cacheWriteMicrousd: bigint;
  outputMicrousd: bigint;
  toolMicrousd: bigint;
  providerCostMicrousd: bigint;
  retailCostMicrousd: bigint;
  longContext: boolean;
};

export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) throw new Error("ai_pricing_invalid_integer");
  return value === 0n ? 0n : ((value - 1n) / divisor) + 1n;
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function tokenCost(tokens: bigint, rate: bigint, multiplierBps: bigint): bigint {
  if (tokens <= 0n || rate <= 0n) return 0n;
  return ceilDiv(tokens * rate * multiplierBps, TOKENS_PER_PRICE_UNIT * BPS_DENOMINATOR);
}

export function calculateAiUsageCost(params: {
  usage: AiTokenUsage;
  pricing: AiPricingSnapshot;
  toolMicrousd?: bigint;
}): AiUsageCostBreakdown {
  const { usage, pricing } = params;
  const cached = nonNegative(usage.cachedInputTokens);
  const cacheWrite = nonNegative(usage.cacheWriteTokens);
  const input = nonNegative(usage.inputTokens);
  if (cached + cacheWrite > input) throw new Error("ai_usage_input_breakdown_invalid");

  const output = nonNegative(usage.outputTokens);
  const longContext = pricing.longContextThresholdTokens !== null
    && input > BigInt(pricing.longContextThresholdTokens);
  const inputMultiplier = BigInt(longContext ? pricing.longInputMultiplierBps ?? 10_000 : 10_000);
  const outputMultiplier = BigInt(longContext ? pricing.longOutputMultiplierBps ?? 10_000 : 10_000);
  const uncached = input - cached - cacheWrite;
  const uncachedInputMicrousd = tokenCost(uncached, pricing.inputMicrousdPerMillion, inputMultiplier);
  const cachedInputMicrousd = tokenCost(cached, pricing.cachedInputMicrousdPerMillion, inputMultiplier);
  const cacheWriteRate = pricing.cacheWriteMicrousdPerMillion ?? pricing.inputMicrousdPerMillion;
  const cacheWriteMicrousd = tokenCost(cacheWrite, cacheWriteRate, inputMultiplier);
  const outputMicrousd = tokenCost(output, pricing.outputMicrousdPerMillion, outputMultiplier);
  const toolMicrousd = nonNegative(params.toolMicrousd ?? 0n);
  const providerCostMicrousd = uncachedInputMicrousd
    + cachedInputMicrousd
    + cacheWriteMicrousd
    + outputMicrousd
    + toolMicrousd;
  const retailCostMicrousd = ceilDiv(providerCostMicrousd * BigInt(pricing.markupBps), BPS_DENOMINATOR);

  return {
    uncachedInputMicrousd,
    cachedInputMicrousd,
    cacheWriteMicrousd,
    outputMicrousd,
    toolMicrousd,
    providerCostMicrousd,
    retailCostMicrousd,
    longContext
  };
}

export function creditsForRetailMicrousd(retailCostMicrousd: bigint, minimum = 0n): bigint {
  if (retailCostMicrousd <= 0n) return 0n;
  const rounded = ceilDiv(retailCostMicrousd, MICROUSD_PER_CREDIT);
  return rounded < minimum ? minimum : rounded;
}

export function serializePricingSnapshot(pricing: AiPricingSnapshot): Record<string, string | number | null> {
  return {
    id: pricing.id,
    provider: pricing.provider,
    model: pricing.model,
    serviceTier: pricing.serviceTier,
    processingRegion: pricing.processingRegion,
    inputMicrousdPerMillion: pricing.inputMicrousdPerMillion.toString(),
    cachedInputMicrousdPerMillion: pricing.cachedInputMicrousdPerMillion.toString(),
    cacheWriteMicrousdPerMillion: pricing.cacheWriteMicrousdPerMillion?.toString() ?? null,
    outputMicrousdPerMillion: pricing.outputMicrousdPerMillion.toString(),
    longContextThresholdTokens: pricing.longContextThresholdTokens,
    longInputMultiplierBps: pricing.longInputMultiplierBps,
    longOutputMultiplierBps: pricing.longOutputMultiplierBps,
    markupBps: pricing.markupBps,
    revision: pricing.revision,
    effectiveFrom: pricing.effectiveFrom.toISOString(),
    effectiveUntil: pricing.effectiveUntil?.toISOString() ?? null
  };
}

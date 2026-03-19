import type { GridPreviewComputationOutput } from "./previewComputation.js";

type MarginMode = "AUTO" | "MANUAL";

type GridPreviewValidation = {
  ready: boolean;
  severity: "ok" | "warning" | "blocked";
  codes: string[];
  blockingCodes: string[];
  warningCodes: string[];
  capital: {
    marginMode: MarginMode;
    autoMarginEnabled: boolean;
    splitMode: GridPreviewComputationOutput["allocation"]["splitMode"];
    policy: GridPreviewComputationOutput["allocation"]["policy"];
    totalBudgetUsd: number;
    gridInvestUsd: number;
    reserveUsd: number;
    reservePct: number;
    effectiveGridInvestUsd: number;
    effectiveGridSlots: number;
    capitalPerGridUsd: number;
    minInvestmentUSDT: number;
    minInvestmentBreakdown: GridPreviewComputationOutput["minInvestmentBreakdown"];
    minimumRecommendedBudgetUsd: number | null;
    gridBudgetShortfallUsd: number;
    recommendedBudgetShortfallUsd: number;
    initialSeedMarginUsd: number;
    initialSeedPct: number;
    targetLiqDistancePct: number | null;
    searchIterationsUsed: number;
  };
  safety: {
    leverage: number;
    leverageBand: string;
    rangeWidthPct: number | null;
    nearestBoundaryDistancePct: number | null;
    worstCaseLiqDistancePct: number | null;
    liqDistanceMinPct: number;
    liquidationBufferPct: number | null;
    liquidationStatus: string;
    autoMarginExpectation: string;
    venueConstraintStatus: "ok" | "fallback";
    venueFallbackUsed: boolean;
  };
};

const BLOCKING_CODES = new Set([
  "insufficient_budget",
  "grid_invest_below_minimum",
  "grid_invalid_venue_constraints",
  "liq_distance_below_threshold",
  "min_investment_above_current_invest",
]);

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function uniqueCodes(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const code = String(value ?? "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}

export function buildGridPreviewValidation(params: {
  computed: GridPreviewComputationOutput;
  marginMode: MarginMode;
  autoMarginEnabled: boolean;
  leverage: number;
}): GridPreviewValidation {
  const capitalSummary = ((params.computed.preview as any).capitalSummary ?? {}) as Record<string, unknown>;
  const safetySummary = ((params.computed.preview as any).safetySummary ?? {}) as Record<string, unknown>;
  const allocationBreakdown = ((params.computed.preview as any).allocationBreakdown ?? {}) as Record<string, unknown>;
  const venueChecks = ((params.computed.preview as any).venueChecks ?? {}) as Record<string, unknown>;

  const minLiqDistancePct = toNullableNumber(params.computed.preview.liqDistanceMinPct)
    ?? toNumber(safetySummary.liqDistanceMinPct, toNumber(params.computed.venueContext.liqDistanceMinPct));
  const worstCaseLiqDistancePct = toNullableNumber(params.computed.preview.worstCaseLiqDistancePct)
    ?? toNullableNumber(safetySummary.worstCaseLiqDistancePct);
  const liquidationBufferPct = worstCaseLiqDistancePct === null
    ? toNullableNumber(safetySummary.liquidationBufferPct)
    : roundMetric(worstCaseLiqDistancePct - minLiqDistancePct);
  const effectiveGridSlots = Math.max(
    0,
    Math.trunc(
      toNumber(capitalSummary.effectiveGridSlots, toNumber(params.computed.preview.effectiveGridSlots, 0))
    )
  );
  const effectiveGridInvestUsd = roundMoney(
    toNumber(
      allocationBreakdown.effectiveGridInvestUsd,
      toNumber(capitalSummary.effectiveGridInvestUsd, params.computed.allocation.gridInvestUsd)
    )
  );
  const minimumRecommendedBudgetUsd = toNullableNumber(capitalSummary.minimumRecommendedBudgetUsd);
  const reserveUsd = roundMoney(params.computed.allocation.extraMarginUsd);
  const totalBudgetUsd = roundMoney(params.computed.allocation.totalBudgetUsd);
  const reservePct = totalBudgetUsd > 0 ? roundMetric((reserveUsd / totalBudgetUsd) * 100) : 0;
  const gridBudgetShortfallUsd = roundMoney(Math.max(0, params.computed.minInvestmentUSDT - params.computed.allocation.gridInvestUsd));
  const recommendedBudgetShortfallUsd = roundMoney(Math.max(0, (minimumRecommendedBudgetUsd ?? 0) - totalBudgetUsd));
  const venueFallbackUsed = Boolean(venueChecks.fallbackUsed);
  const warningCodes = uniqueCodes([
    ...params.computed.warnings,
    ...(params.computed.preview.validationErrors ?? []),
    ...(params.computed.allocation.reasonCodes ?? []),
    venueFallbackUsed ? "constraints_missing_or_fallback_used" : null,
    liquidationBufferPct !== null && liquidationBufferPct < 2 ? "liquidation_buffer_low" : null,
    recommendedBudgetShortfallUsd > 0 ? "reserve_below_recommended" : null,
  ]);
  const blockingCodes = uniqueCodes([
    params.computed.allocation.insufficient ? "insufficient_budget" : null,
    gridBudgetShortfallUsd > 0 ? "grid_invest_below_minimum" : null,
    worstCaseLiqDistancePct !== null && worstCaseLiqDistancePct < minLiqDistancePct ? "liq_distance_below_threshold" : null,
    ...warningCodes.filter((code) => BLOCKING_CODES.has(code)),
  ]);
  const codes = uniqueCodes([...blockingCodes, ...warningCodes]);
  const severity = blockingCodes.length > 0 ? "blocked" : codes.length > 0 ? "warning" : "ok";

  return {
    ready: severity !== "blocked",
    severity,
    codes,
    blockingCodes,
    warningCodes: warningCodes.filter((code) => !blockingCodes.includes(code)),
    capital: {
      marginMode: params.marginMode,
      autoMarginEnabled: params.autoMarginEnabled,
      splitMode: params.computed.allocation.splitMode,
      policy: params.computed.allocation.policy,
      totalBudgetUsd,
      gridInvestUsd: roundMoney(params.computed.allocation.gridInvestUsd),
      reserveUsd,
      reservePct,
      effectiveGridInvestUsd,
      effectiveGridSlots,
      capitalPerGridUsd: roundMoney(
        toNumber(capitalSummary.capitalPerGridUsd, effectiveGridSlots > 0 ? effectiveGridInvestUsd / effectiveGridSlots : 0)
      ),
      minInvestmentUSDT: roundMoney(params.computed.minInvestmentUSDT),
      minInvestmentBreakdown: params.computed.minInvestmentBreakdown,
      minimumRecommendedBudgetUsd: minimumRecommendedBudgetUsd === null ? null : roundMoney(minimumRecommendedBudgetUsd),
      gridBudgetShortfallUsd,
      recommendedBudgetShortfallUsd,
      initialSeedMarginUsd: roundMoney(
        toNumber(capitalSummary.initialSeedMarginUsd, params.computed.initialSeed.seedMarginUsd)
      ),
      initialSeedPct: roundMetric(
        toNumber(capitalSummary.initialSeedPct, params.computed.initialSeed.seedPct)
      ),
      targetLiqDistancePct: params.computed.allocation.targetLiqDistancePct,
      searchIterationsUsed: params.computed.allocation.searchIterationsUsed,
    },
    safety: {
      leverage: roundMetric(params.leverage),
      leverageBand: String(safetySummary.leverageBand ?? "normal"),
      rangeWidthPct: toNullableNumber(safetySummary.rangeWidthPct),
      nearestBoundaryDistancePct: toNullableNumber(safetySummary.nearestBoundaryDistancePct),
      worstCaseLiqDistancePct,
      liqDistanceMinPct: roundMetric(minLiqDistancePct),
      liquidationBufferPct,
      liquidationStatus: String(safetySummary.liquidationStatus ?? (blockingCodes.includes("liq_distance_below_threshold") ? "blocked" : "ok")),
      autoMarginExpectation: String(safetySummary.autoMarginExpectation ?? "optional"),
      venueConstraintStatus: venueFallbackUsed ? "fallback" : "ok",
      venueFallbackUsed,
    },
  };
}

export function buildGridPreviewResponse(params: {
  computed: GridPreviewComputationOutput;
  marginMode: MarginMode;
  autoMarginEnabled: boolean;
  leverage: number;
  extras?: Record<string, unknown>;
}): Record<string, unknown> {
  const validation = buildGridPreviewValidation({
    computed: params.computed,
    marginMode: params.marginMode,
    autoMarginEnabled: params.autoMarginEnabled,
    leverage: params.leverage,
  });

  return {
    markPrice: params.computed.markPrice,
    marketDataVenue: params.computed.venueContext.marketDataVenue,
    minInvestmentUSDT: params.computed.minInvestmentUSDT,
    minInvestmentBreakdown: params.computed.minInvestmentBreakdown,
    initialSeed: params.computed.initialSeed,
    marginMode: params.marginMode,
    allocation: params.computed.allocation,
    allocationBreakdown: (params.computed.preview as any).allocationBreakdown ?? null,
    qtyModel: (params.computed.preview as any).qtyModel ?? null,
    venueChecks: (params.computed.preview as any).venueChecks ?? null,
    windowMeta: (params.computed.preview as any).windowMeta ?? null,
    capitalSummary: (params.computed.preview as any).capitalSummary ?? {},
    safetySummary: (params.computed.preview as any).safetySummary ?? {},
    profitPerGridEstimateUSDT: Number((params.computed.preview as any).profitPerGridEstimateUSDT ?? params.computed.preview.profitPerGridNetUsd ?? 0),
    liq: {
      liqEstimateLong: params.computed.preview.liqEstimateLong ?? null,
      liqEstimateShort: params.computed.preview.liqEstimateShort ?? null,
      worstCaseLiqPrice: params.computed.preview.worstCaseLiqPrice ?? null,
      worstCaseLiqDistancePct: validation.safety.worstCaseLiqDistancePct,
      liqDistanceMinPct: validation.safety.liqDistanceMinPct,
    },
    warnings: params.computed.warnings,
    status: {
      ready: validation.ready,
      codes: validation.codes,
    },
    validation,
    ...(params.extras ?? {}),
  };
}

export function buildGridMinimumInvestmentErrorResponse(params: {
  computed: GridPreviewComputationOutput;
  currentInvestUsd: number;
  symbol: string;
  marginMode: MarginMode;
  autoMarginEnabled: boolean;
  leverage: number;
}): Record<string, unknown> {
  const validation = buildGridPreviewValidation({
    computed: params.computed,
    marginMode: params.marginMode,
    autoMarginEnabled: params.autoMarginEnabled,
    leverage: params.leverage,
  });

  return {
    error: "grid_instance_invest_below_minimum",
    requiredMinInvestmentUSDT: params.computed.minInvestmentUSDT,
    minInvestmentBreakdown: params.computed.minInvestmentBreakdown,
    initialSeed: params.computed.initialSeed,
    currentInvestUsd: params.currentInvestUsd,
    symbol: params.symbol,
    markPrice: params.computed.markPrice,
    allocation: params.computed.allocation,
    windowMeta: (params.computed.preview as any).windowMeta ?? null,
    capitalSummary: (params.computed.preview as any).capitalSummary ?? {},
    safetySummary: (params.computed.preview as any).safetySummary ?? {},
    liq: {
      liqEstimateLong: params.computed.preview.liqEstimateLong ?? null,
      liqEstimateShort: params.computed.preview.liqEstimateShort ?? null,
      worstCaseLiqPrice: params.computed.preview.worstCaseLiqPrice ?? null,
      worstCaseLiqDistancePct: validation.safety.worstCaseLiqDistancePct,
      liqDistanceMinPct: validation.safety.liqDistanceMinPct,
    },
    warnings: params.computed.warnings,
    validation,
  };
}

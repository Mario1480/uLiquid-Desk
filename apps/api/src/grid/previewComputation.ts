import { requestGridPreview } from "./pythonGridClient.js";
import { computeAutoMarginAllocation, computeAutoReserveAllocationDynamic } from "./autoMargin.js";
import { ManualTradingError } from "../trading.js";

type GridCrossSide = {
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
};

type GridCrossSideConfig = {
  long: GridCrossSide;
  short: GridCrossSide;
};

type NormalizedPreviewTemplate = Record<string, unknown> & {
  mode?: string;
  symbol?: string;
  gridMode?: string;
  allocationMode?: string;
  budgetSplitPolicy?: string;
  autoReservePolicy?: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | string | null;
  autoReserveFixedGridPct?: number | null;
  autoReserveTargetLiqDistancePct?: number | null;
  autoReserveMaxPreviewIterations?: number | null;
  initialSeedEnabled?: boolean;
  initialSeedPct?: number;
  activeOrderWindowSize?: number;
  recenterDriftLevels?: number;
  longBudgetPct?: number;
  shortBudgetPct?: number;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  crossSideConfig: GridCrossSideConfig | null;
};

function normalizeCrossSideCandidate(
  side: unknown,
  fallback: { lowerPrice: number; upperPrice: number; gridCount: number }
): GridCrossSide {
  const record = side && typeof side === "object" && !Array.isArray(side)
    ? side as Record<string, unknown>
    : {};
  const lowerPrice = Number(record.lowerPrice);
  const upperPrice = Number(record.upperPrice);
  const gridCount = Math.trunc(Number(record.gridCount));
  const candidate = {
    lowerPrice: Number.isFinite(lowerPrice) && lowerPrice > 0 ? lowerPrice : fallback.lowerPrice,
    upperPrice: Number.isFinite(upperPrice) && upperPrice > 0 ? upperPrice : fallback.upperPrice,
    gridCount: Number.isFinite(gridCount) && gridCount >= 2 && gridCount <= 500 ? gridCount : fallback.gridCount,
  };
  if (candidate.upperPrice <= candidate.lowerPrice) {
    return fallback;
  }
  return candidate;
}

function normalizeTemplate(input: any): NormalizedPreviewTemplate {
  const template = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const mode = String(template.mode ?? "").trim();
  const lowerPrice = Number(template.lowerPrice);
  const upperPrice = Number(template.upperPrice);
  const gridCount = Math.trunc(Number(template.gridCount));
  const fallback = {
    lowerPrice,
    upperPrice,
    gridCount,
  };
  if (
    mode !== "cross"
    || !Number.isFinite(lowerPrice) || lowerPrice <= 0
    || !Number.isFinite(upperPrice) || upperPrice <= lowerPrice
    || !Number.isFinite(gridCount) || gridCount < 2 || gridCount > 500
  ) {
    return { ...template, crossSideConfig: null } as NormalizedPreviewTemplate;
  }
  const rawConfig = template.crossSideConfig && typeof template.crossSideConfig === "object" && !Array.isArray(template.crossSideConfig)
    ? template.crossSideConfig as Record<string, unknown>
    : {};
  const crossSideConfig = {
    long: normalizeCrossSideCandidate(rawConfig.long ?? {
      lowerPrice: template.crossLongLowerPrice,
      upperPrice: template.crossLongUpperPrice,
      gridCount: template.crossLongGridCount,
    }, fallback),
    short: normalizeCrossSideCandidate(rawConfig.short ?? {
      lowerPrice: template.crossShortLowerPrice,
      upperPrice: template.crossShortUpperPrice,
      gridCount: template.crossShortGridCount,
    }, fallback),
  };
  return {
    ...template,
    lowerPrice: Math.min(crossSideConfig.long.lowerPrice, crossSideConfig.short.lowerPrice),
    upperPrice: Math.max(crossSideConfig.long.upperPrice, crossSideConfig.short.upperPrice),
    gridCount: Math.max(crossSideConfig.long.gridCount, crossSideConfig.short.gridCount),
    crossSideConfig,
  } as NormalizedPreviewTemplate;
}

function toTwoDecimals(value: number): number {
  return Number(Number(value).toFixed(2));
}

function uniqueWarnings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const value of values) {
    const warning = String(value ?? "").trim();
    if (!warning || seen.has(warning)) continue;
    seen.add(warning);
    warnings.push(warning);
  }
  return warnings;
}

function readNullablePositiveNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ManualTradingError(`invalid grid venue constraint: ${field}`, 400, "grid_invalid_venue_constraints");
  }
  return parsed;
}

function readNullableNonNegativeNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ManualTradingError(`invalid grid venue constraint: ${field}`, 400, "grid_invalid_venue_constraints");
  }
  return parsed;
}

function readBoundedNonNegativeNumber(value: unknown, field: string, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new ManualTradingError(`invalid grid venue constraint: ${field}`, 400, "grid_invalid_venue_constraints");
  }
  return parsed;
}

function normalizeVenueContext(
  input: Awaited<ReturnType<GridPreviewComputationInput["resolveVenueContext"]>>
): Awaited<ReturnType<GridPreviewComputationInput["resolveVenueContext"]>> {
  return {
    ...input,
    marketDataVenue: String(input.marketDataVenue ?? "").trim().toLowerCase(),
    venueConstraints: {
      minQty: readNullablePositiveNumber(input.venueConstraints?.minQty, "minQty"),
      qtyStep: readNullablePositiveNumber(input.venueConstraints?.qtyStep, "qtyStep"),
      priceTick: readNullablePositiveNumber(input.venueConstraints?.priceTick, "priceTick"),
      minNotional: readNullablePositiveNumber(input.venueConstraints?.minNotional, "minNotional"),
      feeRate: readNullableNonNegativeNumber(input.venueConstraints?.feeRate, "feeRate"),
    },
    feeBufferPct: readBoundedNonNegativeNumber(input.feeBufferPct, "feeBufferPct", 25),
    mmrPct: readBoundedNonNegativeNumber(input.mmrPct, "mmrPct", 50),
    liqDistanceMinPct: readBoundedNonNegativeNumber(input.liqDistanceMinPct, "liqDistanceMinPct", 100),
    warnings: uniqueWarnings(input.warnings ?? []),
  };
}

export function resolvePositiveMarkPrice(params: {
  override?: number | null;
  venueMarkPrice: number;
  lowerPrice: number;
  upperPrice: number;
}): number {
  const raw = Number.isFinite(Number(params.override)) && Number(params.override) > 0
    ? Number(params.override)
    : Number(params.venueMarkPrice);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const lower = Number(params.lowerPrice);
  const upper = Number(params.upperPrice);
  if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
    return Number(((lower + upper) / 2).toFixed(8));
  }
  if (Number.isFinite(lower) && lower > 0) return lower;
  if (Number.isFinite(upper) && upper > 0) return upper;
  return 1;
}

export type GridPreviewComputationInput = {
  userId: string;
  exchangeAccountId: string;
  template: any;
  autoReservePolicy?: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
  autoReserveFixedGridPct?: number | null;
  autoReserveTargetLiqDistancePct?: number | null;
  autoReserveMaxPreviewIterations?: number | null;
  activeOrderWindowSize?: number | null;
  recenterDriftLevels?: number | null;
  investUsd: number;
  extraMarginUsd: number;
  autoMarginEnabled: boolean;
  tpPct: number | null;
  slPrice: number | null;
  triggerPrice: number | null;
  markPriceOverride?: number | null;
  leverage: number;
  slippagePct: number;
  resolveVenueContext: (params: {
    userId: string;
    exchangeAccountId: string;
    symbol: string;
  }) => Promise<{
    markPrice: number;
    marketDataVenue: string;
    venueConstraints: {
      minQty: number | null;
      qtyStep: number | null;
      priceTick: number | null;
      minNotional: number | null;
      feeRate: number | null;
    };
    feeBufferPct: number;
    mmrPct: number;
    liqDistanceMinPct: number;
    warnings: string[];
  }>;
};

export type GridPreviewComputationOutput = {
  markPrice: number;
  minInvestmentUSDT: number;
  preview: Awaited<ReturnType<typeof requestGridPreview>>;
  warnings: string[];
  minInvestmentBreakdown: {
    long: number;
    short: number;
    seed: number;
    total: number;
  };
  initialSeed: {
    enabled: boolean;
    seedPct: number;
    seedSide: "buy" | "sell" | null;
    seedQty: number;
    seedNotionalUsd: number;
    seedMarginUsd: number;
    seedMinMarginUsd: number;
  };
  allocation: {
    totalBudgetUsd: number;
    gridInvestUsd: number;
    extraMarginUsd: number;
    splitMode: "manual" | "auto_fixed_ratio" | "auto_liq_guard_dynamic";
    policy: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
    targetLiqDistancePct: number | null;
    searchIterationsUsed: number;
    insufficient: boolean;
    reasonCodes: string[];
  };
  venueContext: Awaited<ReturnType<GridPreviewComputationInput["resolveVenueContext"]>>;
};

export async function computeGridPreviewAndAllocation(
  input: GridPreviewComputationInput
): Promise<GridPreviewComputationOutput> {
  const template = normalizeTemplate(input.template);
  const allocationMode = String(template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(template.budgetSplitPolicy ?? "FIXED_50_50");
  const longBudgetPct = Number.isFinite(Number(template.longBudgetPct)) ? Number(template.longBudgetPct) : 50;
  const shortBudgetPct = Number.isFinite(Number(template.shortBudgetPct)) ? Number(template.shortBudgetPct) : 50;
  const autoReservePolicy = (String(
    input.autoReservePolicy ?? template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"
  ) === "FIXED_RATIO" ? "FIXED_RATIO" : "LIQ_GUARD_MAX_GRID") as "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
  const autoReserveFixedGridPct = Number.isFinite(Number(input.autoReserveFixedGridPct ?? template.autoReserveFixedGridPct))
    ? Number(input.autoReserveFixedGridPct ?? template.autoReserveFixedGridPct)
    : 70;
  const autoReserveMaxPreviewIterations = Number.isFinite(Number(input.autoReserveMaxPreviewIterations ?? template.autoReserveMaxPreviewIterations))
    ? Math.max(1, Math.min(16, Math.trunc(Number(input.autoReserveMaxPreviewIterations ?? template.autoReserveMaxPreviewIterations))))
    : 8;
  const initialSeedEnabled = typeof template.initialSeedEnabled === "boolean"
    ? Boolean(template.initialSeedEnabled)
    : true;
  const initialSeedPct = Number.isFinite(Number(template.initialSeedPct))
    ? Math.max(0, Math.min(60, Number(template.initialSeedPct)))
    : 30;
  const activeOrderWindowSize = Number.isFinite(Number(input.activeOrderWindowSize ?? template.activeOrderWindowSize))
    ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize ?? template.activeOrderWindowSize))))
    : 100;
  const recenterDriftLevels = Number.isFinite(Number(input.recenterDriftLevels ?? template.recenterDriftLevels))
    ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels ?? template.recenterDriftLevels))))
    : 1;

  const venueContext = normalizeVenueContext(await input.resolveVenueContext({
    userId: input.userId,
    exchangeAccountId: input.exchangeAccountId,
    symbol: String(template.symbol ?? "")
  }));
  const effectiveMarkPrice = resolvePositiveMarkPrice({
    override: input.markPriceOverride,
    venueMarkPrice: Number(venueContext.markPrice),
    lowerPrice: Number(template.lowerPrice),
    upperPrice: Number(template.upperPrice)
  });

  const totalBudgetUsd = input.autoMarginEnabled
    ? toTwoDecimals(input.investUsd)
    : toTwoDecimals(input.investUsd + input.extraMarginUsd);
  const targetLiqDistancePct = Number.isFinite(Number(input.autoReserveTargetLiqDistancePct ?? template.autoReserveTargetLiqDistancePct))
    ? Number(input.autoReserveTargetLiqDistancePct ?? template.autoReserveTargetLiqDistancePct)
    : Number(venueContext.liqDistanceMinPct);

  const runPreview = (gridInvestUsd: number, extraMarginUsd: number) =>
    requestGridPreview({
      mode: String(template.mode),
      gridMode: String(template.gridMode),
      lowerPrice: Number(template.lowerPrice),
      upperPrice: Number(template.upperPrice),
      gridCount: Math.trunc(Number(template.gridCount)),
      crossSideConfig: template.crossSideConfig ?? null,
      activeOrderWindowSize,
      recenterDriftLevels,
      investUsd: gridInvestUsd,
      leverage: input.leverage,
      markPrice: effectiveMarkPrice,
      slippagePct: input.slippagePct,
      tpPct: input.tpPct,
      slPrice: input.slPrice,
      triggerPrice: input.triggerPrice,
      trailingEnabled: false,
      allocationMode,
      budgetSplitPolicy,
      longBudgetPct,
      shortBudgetPct,
      venueConstraints: venueContext.venueConstraints,
      feeBufferPct: venueContext.feeBufferPct,
      mmrPct: venueContext.mmrPct,
      extraMarginUsd,
      initialSeedEnabled,
      initialSeedPct
    });

  const firstPassPreview = await runPreview(
    input.autoMarginEnabled ? totalBudgetUsd : input.investUsd,
    input.autoMarginEnabled ? 0 : input.extraMarginUsd
  );

  const minInvestmentUSDT = Number(firstPassPreview.minInvestmentUSDT ?? 0);
  let allocation: GridPreviewComputationOutput["allocation"] = {
    totalBudgetUsd,
    gridInvestUsd: toTwoDecimals(input.investUsd),
    extraMarginUsd: toTwoDecimals(input.extraMarginUsd),
    splitMode: "manual",
    policy: null,
    targetLiqDistancePct: null,
    searchIterationsUsed: 0,
    insufficient: false,
    reasonCodes: []
  };

  if (input.autoMarginEnabled) {
    if (autoReservePolicy === "FIXED_RATIO") {
      const split = computeAutoMarginAllocation({
        totalBudgetUsd,
        minInvestmentUSDT,
        ratioGrid: autoReserveFixedGridPct / 100
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_fixed_ratio",
        policy: "FIXED_RATIO",
        targetLiqDistancePct: null,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    } else {
      const split = await computeAutoReserveAllocationDynamic({
        totalBudgetUsd,
        minInvestmentUSDT,
        targetLiqDistancePct,
        maxIterations: autoReserveMaxPreviewIterations,
        evaluateGridInvestment: async (gridInvestUsd) => {
          const preview = await runPreview(gridInvestUsd, toTwoDecimals(totalBudgetUsd - gridInvestUsd));
          return {
            worstCaseLiqDistancePct: preview.worstCaseLiqDistancePct
          };
        }
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_liq_guard_dynamic",
        policy: "LIQ_GUARD_MAX_GRID",
        targetLiqDistancePct: split.targetLiqDistancePct,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    }
  }

  const finalPreview = await runPreview(allocation.gridInvestUsd, allocation.extraMarginUsd);

  return {
    markPrice: effectiveMarkPrice,
    minInvestmentUSDT,
    preview: finalPreview,
    warnings: uniqueWarnings([...(finalPreview.warnings ?? []), ...(venueContext.warnings ?? [])]),
    minInvestmentBreakdown: {
      long: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.long)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.long) : 0,
      short: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.short)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.short) : 0,
      seed: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.seed)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.seed) : 0,
      total: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.total)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.total) : minInvestmentUSDT
    },
    initialSeed: {
      enabled: Boolean((finalPreview as any)?.initialSeed?.enabled),
      seedPct: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedPct)) ? Number((finalPreview as any)?.initialSeed?.seedPct) : 0,
      seedSide: (String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "sell"
        ? "sell"
        : String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "buy"
          ? "buy"
          : null) as "buy" | "sell" | null,
      seedQty: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedQty)) ? Number((finalPreview as any)?.initialSeed?.seedQty) : 0,
      seedNotionalUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedNotionalUsd)) ? Number((finalPreview as any)?.initialSeed?.seedNotionalUsd) : 0,
      seedMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMarginUsd) : 0,
      seedMinMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd) : 0
    },
    allocation,
    venueContext
  };
}

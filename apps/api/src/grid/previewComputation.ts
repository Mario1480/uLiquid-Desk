import { requestGridPreview } from "./pythonGridClient.js";
import { computeAutoMarginAllocation, computeAutoReserveAllocationDynamic } from "./autoMargin.js";

function toTwoDecimals(value: number): number {
  return Number(Number(value).toFixed(2));
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
  const allocationMode = String(input.template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(input.template.budgetSplitPolicy ?? "FIXED_50_50");
  const longBudgetPct = Number.isFinite(Number(input.template.longBudgetPct)) ? Number(input.template.longBudgetPct) : 50;
  const shortBudgetPct = Number.isFinite(Number(input.template.shortBudgetPct)) ? Number(input.template.shortBudgetPct) : 50;
  const autoReservePolicy = (String(
    input.autoReservePolicy ?? input.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"
  ) === "FIXED_RATIO" ? "FIXED_RATIO" : "LIQ_GUARD_MAX_GRID") as "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
  const autoReserveFixedGridPct = Number.isFinite(Number(input.autoReserveFixedGridPct ?? input.template.autoReserveFixedGridPct))
    ? Number(input.autoReserveFixedGridPct ?? input.template.autoReserveFixedGridPct)
    : 70;
  const autoReserveMaxPreviewIterations = Number.isFinite(Number(input.autoReserveMaxPreviewIterations ?? input.template.autoReserveMaxPreviewIterations))
    ? Math.max(1, Math.min(16, Math.trunc(Number(input.autoReserveMaxPreviewIterations ?? input.template.autoReserveMaxPreviewIterations))))
    : 8;
  const initialSeedEnabled = typeof input.template.initialSeedEnabled === "boolean"
    ? Boolean(input.template.initialSeedEnabled)
    : true;
  const initialSeedPct = Number.isFinite(Number(input.template.initialSeedPct))
    ? Math.max(0, Math.min(60, Number(input.template.initialSeedPct)))
    : 30;
  const activeOrderWindowSize = Number.isFinite(Number(input.activeOrderWindowSize ?? input.template.activeOrderWindowSize))
    ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize ?? input.template.activeOrderWindowSize))))
    : 100;
  const recenterDriftLevels = Number.isFinite(Number(input.recenterDriftLevels ?? input.template.recenterDriftLevels))
    ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels ?? input.template.recenterDriftLevels))))
    : 1;

  const venueContext = await input.resolveVenueContext({
    userId: input.userId,
    exchangeAccountId: input.exchangeAccountId,
    symbol: input.template.symbol
  });
  const effectiveMarkPrice = resolvePositiveMarkPrice({
    override: input.markPriceOverride,
    venueMarkPrice: Number(venueContext.markPrice),
    lowerPrice: input.template.lowerPrice,
    upperPrice: input.template.upperPrice
  });

  const totalBudgetUsd = input.autoMarginEnabled
    ? toTwoDecimals(input.investUsd)
    : toTwoDecimals(input.investUsd + input.extraMarginUsd);
  const targetLiqDistancePct = Number.isFinite(Number(input.autoReserveTargetLiqDistancePct ?? input.template.autoReserveTargetLiqDistancePct))
    ? Number(input.autoReserveTargetLiqDistancePct ?? input.template.autoReserveTargetLiqDistancePct)
    : Number(venueContext.liqDistanceMinPct);

  const runPreview = (gridInvestUsd: number, extraMarginUsd: number) =>
    requestGridPreview({
      mode: input.template.mode,
      gridMode: input.template.gridMode,
      lowerPrice: input.template.lowerPrice,
      upperPrice: input.template.upperPrice,
      gridCount: input.template.gridCount,
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
    warnings: [...(finalPreview.warnings ?? []), ...(venueContext.warnings ?? [])],
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

export type AutoMarginAllocationInput = {
  totalBudgetUsd: number;
  minInvestmentUSDT: number;
  ratioGrid?: number;
};

export type AutoMarginAllocationResult = {
  gridInvestUsd: number;
  extraMarginUsd: number;
  insufficient: boolean;
  reasonCodes: string[];
  searchIterationsUsed: number;
};

export type AutoReserveDynamicInput = {
  totalBudgetUsd: number;
  minInvestmentUSDT: number;
  targetLiqDistancePct: number;
  maxIterations?: number;
  evaluateGridInvestment: (gridInvestUsd: number) => Promise<{
    worstCaseLiqDistancePct: number | null | undefined;
  }>;
};

export type AutoReserveDynamicResult = AutoMarginAllocationResult & {
  targetLiqDistancePct: number;
};

function toMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function finalizeAllocation(totalBudgetUsdRaw: number, gridInvestUsdRaw: number): Pick<AutoMarginAllocationResult, "gridInvestUsd" | "extraMarginUsd"> {
  const totalBudgetUsd = Math.max(0, toMoney(Number(totalBudgetUsdRaw ?? 0)));
  let gridInvestUsd = Math.max(0, Math.min(totalBudgetUsd, toMoney(Number(gridInvestUsdRaw ?? 0))));
  let extraMarginUsd = toMoney(totalBudgetUsd - gridInvestUsd);

  const sum = toMoney(gridInvestUsd + extraMarginUsd);
  const delta = toMoney(totalBudgetUsd - sum);
  if (Math.abs(delta) >= 0.01) {
    extraMarginUsd = toMoney(extraMarginUsd + delta);
    if (extraMarginUsd < 0) {
      gridInvestUsd = toMoney(gridInvestUsd + extraMarginUsd);
      extraMarginUsd = 0;
    }
  }

  return {
    gridInvestUsd: toMoney(gridInvestUsd),
    extraMarginUsd: toMoney(extraMarginUsd)
  };
}

export function computeAutoMarginAllocation(input: AutoMarginAllocationInput): AutoMarginAllocationResult {
  const ratioGridRaw = Number.isFinite(Number(input.ratioGrid)) ? Number(input.ratioGrid) : 0.7;
  const ratioGrid = Math.min(1, Math.max(0, ratioGridRaw));
  const totalBudgetUsd = Math.max(0, toMoney(Number(input.totalBudgetUsd ?? 0)));
  const minInvestmentUSDT = Math.max(0, toMoney(Number(input.minInvestmentUSDT ?? 0)));
  const reasonCodes: string[] = [];

  const baseGrid = totalBudgetUsd * ratioGrid;
  let gridInvestUsd = Math.max(baseGrid, minInvestmentUSDT);
  let extraMarginUsd = totalBudgetUsd - gridInvestUsd;

  if (gridInvestUsd - totalBudgetUsd > 1e-9) {
    return {
      ...finalizeAllocation(totalBudgetUsd, totalBudgetUsd),
      insufficient: true,
      reasonCodes: ["min_investment_above_total_budget"],
      searchIterationsUsed: 0
    };
  }
  const finalized = finalizeAllocation(totalBudgetUsd, gridInvestUsd);
  gridInvestUsd = finalized.gridInvestUsd;
  extraMarginUsd = finalized.extraMarginUsd;

  if (gridInvestUsd > baseGrid + 1e-9) reasonCodes.push("min_investment_floor_applied");
  if (extraMarginUsd <= 0) reasonCodes.push("extra_margin_zero_after_floor");

  return {
    gridInvestUsd,
    extraMarginUsd,
    insufficient: false,
    reasonCodes,
    searchIterationsUsed: 0
  };
}

export async function computeAutoReserveAllocationDynamic(input: AutoReserveDynamicInput): Promise<AutoReserveDynamicResult> {
  const totalBudgetUsd = Math.max(0, toMoney(Number(input.totalBudgetUsd ?? 0)));
  const minInvestmentUSDT = Math.max(0, toMoney(Number(input.minInvestmentUSDT ?? 0)));
  const targetLiqDistancePct = Math.max(0, Number(input.targetLiqDistancePct ?? 0));
  const maxIterations = Math.max(1, Math.min(16, Math.trunc(Number(input.maxIterations ?? 8))));
  const reasonCodes: string[] = [];
  let searchIterationsUsed = 0;

  if (minInvestmentUSDT - totalBudgetUsd > 1e-9) {
    return {
      ...finalizeAllocation(totalBudgetUsd, totalBudgetUsd),
      insufficient: true,
      reasonCodes: ["min_investment_above_total_budget"],
      searchIterationsUsed,
      targetLiqDistancePct
    };
  }

  const low = minInvestmentUSDT;
  const high = totalBudgetUsd;
  const distancePasses = (distance: number | null | undefined): boolean =>
    Number.isFinite(Number(distance)) && Number(distance) >= targetLiqDistancePct;

  const lowEval = await input.evaluateGridInvestment(low);
  searchIterationsUsed += 1;
  const lowDistance = Number.isFinite(Number(lowEval.worstCaseLiqDistancePct))
    ? Number(lowEval.worstCaseLiqDistancePct)
    : null;

  if (!distancePasses(lowDistance)) {
    reasonCodes.push("liq_target_unreachable_at_min_grid");
    if (lowDistance == null) reasonCodes.push("liq_distance_unavailable_at_min_grid");
    const finalized = finalizeAllocation(totalBudgetUsd, low);
    if (finalized.extraMarginUsd <= 0) reasonCodes.push("extra_margin_zero_after_floor");
    return {
      ...finalized,
      insufficient: false,
      reasonCodes,
      searchIterationsUsed,
      targetLiqDistancePct
    };
  }

  const highEval = await input.evaluateGridInvestment(high);
  searchIterationsUsed += 1;
  const highDistance = Number.isFinite(Number(highEval.worstCaseLiqDistancePct))
    ? Number(highEval.worstCaseLiqDistancePct)
    : null;

  if (distancePasses(highDistance)) {
    reasonCodes.push("liq_target_satisfied_with_max_grid");
    const finalized = finalizeAllocation(totalBudgetUsd, high);
    if (finalized.extraMarginUsd <= 0) reasonCodes.push("extra_margin_zero_after_floor");
    return {
      ...finalized,
      insufficient: false,
      reasonCodes,
      searchIterationsUsed,
      targetLiqDistancePct
    };
  }

  let left = low;
  let right = high;
  let best = low;

  for (let i = 0; i < maxIterations; i += 1) {
    if (right - left < 0.01) break;
    const mid = toMoney((left + right) / 2);
    if (mid <= left || mid >= right) break;
    const midEval = await input.evaluateGridInvestment(mid);
    searchIterationsUsed += 1;
    const midDistance = Number.isFinite(Number(midEval.worstCaseLiqDistancePct))
      ? Number(midEval.worstCaseLiqDistancePct)
      : null;
    if (distancePasses(midDistance)) {
      best = mid;
      left = mid;
    } else {
      right = mid;
    }
  }

  reasonCodes.push("liq_guard_applied");
  const finalized = finalizeAllocation(totalBudgetUsd, best);
  if (finalized.gridInvestUsd - minInvestmentUSDT > 1e-9) reasonCodes.push("liq_target_limited_grid_allocation");
  if (finalized.extraMarginUsd <= 0) reasonCodes.push("extra_margin_zero_after_floor");
  return {
    ...finalized,
    insufficient: false,
    reasonCodes,
    searchIterationsUsed,
    targetLiqDistancePct
  };
}

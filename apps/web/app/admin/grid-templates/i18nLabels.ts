type TranslateFn = (key: string) => string;

const MODE_KEYS: Record<string, string> = {
  long: "enums.mode.long",
  short: "enums.mode.short",
  neutral: "enums.mode.neutral",
  cross: "enums.mode.cross"
};

const GRID_MODE_KEYS: Record<string, string> = {
  arithmetic: "enums.gridMode.arithmetic",
  geometric: "enums.gridMode.geometric"
};

const ALLOCATION_MODE_KEYS: Record<string, string> = {
  EQUAL_NOTIONAL_PER_GRID: "enums.allocationMode.EQUAL_NOTIONAL_PER_GRID",
  EQUAL_BASE_QTY_PER_GRID: "enums.allocationMode.EQUAL_BASE_QTY_PER_GRID",
  WEIGHTED_NEAR_PRICE: "enums.allocationMode.WEIGHTED_NEAR_PRICE"
};

const BUDGET_SPLIT_POLICY_KEYS: Record<string, string> = {
  FIXED_50_50: "enums.budgetSplitPolicy.FIXED_50_50",
  FIXED_CUSTOM: "enums.budgetSplitPolicy.FIXED_CUSTOM",
  DYNAMIC_BY_PRICE_POSITION: "enums.budgetSplitPolicy.DYNAMIC_BY_PRICE_POSITION"
};

const MARGIN_POLICY_KEYS: Record<string, string> = {
  MANUAL_ONLY: "enums.marginPolicy.MANUAL_ONLY",
  AUTO_ALLOWED: "enums.marginPolicy.AUTO_ALLOWED"
};

const AUTO_RESERVE_POLICY_KEYS: Record<string, string> = {
  FIXED_RATIO: "enums.autoReservePolicy.FIXED_RATIO",
  LIQ_GUARD_MAX_GRID: "enums.autoReservePolicy.LIQ_GUARD_MAX_GRID"
};

const TRIGGER_TYPE_KEYS: Record<string, string> = {
  LIQ_DISTANCE_PCT_BELOW: "enums.triggerType.LIQ_DISTANCE_PCT_BELOW",
  MARGIN_RATIO_ABOVE: "enums.triggerType.MARGIN_RATIO_ABOVE"
};

const SPLIT_MODE_KEYS: Record<string, string> = {
  manual: "enums.splitMode.manual",
  auto_fixed_ratio: "enums.splitMode.auto_fixed_ratio",
  auto_liq_guard_dynamic: "enums.splitMode.auto_liq_guard_dynamic"
};

function mapLabel(value: string | null | undefined, t: TranslateFn, mapping: Record<string, string>): string {
  if (!value) return "n/a";
  const key = mapping[value];
  return key ? t(key) : value;
}

export function labelFromMode(mode: string | null | undefined, t: TranslateFn): string {
  return mapLabel(mode, t, MODE_KEYS);
}

export function labelFromGridMode(gridMode: string | null | undefined, t: TranslateFn): string {
  return mapLabel(gridMode, t, GRID_MODE_KEYS);
}

export function labelFromAllocationMode(allocationMode: string | null | undefined, t: TranslateFn): string {
  return mapLabel(allocationMode, t, ALLOCATION_MODE_KEYS);
}

export function labelFromBudgetSplitPolicy(policy: string | null | undefined, t: TranslateFn): string {
  return mapLabel(policy, t, BUDGET_SPLIT_POLICY_KEYS);
}

export function labelFromMarginPolicy(policy: string | null | undefined, t: TranslateFn): string {
  return mapLabel(policy, t, MARGIN_POLICY_KEYS);
}

export function labelFromAutoReservePolicy(policy: string | null | undefined, t: TranslateFn): string {
  return mapLabel(policy, t, AUTO_RESERVE_POLICY_KEYS);
}

export function labelFromTriggerType(triggerType: string | null | undefined, t: TranslateFn): string {
  return mapLabel(triggerType, t, TRIGGER_TYPE_KEYS);
}

export function labelFromSplitMode(splitMode: string | null | undefined, t: TranslateFn): string {
  return mapLabel(splitMode, t, SPLIT_MODE_KEYS);
}

export function labelFromReasonCode(code: string | null | undefined, t: TranslateFn): string {
  if (!code) return "n/a";
  const reasonKey = `reasonCodes.${code}`;
  // Use explicit known map by checking if code appears in the static table.
  // If not known, return raw code for forward compatibility.
  const knownCodes = new Set<string>([
    "min_investment_above_total_budget",
    "min_investment_floor_applied",
    "extra_margin_zero_after_floor",
    "liq_target_unreachable_at_min_grid",
    "liq_distance_unavailable_at_min_grid",
    "liq_target_satisfied_with_max_grid",
    "liq_guard_applied",
    "liq_target_limited_grid_allocation",
    "insufficient_budget",
    "liq_distance_below_threshold",
    "mark_outside_grid_range",
    "net_grid_profit_non_positive",
    "constraints_missing_or_fallback_used",
    "min_investment_above_current_invest",
    "split_ignored_for_mode",
    "neutral_full_budget_mode"
  ]);
  return knownCodes.has(code) ? t(reasonKey) : code;
}

export function toneFromReasonCode(code: string | null | undefined): "risk" | "warn" | "info" | "neutral" {
  if (!code) return "neutral";
  const riskCodes = new Set<string>([
    "insufficient_budget",
    "liq_distance_below_threshold",
    "min_investment_above_total_budget",
    "min_investment_above_current_invest"
  ]);
  const warnCodes = new Set<string>([
    "mark_outside_grid_range",
    "net_grid_profit_non_positive",
    "constraints_missing_or_fallback_used",
    "liq_target_unreachable_at_min_grid",
    "liq_distance_unavailable_at_min_grid",
    "liq_target_limited_grid_allocation"
  ]);
  const infoCodes = new Set<string>([
    "min_investment_floor_applied",
    "extra_margin_zero_after_floor",
    "liq_target_satisfied_with_max_grid",
    "liq_guard_applied",
    "split_ignored_for_mode",
    "neutral_full_budget_mode"
  ]);
  if (riskCodes.has(code)) return "risk";
  if (warnCodes.has(code)) return "warn";
  if (infoCodes.has(code)) return "info";
  return "neutral";
}

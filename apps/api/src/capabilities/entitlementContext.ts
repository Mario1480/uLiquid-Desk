import {
  normalizePlanTier,
  type PlanCapabilities,
  type PlanTier
} from "@mm/core";

export type CommercialBillingPlan = "free" | "pro" | "premium";

export type ResolvedEntitlementContext<TQuotas = unknown, TUsage = unknown> = {
  commercialPlan: CommercialBillingPlan;
  capabilityPlan: PlanTier;
  enterpriseOverride: boolean;
  capabilities: PlanCapabilities;
  capabilitySnapshot: unknown;
  quotas: TQuotas;
  usage: TUsage;
};

export function normalizeCommercialBillingPlan(value: unknown): CommercialBillingPlan {
  if (value === "premium") return "premium";
  if (value === "pro") return "pro";
  return "free";
}

/**
 * Billing owns the commercial Free/Pro/Premium plan. The strategy license may
 * only retain an explicit Enterprise tier; strategy grants and credit balances
 * must not promote a commercial plan.
 */
export function resolveBillingAuthoritativeCapabilityPlan(params: {
  billingPlan: unknown;
  strategyPlan: unknown;
}): PlanTier {
  if (params.strategyPlan === "enterprise") return "enterprise";
  return normalizePlanTier(normalizeCommercialBillingPlan(params.billingPlan));
}

export function createResolvedEntitlementContext<TQuotas, TUsage>(params: {
  billingPlan: unknown;
  strategyPlan: unknown;
  capabilities: PlanCapabilities;
  capabilitySnapshot?: unknown;
  quotas: TQuotas;
  usage: TUsage;
}): ResolvedEntitlementContext<TQuotas, TUsage> {
  const commercialPlan = normalizeCommercialBillingPlan(params.billingPlan);
  const capabilityPlan = resolveBillingAuthoritativeCapabilityPlan({
    billingPlan: commercialPlan,
    strategyPlan: params.strategyPlan
  });
  return {
    commercialPlan,
    capabilityPlan,
    enterpriseOverride: capabilityPlan === "enterprise",
    capabilities: params.capabilities,
    capabilitySnapshot: params.capabilitySnapshot ?? null,
    quotas: params.quotas,
    usage: params.usage
  };
}

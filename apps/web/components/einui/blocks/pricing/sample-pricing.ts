/** Gallery fixtures only. Never use these values for checkout or entitlement decisions. */
export type PricingPlan = { plan: "free" | "pro" | "premium"; code: string; name: string; priceCents: number };
export const pricingCatalogSnapshot: {plans: PricingPlan[]} = { plans: [
  { plan: "free", code: "demo-free", name: "Demo Free", priceCents: 0 },
  { plan: "pro", code: "demo-pro", name: "Demo Pro", priceCents: 1000 },
  { plan: "premium", code: "demo-premium", name: "Demo Premium", priceCents: 2000 }
] };
export const formatUsdc = (cents: number) => (cents / 100).toFixed(2);
const copy = { description: "Illustrative local sample, not a commercial offer.", features: (_plan: PricingPlan) => ["Local preview", "No payment action", "Sample capacity"] };
export const planCopy = {free: copy, pro: copy, premium: copy};

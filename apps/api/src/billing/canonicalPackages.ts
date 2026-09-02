export type CanonicalBillingPackage = {
  code: string;
  name: string;
  description: string;
  kind: "PLAN" | "ADDON";
  addonType: "RUNNING_BOTS" | "RUNNING_PREDICTIONS_AI" | "RUNNING_PREDICTIONS_COMPOSITE" | "AI_CREDITS" | null;
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  billingMonths: number;
  plan: "FREE" | "PRO" | "PREMIUM" | null;
  maxExchangeAccounts: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: bigint;
  aiCredits: bigint;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
  meta: Record<string, unknown> | null;
};

const plan = (input: Omit<CanonicalBillingPackage, "kind" | "addonType" | "billingMonths" | "allowedExchanges" | "aiCredits" | "deltaRunningBots" | "deltaRunningPredictionsAi" | "deltaRunningPredictionsComposite" | "meta">): CanonicalBillingPackage => ({
  ...input,
  kind: "PLAN",
  addonType: null,
  billingMonths: 1,
  allowedExchanges: ["*"],
  aiCredits: 0n,
  deltaRunningBots: null,
  deltaRunningPredictionsAi: null,
  deltaRunningPredictionsComposite: null,
  meta: null
});

const addon = (input: Omit<CanonicalBillingPackage, "kind" | "billingMonths" | "plan" | "maxExchangeAccounts" | "maxRunningBots" | "maxRunningPredictionsAi" | "maxRunningPredictionsComposite" | "allowedExchanges" | "monthlyAiCredits">): CanonicalBillingPackage => ({
  ...input,
  kind: "ADDON",
  billingMonths: 1,
  plan: null,
  maxExchangeAccounts: null,
  maxRunningBots: null,
  maxRunningPredictionsAi: null,
  maxRunningPredictionsComposite: null,
  allowedExchanges: ["*"],
  monthlyAiCredits: 0n
});

export const CANONICAL_STAGE4_PACKAGES: readonly CanonicalBillingPackage[] = [
  plan({
    code: "free",
    name: "Free",
    description: "Starter plan",
    isActive: true,
    sortOrder: 0,
    priceCents: 0,
    plan: "FREE",
    maxExchangeAccounts: 1,
    maxRunningBots: 1,
    maxRunningPredictionsAi: 0,
    maxRunningPredictionsComposite: 0,
    monthlyAiCredits: 0n
  }),
  plan({
    code: "pro_monthly",
    name: "Pro Monthly",
    description: "Monthly Pro subscription",
    isActive: true,
    sortOrder: 10,
    priceCents: 2_900,
    plan: "PRO",
    maxExchangeAccounts: 5,
    maxRunningBots: 3,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2,
    monthlyAiCredits: 10_000n
  }),
  plan({
    code: "premium_monthly",
    name: "Premium Monthly",
    description: "Monthly Premium subscription",
    isActive: true,
    sortOrder: 11,
    priceCents: 6_900,
    plan: "PREMIUM",
    maxExchangeAccounts: 15,
    maxRunningBots: 10,
    maxRunningPredictionsAi: 10,
    maxRunningPredictionsComposite: 5,
    monthlyAiCredits: 30_000n
  }),
  addon({
    code: "capacity_topup_bots_unit",
    name: "Capacity Topup Bots Unit",
    description: "Adds bot capacity until plan end",
    addonType: "RUNNING_BOTS",
    isActive: true,
    sortOrder: 31,
    priceCents: 500,
    aiCredits: 0n,
    deltaRunningBots: 1,
    deltaRunningPredictionsAi: 0,
    deltaRunningPredictionsComposite: 0,
    meta: { billingAddonType: "running_bots" }
  }),
  addon({
    code: "capacity_topup_ai_predictions_unit",
    name: "Capacity Topup AI Predictions Unit",
    description: "Adds AI prediction capacity until plan end",
    addonType: "RUNNING_PREDICTIONS_AI",
    isActive: true,
    sortOrder: 32,
    priceCents: 500,
    aiCredits: 0n,
    deltaRunningBots: 0,
    deltaRunningPredictionsAi: 1,
    deltaRunningPredictionsComposite: 0,
    meta: { billingAddonType: "running_predictions_ai" }
  }),
  addon({
    code: "capacity_topup_composite_predictions_unit",
    name: "Capacity Topup Composite Predictions Unit",
    description: "Adds composite prediction capacity until plan end",
    addonType: "RUNNING_PREDICTIONS_COMPOSITE",
    isActive: true,
    sortOrder: 33,
    priceCents: 500,
    aiCredits: 0n,
    deltaRunningBots: 0,
    deltaRunningPredictionsAi: 0,
    deltaRunningPredictionsComposite: 1,
    meta: { billingAddonType: "running_predictions_composite" }
  }),
  ...[
    { code: "ai_topup_10k", name: "10,000 AI Credits", credits: 10_000n, priceCents: 1_000, sortOrder: 20 },
    { code: "ai_topup_25k", name: "25,000 AI Credits", credits: 25_000n, priceCents: 2_500, sortOrder: 21 },
    { code: "ai_topup_50k", name: "50,000 AI Credits", credits: 50_000n, priceCents: 5_000, sortOrder: 22 },
    { code: "ai_topup_100k", name: "100,000 AI Credits", credits: 100_000n, priceCents: 10_000, sortOrder: 23 }
  ].map((item) => addon({
    code: item.code,
    name: item.name,
    description: "Prepaid AI Credits for cost-based OpenAI usage",
    addonType: "AI_CREDITS",
    isActive: true,
    sortOrder: item.sortOrder,
    priceCents: item.priceCents,
    aiCredits: item.credits,
    deltaRunningBots: null,
    deltaRunningPredictionsAi: null,
    deltaRunningPredictionsComposite: null,
    meta: { billingAddonType: "ai_credits" }
  }))
];

export function canonicalPackageByCode(code: string): CanonicalBillingPackage {
  const item = CANONICAL_STAGE4_PACKAGES.find((candidate) => candidate.code === code);
  if (!item) throw new Error(`canonical_billing_package_missing:${code}`);
  return item;
}

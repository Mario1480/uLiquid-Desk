export const PUBLIC_BILLING_CATALOG_VERSION = "2026-09-pricing-v1";

export type PublicPlanKey = "free" | "pro" | "premium";
export type PublicFeatureValue = Record<PublicPlanKey, string>;

export type PublicFeatureRow = {
  category: string;
  feature: string;
  values: PublicFeatureValue;
};

const PLAN_CODES = new Set(["free", "pro_monthly", "premium_monthly"]);
const ADDON_CODES = new Set([
  "capacity_topup_bots_unit",
  "capacity_topup_ai_predictions_unit",
  "capacity_topup_composite_predictions_unit",
  "ai_topup_10k",
  "ai_topup_25k",
  "ai_topup_50k",
  "ai_topup_100k"
]);

export const PUBLIC_FEATURE_MATRIX: readonly PublicFeatureRow[] = [
  { category: "Platform", feature: "Dashboard and portfolio overview", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Platform", feature: "Market data and charts", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Platform", feature: "Crypto and global news", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Platform", feature: "Economic calendar", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Platform", feature: "Connected exchange accounts", values: { free: "1", pro: "Up to 5", premium: "Up to 15" } },
  { category: "Trading", feature: "Paper trading", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Trading", feature: "Live manual trading", values: { free: "—", pro: "Included", premium: "Included" } },
  { category: "Trading", feature: "Consolidated positions and PnL", values: { free: "Basic", pro: "Full", premium: "Full" } },
  { category: "Trading", feature: "Position and liquidation-risk view", values: { free: "Basic", pro: "Full", premium: "Full" } },
  { category: "Strategies", feature: "Local strategies", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Strategies", feature: "AI Predictions", values: { free: "—", pro: "Included", premium: "Included" } },
  { category: "Strategies", feature: "AI Prediction Builder", values: { free: "—", pro: "Included", premium: "Included" } },
  { category: "Strategies", feature: "Active Composite Predictions", values: { free: "—", pro: "Up to 2", premium: "Up to 5" } },
  { category: "AI", feature: "Market Analyst", values: { free: "—", pro: "Included", premium: "Advanced" } },
  { category: "AI", feature: "Position Copilot", values: { free: "—", pro: "Read-only", premium: "Advanced read-only" } },
  { category: "AI", feature: "Agent Chat and skills", values: { free: "—", pro: "Core profiles", premium: "All available profiles" } },
  { category: "AI", feature: "Monthly included AI Credits", values: { free: "0", pro: "10,000", premium: "30,000" } },
  { category: "Automation", feature: "Simultaneously active bots", values: { free: "1 paper bot", pro: "Up to 3", premium: "Up to 10" } },
  { category: "Automation", feature: "Active AI Predictions", values: { free: "—", pro: "Up to 3", premium: "Up to 10" } },
  { category: "Automation", feature: "Grid Bots", values: { free: "—", pro: "Included", premium: "Included" } },
  { category: "Automation", feature: "Prediction Copier", values: { free: "—", pro: "—", premium: "Included" } },
  { category: "Automation", feature: "Bot Vaults", values: { free: "Later", pro: "Later", premium: "Later" } },
  { category: "Research", feature: "Backtesting", values: { free: "—", pro: "Standard", premium: "Advanced" } },
  { category: "Research", feature: "Strategy comparison", values: { free: "—", pro: "Standard", premium: "Advanced" } },
  { category: "Notifications", feature: "In-app notifications", values: { free: "Included", pro: "Included", premium: "Included" } },
  { category: "Notifications", feature: "Telegram notifications", values: { free: "Basic", pro: "Full", premium: "Full" } },
  { category: "Notifications", feature: "Webhook notifications", values: { free: "—", pro: "Included", premium: "Included" } },
  { category: "Support", feature: "Support level", values: { free: "Community", pro: "Standard", premium: "Priority" } },
  { category: "Access", feature: "Early access to selected modules", values: { free: "—", pro: "—", premium: "Included" } }
] as const;

function bigintString(value: unknown): string {
  try {
    return BigInt(value == null ? 0 : value as bigint | number | string).toString();
  } catch {
    return "0";
  }
}

function planKey(value: unknown): PublicPlanKey | null {
  if (value === "FREE" || value === "free") return "free";
  if (value === "PRO" || value === "pro") return "pro";
  if (value === "PREMIUM" || value === "premium") return "premium";
  return null;
}

function addonType(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "running_bots") return "running_bots";
  if (normalized === "running_predictions_ai") return "running_predictions_ai";
  if (normalized === "running_predictions_composite") return "running_predictions_composite";
  if (normalized === "ai_credits") return "ai_credits";
  return null;
}

export function buildPublicBillingCatalog(packages: readonly any[], now = new Date()) {
  const plans = packages
    .filter((pkg) => PLAN_CODES.has(String(pkg?.code)) && pkg?.isActive === true && Number(pkg?.billingMonths) === 1)
    .map((pkg) => ({
      code: String(pkg.code),
      plan: planKey(pkg.plan),
      name: String(pkg.name),
      status: "available" as const,
      priceCents: Number(pkg.priceCents ?? 0),
      billingMonths: 1 as const,
      maxExchangeAccounts: pkg.maxExchangeAccounts == null ? null : Number(pkg.maxExchangeAccounts),
      maxRunningBots: pkg.maxRunningBots == null ? null : Number(pkg.maxRunningBots),
      maxRunningPredictionsAi: pkg.maxRunningPredictionsAi == null ? null : Number(pkg.maxRunningPredictionsAi),
      maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite == null ? null : Number(pkg.maxRunningPredictionsComposite),
      monthlyAiCredits: bigintString(pkg.monthlyAiCredits)
    }))
    .filter((plan) => plan.plan !== null)
    .sort((left, right) => ["free", "pro", "premium"].indexOf(left.plan!) - ["free", "pro", "premium"].indexOf(right.plan!));

  const addons = packages
    .filter((pkg) => ADDON_CODES.has(String(pkg?.code)) && pkg?.isActive === true && Number(pkg?.billingMonths) === 1)
    .map((pkg) => ({
      code: String(pkg.code),
      name: String(pkg.name),
      addonType: addonType(pkg.addonType),
      priceCents: Number(pkg.priceCents ?? 0),
      billingMonths: 1 as const,
      availability: ["pro", "premium"] as const,
      aiCredits: bigintString(pkg.aiCredits),
      deltaRunningBots: Number(pkg.deltaRunningBots ?? 0),
      deltaRunningPredictionsAi: Number(pkg.deltaRunningPredictionsAi ?? 0),
      deltaRunningPredictionsComposite: Number(pkg.deltaRunningPredictionsComposite ?? 0)
    }))
    .filter((addon) => addon.addonType !== null)
    .sort((left, right) => left.code.localeCompare(right.code));

  const expectedPlans: Record<PublicPlanKey, [number, number, number, number, number, string]> = {
    free: [0, 1, 1, 0, 0, "0"],
    pro: [2900, 5, 3, 3, 2, "10000"],
    premium: [6900, 15, 10, 10, 5, "30000"]
  };
  const plansMatchTarget = plans.length === 3 && plans.every((plan) => {
    const expected = expectedPlans[plan.plan!];
    return expected
      && plan.priceCents === expected[0]
      && plan.maxExchangeAccounts === expected[1]
      && plan.maxRunningBots === expected[2]
      && plan.maxRunningPredictionsAi === expected[3]
      && plan.maxRunningPredictionsComposite === expected[4]
      && plan.monthlyAiCredits === expected[5];
  });
  const expectedAddons = new Map([
    ["capacity_topup_bots_unit", [500, "0", 1, 0, 0]],
    ["capacity_topup_ai_predictions_unit", [500, "0", 0, 1, 0]],
    ["capacity_topup_composite_predictions_unit", [500, "0", 0, 0, 1]],
    ["ai_topup_10k", [1000, "10000", 0, 0, 0]],
    ["ai_topup_25k", [2500, "25000", 0, 0, 0]],
    ["ai_topup_50k", [5000, "50000", 0, 0, 0]],
    ["ai_topup_100k", [10000, "100000", 0, 0, 0]]
  ] as const);
  const addonsMatchTarget = addons.length === expectedAddons.size && addons.every((addon) => {
    const expected = expectedAddons.get(addon.code);
    return expected
      && addon.priceCents === expected[0]
      && addon.aiCredits === expected[1]
      && addon.deltaRunningBots === expected[2]
      && addon.deltaRunningPredictionsAi === expected[3]
      && addon.deltaRunningPredictionsComposite === expected[4];
  });
  if (!plansMatchTarget || !addonsMatchTarget) {
    throw new Error("public_pricing_catalog_incomplete");
  }

  return {
    catalogVersion: PUBLIC_BILLING_CATALOG_VERSION,
    generatedAt: now.toISOString(),
    currency: "USDC" as const,
    plans,
    addons,
    featureMatrix: PUBLIC_FEATURE_MATRIX
  };
}

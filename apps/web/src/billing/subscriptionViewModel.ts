import type { ProductFeatureGateMap } from "../access/productFeatureGates";

export type BillingPackageKind = "plan" | "addon";
export type CommercialPlan = "free" | "pro" | "premium";
export type BillingAddonType =
  | "running_bots"
  | "running_predictions_ai"
  | "running_predictions_composite"
  | "ai_credits";

export type BillingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: BillingPackageKind;
  addonType: BillingAddonType | null;
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  billingMonths: number;
  plan: CommercialPlan | null;
  maxExchangeAccounts: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: string;
  aiCredits: string;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
};

export type PlanCatalogItem = {
  code: string;
  name: string;
  description: string | null;
  plan: CommercialPlan;
  priceCents: number;
  billingMonths: number;
  maxExchangeAccounts: number | null;
  maxRunningBots: number;
  maxRunningPredictionsAi: number;
  maxRunningPredictionsComposite: number;
  monthlyAiCredits: string;
  packageId: string | null;
  purchasable: boolean;
};

export type ImmediateUpgradePreview = {
  kind: "IMMEDIATE_PLAN_UPGRADE";
  sourcePlan: "PRO";
  targetPlan: "PREMIUM";
  sourceTermId: string;
  sourceTermEndsAt: string;
  sourceTermGraceEndsAt: string;
  sourcePriceCents: number;
  targetPriceCents: number;
  differenceCents: number;
  billingMonths: number;
};

export type BillingOrderStatus =
  | "pending"
  | "confirming"
  | "review_required"
  | "paid"
  | "failed"
  | "expired";

export type BillingOnchainPayment = {
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number;
  recipientAddress?: string | null;
  treasuryAddress?: string | null;
  amountRaw: string;
  amountFormatted: string;
  expectedSenderAddress?: string | null;
  confirmationsRequired?: number | null;
  requiredConfirmations?: number | null;
  expiresAt: string;
  txHash?: string | null;
  blockNumber?: string | number | null;
  confirmations?: number | null;
  lastError?: string | null;
  verifiedAt?: string | null;
  explorerUrl?: string | null;
};

export type SubscriptionTermSummary = {
  id: string;
  status?: string | null;
  startsAt: string;
  endsAt: string;
  graceEndsAt: string;
};

export type BillingOrder = {
  id: string;
  merchantOrderId: string;
  status: BillingOrderStatus;
  amountCents: number;
  currency: string;
  paymentStatusRaw: string | null;
  paidAt: string | null;
  createdAt: string | null;
  expiresAt?: string | null;
  explorerUrl?: string | null;
  uliqBenefit?: UliqBenefitSnapshot | null;
  onchainPayment?: BillingOnchainPayment | null;
  package: {
    id: string;
    code: string;
    name: string;
    kind: BillingPackageKind;
    addonType: BillingAddonType | null;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitPriceCents: number;
    lineAmountCents: number;
    kind: BillingPackageKind;
    addonType: BillingAddonType | null;
    package: {
      id: string;
      code: string;
      name: string;
      kind: BillingPackageKind;
      addonType: BillingAddonType | null;
    } | null;
  }>;
};

export type UliqBenefitSnapshot = {
  reservationId: string;
  tier: string | null;
  discountBps: number | null;
  baseAmountCents: number | null;
  discountAmountCents: number | null;
  finalAmountCents: number | null;
  expiresAt: string | null;
  lockGateVersion?: string | null;
  requiredBenefitUntil?: string | null;
  requiredLockedRaw?: string | null;
  qualifyingLockedRaw?: string | null;
  qualifyingLockIds?: string[];
};

export type SubscriptionLimits = {
  maxExchangeAccounts: number | null;
  maxRunningBots: number;
  allowedExchanges: string[];
  bots: {
    maxRunning: number;
  };
  predictions: {
    local: {
      maxRunning: number | null;
    };
    ai: {
      maxRunning: number | null;
    };
    composite: {
      maxRunning: number | null;
    };
  };
};

export type SubscriptionUsage = {
  runningBots: number;
  bots: {
    running: number;
  };
  predictions: {
    local: {
      running: number;
    };
    ai: {
      running: number;
    };
    composite: {
      running: number;
    };
  };
};

export type ResolvedEntitlementContextPayload = {
  commercialPlan: CommercialPlan;
  capabilityPlan: CommercialPlan | "enterprise";
  enterpriseOverride: boolean;
  capabilities: Record<string, boolean>;
  capabilitySnapshot: unknown;
  quotas: SubscriptionLimits;
  usage: SubscriptionUsage;
};

export type SubscriptionPayload = {
  billingEnabled: boolean;
  plan: CommercialPlan;
  planDisplayName?: string;
  status: "active" | "grace" | "inactive";
  planValidUntil: string | null;
  proValidUntil: string | null;
  graceEndsAt?: string | null;
  scheduledTerm?: SubscriptionTermSummary | null;
  fallbackReason?: string | null;
  capabilities?: Record<string, boolean>;
  featureGates?: ProductFeatureGateMap;
  entitlements?: ResolvedEntitlementContextPayload;
  limits: SubscriptionLimits;
  usage: SubscriptionUsage;
  quotaBreakdown?: {
    base: { runningBots: number; runningPredictionsAi: number | null; runningPredictionsComposite: number | null };
    addon: { runningBots: number; runningPredictionsAi: number; runningPredictionsComposite: number };
    effective: { runningBots: number; runningPredictionsAi: number | null; runningPredictionsComposite: number | null };
  };
  exchangeAccounts?: { used: number; max: number | null; paperExcluded: boolean };
  upgradePreview?: ImmediateUpgradePreview | null;
  ai: {
    creditBalance: string;
    creditsUsedLifetime: string;
    monthlyIncludedCredits: string;
    billingEnabled: boolean;
  };
  planCatalog?: PlanCatalogItem[];
  packages: BillingPackage[];
  orders: BillingOrder[];
};

export type AuthMePayload = {
  user?: {
    id: string;
    email: string;
    walletAddress?: string | null;
  };
  id?: string;
  email?: string;
  walletAddress?: string | null;
};

export type ServerInfoPayload = {
  serverIpAddress: string | null;
};

export type LicensePageModel = {
  plan: CommercialPlan;
  status: "active" | "grace" | "inactive";
  planValidUntil: string | null;
  proValidUntil: string | null;
  graceEndsAt: string | null;
  scheduledTerm: SubscriptionTermSummary | null;
  fallbackReason: string | null;
  account: {
    email: string | null;
    userId: string | null;
  };
  limits: {
    bots: {
      running: number;
      maxRunning: number;
    };
    predictionsAi: {
      running: number;
      maxRunning: number | null;
    };
    predictionsComposite: {
      running: number;
      maxRunning: number | null;
    };
    maxExchangeAccounts: number | null;
    exchanges: string[];
  };
  ai: {
    balance: string;
    monthlyIncluded: string;
    usedLifetime: string;
  };
  features: {
    proPlan: boolean;
    premiumPlan: boolean;
    aiBillingEnabled: boolean;
    addonsAvailable: boolean;
    fallbackMode: boolean;
  };
  instance: {
    serverIpAddress: string | null;
  };
  orders: BillingOrder[];
};

export type OrderPageModel = {
  planPackages: BillingPackage[];
  addonPackages: BillingPackage[];
  defaultPlanId: string | null;
  hasPlans: boolean;
  hasAddons: boolean;
};

export function centsToCurrency(cents: number, currency = "USD"): string {
  const value = Number(cents) / 100;
  return `${value.toFixed(2)} ${currency}`;
}

function sortPackages(a: BillingPackage, b: BillingPackage): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

export function buildOrderPageModel(payload: SubscriptionPayload | null): OrderPageModel {
  const all = Array.isArray(payload?.packages) ? payload?.packages : [];
  const planPackages = all
    .filter((pkg) => pkg.isActive && pkg.kind === "plan" && pkg.plan !== null && pkg.plan !== "free")
    .sort(sortPackages);
  const addonPackages = all
    .filter((pkg) => pkg.isActive && pkg.kind === "addon")
    .sort(sortPackages);
  return {
    planPackages,
    addonPackages,
    defaultPlanId: planPackages[0]?.id ?? null,
    hasPlans: planPackages.length > 0,
    hasAddons: addonPackages.length > 0
  };
}

export function buildLicensePageModel(
  payload: SubscriptionPayload | null,
  me: AuthMePayload | null,
  serverInfo: ServerInfoPayload | null
): LicensePageModel | null {
  if (!payload) return null;
  const addonsAvailable = payload.packages.some((pkg) => pkg.kind === "addon");
  return {
    plan: payload.plan,
    status: payload.status,
    planValidUntil: payload.planValidUntil,
    proValidUntil: payload.proValidUntil,
    graceEndsAt: payload.graceEndsAt ?? null,
    scheduledTerm: payload.scheduledTerm ?? null,
    fallbackReason:
      typeof payload.fallbackReason === "string" && payload.fallbackReason.trim()
        ? payload.fallbackReason
        : null,
    account: {
      email:
        typeof me?.email === "string"
          ? me.email
          : typeof me?.user?.email === "string"
            ? me.user.email
            : null,
      userId:
        typeof me?.id === "string"
          ? me.id
          : typeof me?.user?.id === "string"
            ? me.user.id
            : null
    },
    limits: {
      bots: {
        running: payload.usage.bots.running,
        maxRunning: payload.limits.bots.maxRunning
      },
      predictionsAi: {
        running: payload.usage.predictions.ai.running,
        maxRunning: payload.limits.predictions.ai.maxRunning
      },
      predictionsComposite: {
        running: payload.usage.predictions.composite.running,
        maxRunning: payload.limits.predictions.composite.maxRunning
      },
      maxExchangeAccounts: payload.limits.maxExchangeAccounts,
      exchanges: payload.limits.allowedExchanges
    },
    ai: {
      balance: payload.ai.creditBalance,
      monthlyIncluded: payload.ai.monthlyIncludedCredits,
      usedLifetime: payload.ai.creditsUsedLifetime
    },
    features: {
      proPlan: payload.plan !== "free",
      premiumPlan: payload.plan === "premium",
      aiBillingEnabled: Boolean(payload.ai.billingEnabled),
      addonsAvailable,
      fallbackMode: Boolean(payload.fallbackReason)
    },
    instance: {
      serverIpAddress:
        typeof serverInfo?.serverIpAddress === "string" && serverInfo.serverIpAddress.trim()
          ? serverInfo.serverIpAddress.trim()
          : null
    },
    orders: payload.orders
  };
}

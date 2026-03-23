import type { ProductFeatureGateMap } from "../access/productFeatureGates";

export type BillingPackageKind = "plan" | "addon";
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
  plan: "free" | "pro" | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: string;
  aiCredits: string;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
};

export type BillingOrder = {
  id: string;
  merchantOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
  amountCents: number;
  currency: string;
  payUrl: string | null;
  paymentStatusRaw: string | null;
  paidAt: string | null;
  createdAt: string | null;
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

export type SubscriptionPayload = {
  billingEnabled: boolean;
  plan: "free" | "pro";
  status: "active" | "inactive";
  proValidUntil: string | null;
  fallbackReason?: string | null;
  capabilities?: Record<string, boolean>;
  featureGates?: ProductFeatureGateMap;
  limits: {
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
  usage: {
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
  ai: {
    tokenBalance: string;
    tokenUsedLifetime: string;
    monthlyIncluded: string;
    billingEnabled: boolean;
  };
  packages: BillingPackage[];
  orders: BillingOrder[];
};

export type AuthMePayload = {
  user?: {
    id: string;
    email: string;
  };
  id?: string;
  email?: string;
};

export type ServerInfoPayload = {
  serverIpAddress: string | null;
};

export type LicensePageModel = {
  plan: "free" | "pro";
  status: "active" | "inactive";
  proValidUntil: string | null;
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
    exchanges: string[];
  };
  ai: {
    balance: string;
    monthlyIncluded: string;
    usedLifetime: string;
  };
  features: {
    proPlan: boolean;
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
  const planPackages = all.filter((pkg) => pkg.kind === "plan").sort(sortPackages);
  const addonPackages = all
    .filter((pkg) => pkg.kind === "addon")
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
    proValidUntil: payload.proValidUntil,
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
      exchanges: payload.limits.allowedExchanges
    },
    ai: {
      balance: payload.ai.tokenBalance,
      monthlyIncluded: payload.ai.monthlyIncluded,
      usedLifetime: payload.ai.tokenUsedLifetime
    },
    features: {
      proPlan: payload.plan === "pro",
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

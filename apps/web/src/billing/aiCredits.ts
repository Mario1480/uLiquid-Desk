export type AiCreditWarningLevel = "none" | "low_20" | "low_10" | "exhausted";

export type AiCreditSummary = {
  balance: string;
  available: string;
  reserved: string;
  usedLifetime: string;
  usedToday: string;
  usedThisMonth: string;
  dailyLimit: string | null;
  monthlyLimit: string | null;
  maxRunCredits: string | null;
  warningLevel: AiCreditWarningLevel;
  topups?: Array<{ id: string; code: string; name: string; priceCents: number; aiCredits: string }>;
};

export type AiCreditHeaderSummary = Pick<
  AiCreditSummary,
  "balance" | "available" | "reserved" | "warningLevel"
>;

export type AiCreditUsageItem = {
  id: string;
  scope: string;
  status: string;
  provider: string | null;
  model: string | null;
  modelClass: string | null;
  reservedCredits: string;
  chargedCredits: string;
  modelCallCount: number;
  usageTotalTokens: number;
  tokenUsage: {
    input: string;
    cachedInput: string;
    output: string;
    reasoning: string;
  };
  latencyMs: number | null;
  reservation: {
    status: string;
    reservedCredits: string;
    settledCredits: string;
  } | null;
  createdAt: string;
  completedAt: string | null;
};

export type AiCreditUsagePage = {
  items: AiCreditUsageItem[];
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export const AI_CREDIT_USAGE_SCOPES = [
  "position_copilot",
  "prediction_explainer",
  "prediction_explainer_agent",
  "composite_strategy_ai",
  "ai_agent_chat",
  "prompt_builder_chat",
  "prompt_generator",
  "market_intelligence_summary",
  "ai_call"
] as const;

export type AiCreditUsageScope = (typeof AI_CREDIT_USAGE_SCOPES)[number];

export function isKnownAiCreditUsageScope(scope: string): scope is AiCreditUsageScope {
  return (AI_CREDIT_USAGE_SCOPES as readonly string[]).includes(scope);
}

export function formatAiCreditAmount(value: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(value));
  } catch {
    return value;
  }
}

export function formatAiTokenAmount(value: string | number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(value));
  } catch {
    return String(value);
  }
}

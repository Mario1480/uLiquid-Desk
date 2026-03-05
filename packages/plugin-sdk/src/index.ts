export type PluginKind = "signal" | "execution" | "notification" | "exchange_extension" | "signal_source";

export type PlanTier = "free" | "pro" | "enterprise";

export type PluginManifest = {
  id: string;
  kind: PluginKind;
  version: string;
  description: string;
  minPlan?: PlanTier;
  defaultEnabled?: boolean;
  capabilities?: string[];
};

export type PluginHealthState = {
  status: "healthy" | "degraded" | "disabled";
  consecutiveFailures: number;
  lastErrorAt?: string;
  cooldownUntil?: string;
};

export type BotPluginPolicySnapshot = {
  plan: PlanTier;
  allowedPluginIds: string[] | null;
  evaluatedAt: string;
};

export type BotPluginConfig = {
  version: 1;
  enabled?: string[];
  disabled?: string[];
  order?: string[];
  overrides?: Record<string, Record<string, unknown>>;
  policySnapshot?: BotPluginPolicySnapshot;
};

export type NotificationEvent = {
  type: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type NotificationContext = {
  userId?: string;
  botId?: string;
  now: Date;
};

export type ExchangeExtensionInput = {
  exchange: string;
  symbol?: string;
  payload: Record<string, unknown>;
};

export type ExchangeExtensionOutput = {
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ExchangeExtensionContext = {
  botId?: string;
  now: Date;
};

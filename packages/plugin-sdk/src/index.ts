import type {
  CapabilitySnapshot as CoreCapabilitySnapshot,
  PlanTier as CorePlanTier
} from "@mm/core";

export type PlanTier = CorePlanTier;
export type CapabilitySnapshot = CoreCapabilitySnapshot;

export type PluginKind = "signal" | "execution" | "notification" | "exchange_extension" | "signal_source";

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
  capabilitySnapshot?: CapabilitySnapshot;
};

export type BotPluginConfig = {
  version: 1;
  enabled?: string[];
  disabled?: string[];
  order?: string[];
  overrides?: Record<string, Record<string, unknown>>;
  policySnapshot?: BotPluginPolicySnapshot;
};

export * from "./notification/types.js";
export * from "./notification/dispatcher.js";

export type NotificationEvent = import("./notification/types.js").NotificationEventEnvelope;
export type NotificationContext = import("./notification/types.js").NotificationDispatchContext;

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

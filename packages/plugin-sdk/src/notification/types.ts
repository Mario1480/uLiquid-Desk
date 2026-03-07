import type { BotPluginPolicySnapshot, PlanTier, PluginManifest } from "../index.js";

export type NotificationCategory = "trade" | "error" | "risk" | "lock" | "warning";

export type NotificationSeverity = "info" | "warn" | "error" | "critical";

export type NotificationSource = "api" | "runner";

export type NotificationEventScope = {
  botId?: string;
  userId?: string;
  exchange?: string;
  symbol?: string;
};

export type NotificationEventEnvelope = {
  eventId: string;
  occurredAt: string;
  category: NotificationCategory;
  type: string;
  source: NotificationSource;
  scope: NotificationEventScope;
  severity: NotificationSeverity;
  title: string;
  message?: string;
  payload: Record<string, unknown>;
  tags?: string[];
  correlationId?: string;
};

export type NotificationDispatchContext = {
  now: Date;
  planTier?: PlanTier;
  policySnapshot?: BotPluginPolicySnapshot | null;
  destinationConfig?: Record<string, unknown>;
  trace?: {
    workerId?: string;
    tickId?: string;
    requestId?: string;
  };
  userId?: string;
  botId?: string;
};

export type NotificationDeliveryStatus =
  | "sent"
  | "skipped"
  | "failed"
  | "policy_blocked"
  | "timeout";

export type NotificationDeliveryResult = {
  status: NotificationDeliveryStatus;
  providerId: string;
  externalId?: string;
  reason: string;
  retryable?: boolean;
  latencyMs: number;
  metadata?: Record<string, unknown>;
};

export interface NotificationProvider<
  TEvent extends NotificationEventEnvelope = NotificationEventEnvelope,
  TContext extends NotificationDispatchContext = NotificationDispatchContext
> {
  manifest: PluginManifest & { kind: "notification" };
  canHandle?(event: TEvent, ctx: TContext): boolean;
  send(event: TEvent, ctx: TContext): Promise<NotificationDeliveryResult>;
}

export type NotificationDispatchResult = {
  eventId: string;
  sent: boolean;
  providerId: string | null;
  deliveries: NotificationDeliveryResult[];
};


import type { ApiNotificationPlugin } from "./types.js";

export const WEBHOOK_NOTIFICATION_PLUGIN_ID = "core.notification.webhook";

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const header = String(key ?? "").trim();
    const val = String(raw ?? "").trim();
    if (!header || !val) continue;
    out[header] = val;
  }
  return out;
}

export const webhookNotificationPlugin: ApiNotificationPlugin = {
  manifest: {
    id: WEBHOOK_NOTIFICATION_PLUGIN_ID,
    kind: "notification",
    version: "1.0.0",
    description: "Built-in webhook notification channel",
    minPlan: "pro",
    defaultEnabled: false,
    capabilities: ["notification.webhook"]
  },
  canHandle(): boolean {
    return true;
  },
  async send(event, ctx) {
    const webhookUrl = String(ctx.destinationConfig.webhook.url ?? "").trim();
    if (!webhookUrl) {
      return {
        status: "skipped",
        providerId: WEBHOOK_NOTIFICATION_PLUGIN_ID,
        reason: "webhook_not_configured",
        retryable: false,
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    const headers = normalizeHeaders(ctx.destinationConfig.webhook.headers);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify({
        event,
        context: {
          userId: ctx.userId,
          planTier: ctx.planTier,
          trace: ctx.trace ?? null
        }
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "failed",
        providerId: WEBHOOK_NOTIFICATION_PLUGIN_ID,
        reason: `webhook_http_${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        latencyMs: Date.now() - startedAt,
        metadata: {
          status: response.status,
          body: body.slice(0, 500)
        }
      };
    }

    return {
      status: "sent",
      providerId: WEBHOOK_NOTIFICATION_PLUGIN_ID,
      reason: "webhook_delivered",
      retryable: false,
      latencyMs: Date.now() - startedAt
    };
  }
};


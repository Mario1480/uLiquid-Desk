import {
  sanitizeOutboundHeaders,
  validateSafeOutboundUrl
} from "@mm/core";
import type { ApiNotificationPlugin } from "./types.js";

export const WEBHOOK_NOTIFICATION_PLUGIN_ID = "core.notification.webhook";

function normalizeHeaders(value: unknown): Record<string, string> {
  return sanitizeOutboundHeaders(value);
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
    const safeUrl = await validateSafeOutboundUrl(webhookUrl, {
      production: process.env.NODE_ENV === "production",
      timeoutMs: 5_000
    });
    if (!safeUrl.ok) {
      return {
        status: "failed",
        providerId: WEBHOOK_NOTIFICATION_PLUGIN_ID,
        reason: `unsafe_webhook_url:${safeUrl.reason}`,
        retryable: false,
        latencyMs: Date.now() - startedAt
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), safeUrl.timeoutMs);

    let response: Response;
    try {
      response = await fetch(safeUrl.url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          ...headers,
          "content-type": "application/json"
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
    } catch (error) {
      return {
        status: "failed",
        providerId: WEBHOOK_NOTIFICATION_PLUGIN_ID,
        reason: error instanceof Error && error.name === "AbortError" ? "webhook_timeout" : "webhook_fetch_failed",
        retryable: true,
        latencyMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timeout);
    }

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

import type { NotificationEventEnvelope } from "@mm/plugin-sdk";
import type { RunnerNotificationPlugin } from "../types.js";

export const NOTIFICATION_PLUGIN_ID_TELEGRAM = "core.notification.telegram";
export const NOTIFICATION_PLUGIN_ID_WEBHOOK = "core.notification.webhook";

type RunnerDestinationConfig = {
  telegram: {
    botToken: string | null;
    chatId: string | null;
  };
  webhook: {
    url: string | null;
    headers: Record<string, string>;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readDestinationConfig(raw: unknown): RunnerDestinationConfig {
  const row = asRecord(raw);
  const telegram = asRecord(row?.telegram);
  const webhook = asRecord(row?.webhook);
  const headersRaw = asRecord(webhook?.headers);
  const headers: Record<string, string> = {};
  if (headersRaw) {
    for (const [key, value] of Object.entries(headersRaw)) {
      const header = String(key ?? "").trim();
      const val = String(value ?? "").trim();
      if (!header || !val) continue;
      headers[header] = val;
    }
  }

  const toStringOrNull = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  return {
    telegram: {
      botToken: toStringOrNull(telegram?.botToken),
      chatId: toStringOrNull(telegram?.chatId)
    },
    webhook: {
      url: toStringOrNull(webhook?.url),
      headers
    }
  };
}

function renderRunnerTelegramText(event: NotificationEventEnvelope): string {
  const lines = [
    `🔔 ${event.title}`,
    `Type: ${event.type}`,
    `Category: ${event.category}`,
    event.scope.symbol ? `Symbol: ${event.scope.symbol}` : null,
    event.scope.exchange ? `Exchange: ${event.scope.exchange}` : null,
    event.message ? `Message: ${event.message}` : null
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

const telegramRunnerNotificationPlugin: RunnerNotificationPlugin = {
  manifest: {
    id: NOTIFICATION_PLUGIN_ID_TELEGRAM,
    kind: "notification",
    version: "1.0.0",
    description: "Built-in Telegram notification channel",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["notification.telegram", "runner.notification"]
  },
  canHandle(): boolean {
    return true;
  },
  async send(event, ctx) {
    const destination = readDestinationConfig(ctx.destinationConfig);
    if (!destination.telegram.botToken || !destination.telegram.chatId) {
      return {
        status: "skipped",
        providerId: NOTIFICATION_PLUGIN_ID_TELEGRAM,
        reason: "telegram_not_configured",
        retryable: false,
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    const response = await fetch(`https://api.telegram.org/bot${destination.telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: destination.telegram.chatId,
        text: renderRunnerTelegramText(event),
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "failed",
        providerId: NOTIFICATION_PLUGIN_ID_TELEGRAM,
        reason: `telegram_http_${response.status}`,
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
      providerId: NOTIFICATION_PLUGIN_ID_TELEGRAM,
      reason: "telegram_delivered",
      retryable: false,
      latencyMs: Date.now() - startedAt
    };
  }
};

const webhookRunnerNotificationPlugin: RunnerNotificationPlugin = {
  manifest: {
    id: NOTIFICATION_PLUGIN_ID_WEBHOOK,
    kind: "notification",
    version: "1.0.0",
    description: "Built-in webhook notification channel",
    minPlan: "pro",
    defaultEnabled: false,
    capabilities: ["notification.webhook", "runner.notification"]
  },
  canHandle(): boolean {
    return true;
  },
  async send(event, ctx) {
    const destination = readDestinationConfig(ctx.destinationConfig);
    if (!destination.webhook.url) {
      return {
        status: "skipped",
        providerId: NOTIFICATION_PLUGIN_ID_WEBHOOK,
        reason: "webhook_not_configured",
        retryable: false,
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    const response = await fetch(destination.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...destination.webhook.headers
      },
      body: JSON.stringify({
        event,
        context: {
          userId: ctx.userId ?? null,
          botId: ctx.botId ?? null,
          planTier: ctx.planTier ?? null
        }
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "failed",
        providerId: NOTIFICATION_PLUGIN_ID_WEBHOOK,
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
      providerId: NOTIFICATION_PLUGIN_ID_WEBHOOK,
      reason: "webhook_delivered",
      retryable: false,
      latencyMs: Date.now() - startedAt
    };
  }
};

export const builtinNotificationPlugins: RunnerNotificationPlugin[] = [
  telegramRunnerNotificationPlugin,
  webhookRunnerNotificationPlugin
];


import {
  notifyMarketAnalysisUpdate,
  notifyPredictionOutcome,
  notifyTradablePrediction,
  sendTelegramMessage
} from "../../telegram/notifications.js";
import type { ApiNotificationPlugin } from "./types.js";

export const TELEGRAM_NOTIFICATION_PLUGIN_ID = "core.notification.telegram";

export const telegramNotificationPlugin: ApiNotificationPlugin = {
  manifest: {
    id: TELEGRAM_NOTIFICATION_PLUGIN_ID,
    kind: "notification",
    version: "1.0.0",
    description: "Built-in Telegram notification plugin",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["notification.telegram"]
  },
  canHandle(event): boolean {
    return event.type === "prediction.tradable"
      || event.type === "prediction.market_analysis_update"
      || event.type === "prediction.outcome"
      || event.type === "vault.agent_low_hype";
  },
  async send(event, ctx) {
    if (event.type === "prediction.tradable") {
      await notifyTradablePrediction(event.payload);
      return {
        status: "sent",
        providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
        reason: "tradable_prediction_dispatched",
        latencyMs: 0
      };
    }

    if (event.type === "prediction.market_analysis_update") {
      await notifyMarketAnalysisUpdate(event.payload);
      return {
        status: "sent",
        providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
        reason: "market_analysis_update_dispatched",
        latencyMs: 0
      };
    }

    if (event.type === "prediction.outcome") {
      const sent = await notifyPredictionOutcome(event.payload);
      return {
        status: sent ? "sent" : "failed",
        providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
        reason: sent ? "prediction_outcome_dispatched" : "prediction_outcome_send_failed",
        retryable: !sent,
        latencyMs: 0
      };
    }

    if (event.type === "vault.agent_low_hype") {
      const botToken = String(ctx.destinationConfig.telegram.botToken ?? "").trim();
      const chatId = String(ctx.destinationConfig.telegram.chatId ?? "").trim();
      if (!botToken || !chatId) {
        return {
          status: "skipped",
          providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
          reason: "telegram_not_configured",
          retryable: false,
          latencyMs: 0
        };
      }
      await sendTelegramMessage({
        botToken,
        chatId,
        text: [
          "MASTERVAULT AGENT LOW HYPE",
          `MasterVault: ${event.payload.masterVaultId}`,
          `Agent: ${event.payload.agentWalletAddress}`,
          `Balance: ${event.payload.hypeBalance ?? "n/a"} HYPE`,
          `Threshold: ${event.payload.lowHypeThreshold} HYPE`
        ].join("\n")
      });
      return {
        status: "sent",
        providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
        reason: "vault_agent_low_hype_dispatched",
        latencyMs: 0
      };
    }

    return {
      status: "skipped",
      providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
      reason: "event_not_supported",
      retryable: false,
      latencyMs: 0
    };
  }
};

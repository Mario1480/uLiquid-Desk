import {
  notifyMarketAnalysisUpdate,
  notifyPredictionOutcome,
  notifyTradablePrediction
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
      || event.type === "prediction.outcome";
  },
  async send(event) {
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

    return {
      status: "skipped",
      providerId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
      reason: "event_not_supported",
      retryable: false,
      latencyMs: 0
    };
  }
};

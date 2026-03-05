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
  async notify(event): Promise<{ handled: boolean; success: boolean; pluginId: string; outcomeSent?: boolean }> {
    if (event.type === "prediction_tradable") {
      await notifyTradablePrediction(event.payload);
      return {
        handled: true,
        success: true,
        pluginId: TELEGRAM_NOTIFICATION_PLUGIN_ID
      };
    }

    if (event.type === "market_analysis_update") {
      await notifyMarketAnalysisUpdate(event.payload);
      return {
        handled: true,
        success: true,
        pluginId: TELEGRAM_NOTIFICATION_PLUGIN_ID
      };
    }

    if (event.type === "prediction_outcome") {
      const sent = await notifyPredictionOutcome(event.payload);
      return {
        handled: true,
        success: sent,
        pluginId: TELEGRAM_NOTIFICATION_PLUGIN_ID,
        outcomeSent: sent
      };
    }

    return {
      handled: false,
      success: false,
      pluginId: TELEGRAM_NOTIFICATION_PLUGIN_ID
    };
  }
};

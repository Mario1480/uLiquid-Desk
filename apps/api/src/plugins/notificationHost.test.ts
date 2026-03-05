import assert from "node:assert/strict";
import test from "node:test";
import { createApiNotificationHost } from "./notificationHost.js";
import { ApiNotificationPluginRegistry } from "./notifications/registry.js";

test("notification host dispatches outcome via custom plugin", async () => {
  const registry = new ApiNotificationPluginRegistry();
  registry.register({
    manifest: {
      id: "test.notification.outcome",
      kind: "notification",
      version: "1.0.0",
      description: "test",
      minPlan: "free"
    },
    async notify(event) {
      if (event.type !== "prediction_outcome") {
        return {
          handled: false,
          success: false,
          pluginId: "test.notification.outcome"
        };
      }
      return {
        handled: true,
        success: true,
        pluginId: "test.notification.outcome",
        outcomeSent: true
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free"
  });

  const sent = await host.dispatchPredictionOutcomeNotification({
    userId: "user_1",
    exchangeAccountLabel: "acc",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    predictionId: "pred_1",
    outcomeResult: "tp_hit",
    outcomePnlPct: 1.5,
    tags: ["test"]
  }, {
    pluginIds: ["test.notification.outcome"],
    policySnapshot: {
      plan: "free",
      allowedPluginIds: ["test.notification.outcome"],
      evaluatedAt: new Date().toISOString()
    }
  });

  assert.equal(sent, true);
});

test("notification host skips plugin when plan is too low", async () => {
  const registry = new ApiNotificationPluginRegistry();
  registry.register({
    manifest: {
      id: "test.notification.pro_only",
      kind: "notification",
      version: "1.0.0",
      description: "test",
      minPlan: "pro"
    },
    async notify() {
      return {
        handled: true,
        success: true,
        pluginId: "test.notification.pro_only",
        outcomeSent: true
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free"
  });

  const sent = await host.dispatchPredictionOutcomeNotification({
    userId: "user_2",
    exchangeAccountLabel: "acc",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    predictionId: "pred_2",
    outcomeResult: "tp_hit",
    outcomePnlPct: 1.5,
    tags: ["test"]
  }, {
    pluginIds: ["test.notification.pro_only"]
  });

  assert.equal(sent, false);
});

test("notification host resolves plugin order from user settings when pluginIds not provided", async () => {
  const registry = new ApiNotificationPluginRegistry();
  registry.register({
    manifest: {
      id: "test.notification.custom",
      kind: "notification",
      version: "1.0.0",
      description: "test",
      minPlan: "free"
    },
    async notify(event) {
      if (event.type !== "prediction_outcome") {
        return {
          handled: false,
          success: false,
          pluginId: "test.notification.custom"
        };
      }
      return {
        handled: true,
        success: true,
        pluginId: "test.notification.custom",
        outcomeSent: true
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free",
    resolveNotificationSettingsForUserId: async () => ({
      enabled: ["test.notification.custom"],
      disabled: ["core.notification.telegram"],
      order: ["test.notification.custom"]
    })
  });

  const sent = await host.dispatchPredictionOutcomeNotification({
    userId: "user_3",
    exchangeAccountLabel: "acc",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    predictionId: "pred_3",
    outcomeResult: "tp_hit",
    outcomePnlPct: 2.3,
    tags: ["test"]
  }, {
    policySnapshot: {
      plan: "free",
      allowedPluginIds: ["test.notification.custom"],
      evaluatedAt: new Date().toISOString()
    }
  });

  assert.equal(sent, true);
});

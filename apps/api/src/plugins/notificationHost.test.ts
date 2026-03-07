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
    canHandle(event) {
      return event.type === "prediction.outcome";
    },
    async send() {
      return {
        status: "sent",
        providerId: "test.notification.outcome",
        reason: "ok",
        latencyMs: 0
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free",
    resolveNotificationSettingsForUserId: async () => ({
      enabled: ["test.notification.outcome"],
      disabled: [],
      order: ["test.notification.outcome"],
      destinations: {
        telegram: { botToken: null, chatId: null },
        webhook: { url: null, headers: {} }
      }
    })
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
    async send() {
      return {
        status: "sent",
        providerId: "test.notification.pro_only",
        reason: "should_not_send",
        latencyMs: 0
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free",
    resolveNotificationSettingsForUserId: async () => ({
      enabled: ["test.notification.pro_only"],
      disabled: [],
      order: ["test.notification.pro_only"],
      destinations: {
        telegram: { botToken: null, chatId: null },
        webhook: { url: null, headers: {} }
      }
    })
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
    canHandle(event) {
      return event.type === "prediction.outcome";
    },
    async send() {
      return {
        status: "sent",
        providerId: "test.notification.custom",
        reason: "ok",
        latencyMs: 0
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free",
    resolveNotificationSettingsForUserId: async () => ({
      enabled: ["test.notification.custom"],
      disabled: ["core.notification.telegram"],
      order: ["test.notification.custom"],
      destinations: {
        telegram: { botToken: null, chatId: null },
        webhook: { url: null, headers: {} }
      }
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

test("notification host falls through after provider timeout", async () => {
  const registry = new ApiNotificationPluginRegistry();
  registry.register({
    manifest: {
      id: "test.notification.timeout",
      kind: "notification",
      version: "1.0.0",
      description: "test",
      minPlan: "free"
    },
    async send() {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        status: "sent",
        providerId: "test.notification.timeout",
        reason: "late",
        latencyMs: 60
      };
    }
  });
  registry.register({
    manifest: {
      id: "test.notification.fallback",
      kind: "notification",
      version: "1.0.0",
      description: "test",
      minPlan: "free"
    },
    async send() {
      return {
        status: "sent",
        providerId: "test.notification.fallback",
        reason: "fallback_sent",
        latencyMs: 0
      };
    }
  });

  const host = createApiNotificationHost({
    registry,
    resolvePlanForUserId: async () => "free",
    resolveNotificationSettingsForUserId: async () => ({
      enabled: ["test.notification.timeout", "test.notification.fallback"],
      disabled: [],
      order: ["test.notification.timeout", "test.notification.fallback"],
      destinations: {
        telegram: { botToken: null, chatId: null },
        webhook: { url: null, headers: {} }
      }
    })
  });

  const sent = await host.dispatchPredictionOutcomeNotification({
    userId: "user_4",
    exchangeAccountLabel: "acc",
    symbol: "ETHUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    predictionId: "pred_4",
    outcomeResult: "tp_hit",
    outcomePnlPct: 1.2,
    tags: ["timeout"]
  }, {
    timeoutMs: 10,
    policySnapshot: {
      plan: "free",
      allowedPluginIds: ["test.notification.timeout", "test.notification.fallback"],
      evaluatedAt: new Date().toISOString()
    }
  });

  assert.equal(sent, true);
});

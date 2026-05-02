import assert from "node:assert/strict";
import test from "node:test";
import { webhookNotificationPlugin } from "./webhookNotificationPlugin.js";

test("webhook notification plugin blocks localhost targets in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const result = await webhookNotificationPlugin.send({
      id: "event_1",
      eventId: "event_1",
      type: "prediction.outcome",
      source: "api",
      occurredAt: new Date().toISOString(),
      payload: {
        userId: "user_1",
        exchangeAccountLabel: "acc",
        symbol: "BTCUSDT",
        marketType: "perp",
        timeframe: "15m",
        signal: "up",
        predictionId: "pred_1",
        outcomeResult: "tp_hit",
        outcomePnlPct: 1
      }
    } as any, {
      userId: "user_1",
      planTier: "pro",
      destinationConfig: {
        telegram: { botToken: null, chatId: null },
        webhook: {
          url: "https://localhost/hook",
          headers: { Host: "internal" }
        }
      }
    } as any);

    assert.equal(result.status, "failed");
    assert.match(result.reason, /^unsafe_webhook_url:/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

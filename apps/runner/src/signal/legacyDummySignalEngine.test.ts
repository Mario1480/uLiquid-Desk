import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import { createLegacyDummySignalEngine } from "./legacyDummySignalEngine.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Normal bot",
    symbol: "BTCUSDT",
    exchange: "paper",
    exchangeAccountId: "acc_1",
    strategyKey: "normal_strategy",
    marginMode: "cross",
    leverage: 3,
    paramsJson: {},
    tickMs: 1000,
    credentials: {
      apiKey: "k",
      apiSecret: "s",
      passphrase: null
    },
    marketData: {
      exchange: "paper",
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "k",
        apiSecret: "s",
        passphrase: null
      }
    },
    ...overrides
  };
}

test("legacy dummy signal blocks productive normal strategies unless explicitly allowed", async () => {
  const engine = createLegacyDummySignalEngine();
  const result = await engine.decide({
    bot: makeBot(),
    now: new Date("2026-05-02T10:00:00.000Z")
  });

  assert.equal(result.reason, "strategy_runtime_not_available");
  assert.equal(result.metadata.blockedBySignal, true);
  assert.deepEqual(result.legacyIntent, { type: "none" });
});

test("legacy dummy signal remains available for explicit dev/test opt-in", async () => {
  const engine = createLegacyDummySignalEngine();
  const result = await engine.decide({
    bot: makeBot({
      paramsJson: {
        signalRuntime: {
          allowDummySignal: true
        }
      }
    }),
    now: new Date("2026-05-02T10:00:00.000Z")
  });

  assert.equal(result.metadata.blockedBySignal, false);
  assert.equal(result.legacyIntent.type, "none");
});

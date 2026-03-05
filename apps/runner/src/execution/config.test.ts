import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import {
  defaultExecutionSettings,
  readExecutionSettings,
  readExplicitExecutionModeFromBot
} from "./config.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_cfg_1",
    userId: "user_cfg_1",
    name: "Config test bot",
    symbol: "BTCUSDT",
    exchange: "bitget",
    exchangeAccountId: "acc_cfg_1",
    strategyKey: "dummy",
    marginMode: "isolated",
    leverage: 3,
    paramsJson: {},
    tickMs: 1000,
    credentials: {
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p"
    },
    marketData: {
      exchange: "bitget",
      exchangeAccountId: "acc_cfg_1",
      credentials: {
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p"
      }
    },
    ...overrides
  };
}

test("execution config uses defaults when execution params are missing", () => {
  const bot = makeBot();
  const settings = readExecutionSettings(bot);
  const defaults = defaultExecutionSettings();

  assert.equal(settings.mode, defaults.mode);
  assert.deepEqual(settings.common, defaults.common);
  assert.deepEqual(settings.simple, defaults.simple);
  assert.deepEqual(settings.dca, defaults.dca);
  assert.deepEqual(settings.grid, defaults.grid);
  assert.deepEqual(settings.dipReversion, defaults.dipReversion);
});

test("execution config maps legacy executionMode=futures_engine to simple", () => {
  const bot = makeBot({
    paramsJson: {
      executionMode: "futures_engine"
    }
  });

  assert.equal(readExplicitExecutionModeFromBot(bot), "simple");
  assert.equal(readExecutionSettings(bot).mode, "simple");
});

test("execution config accepts dip_reversion mode and dipReversion alias payload", () => {
  const bot = makeBot({
    paramsJson: {
      execution: {
        mode: "dip_reversion",
        dip_reversion: {
          dipTriggerPct: 4.2,
          maxReentriesPerDay: 5
        }
      }
    }
  });

  const settings = readExecutionSettings(bot);
  assert.equal(settings.mode, "dip_reversion");
  assert.equal(settings.dipReversion.dipTriggerPct, 4.2);
  assert.equal(settings.dipReversion.maxReentriesPerDay, 5);
});

test("execution config keeps maxTotalNotionalUsd >= maxNotionalPerSymbolUsd", () => {
  const bot = makeBot({
    paramsJson: {
      execution: {
        common: {
          maxNotionalPerSymbolUsd: 1500,
          maxTotalNotionalUsd: 1000
        }
      }
    }
  });

  const settings = readExecutionSettings(bot);
  assert.equal(settings.common.maxNotionalPerSymbolUsd, 1500);
  assert.equal(settings.common.maxTotalNotionalUsd, 1500);
});

test("prediction_copier ignores explicit execution mode in phase-1 behavior", () => {
  const bot = makeBot({
    strategyKey: "prediction_copier",
    paramsJson: {
      execution: {
        mode: "grid"
      }
    }
  });

  assert.equal(readExplicitExecutionModeFromBot(bot), null);
  assert.equal(readExecutionSettings(bot).mode, "simple");
});

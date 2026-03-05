import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import {
  EXECUTION_PLUGIN_ID_DCA,
  EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY,
  EXECUTION_PLUGIN_ID_PREDICTION_COPIER,
  EXECUTION_PLUGIN_ID_SIMPLE
} from "./builtin/executionPlugins.js";
import {
  SIGNAL_PLUGIN_ID_LEGACY_DUMMY,
  SIGNAL_PLUGIN_ID_PREDICTION_COPIER
} from "./builtin/signalPlugins.js";
import {
  SIGNAL_SOURCE_PLUGIN_ID_NONE,
  SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE
} from "./builtin/signalSourcePlugins.js";
import { resolveRunnerPluginsForBot } from "./resolution.js";

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Plugin resolution test bot",
    symbol: "BTCUSDT",
    exchange: "bitget",
    exchangeAccountId: "acc_1",
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
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "k",
        apiSecret: "s",
        passphrase: "p"
      }
    },
    ...overrides
  };
}

test("plugin resolution falls back to legacy defaults without plugin config", () => {
  const resolved = resolveRunnerPluginsForBot(makeBot());
  assert.equal(resolved.signal.selectedPluginId, SIGNAL_PLUGIN_ID_LEGACY_DUMMY);
  assert.equal(resolved.execution.selectedPluginId, EXECUTION_PLUGIN_ID_SIMPLE);
  assert.equal(resolved.signalSource.selectedPluginId, SIGNAL_SOURCE_PLUGIN_ID_NONE);
});

test("plugin resolution honors enabled plugin list with ordering", () => {
  const bot = makeBot({
    paramsJson: {
      plugins: {
        version: 1,
        enabled: [
          EXECUTION_PLUGIN_ID_PREDICTION_COPIER,
          SIGNAL_PLUGIN_ID_PREDICTION_COPIER
        ],
        order: [
          SIGNAL_PLUGIN_ID_PREDICTION_COPIER,
          EXECUTION_PLUGIN_ID_PREDICTION_COPIER
        ],
        policySnapshot: {
          plan: "pro",
          allowedPluginIds: null,
          evaluatedAt: new Date().toISOString()
        }
      }
    }
  });

  const resolved = resolveRunnerPluginsForBot(bot);
  assert.equal(resolved.signal.selectedPluginId, SIGNAL_PLUGIN_ID_PREDICTION_COPIER);
  assert.equal(resolved.execution.selectedPluginId, EXECUTION_PLUGIN_ID_PREDICTION_COPIER);
  assert.equal(resolved.signalSource.selectedPluginId, SIGNAL_SOURCE_PLUGIN_ID_NONE);
});

test("plugin resolution enforces policy snapshot and falls back", () => {
  const bot = makeBot({
    paramsJson: {
      plugins: {
        version: 1,
        enabled: [
          SIGNAL_PLUGIN_ID_PREDICTION_COPIER,
          EXECUTION_PLUGIN_ID_PREDICTION_COPIER
        ],
        policySnapshot: {
          plan: "free",
          allowedPluginIds: [
            SIGNAL_PLUGIN_ID_LEGACY_DUMMY,
            EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY
          ],
          evaluatedAt: new Date().toISOString()
        }
      }
    }
  });

  const resolved = resolveRunnerPluginsForBot(bot);
  assert.equal(resolved.signal.selectedPluginId, SIGNAL_PLUGIN_ID_LEGACY_DUMMY);
  assert.equal(resolved.execution.selectedPluginId, EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY);
  assert.equal(resolved.signalSource.selectedPluginId, SIGNAL_SOURCE_PLUGIN_ID_NONE);
  assert.equal(resolved.diagnostics.some((item) => item.type === "PLUGIN_DISABLED_BY_POLICY"), true);
});

test("plugin resolution prioritizes paramsJson.execution.mode for non-copier bots", () => {
  const resolved = resolveRunnerPluginsForBot(makeBot({
    paramsJson: {
      execution: {
        mode: "dca"
      },
      plugins: {
        version: 1,
        enabled: [
          EXECUTION_PLUGIN_ID_PREDICTION_COPIER
        ],
        order: [
          EXECUTION_PLUGIN_ID_PREDICTION_COPIER
        ],
        policySnapshot: {
          plan: "pro",
          allowedPluginIds: null,
          evaluatedAt: new Date().toISOString()
        }
      }
    }
  }));

  assert.equal(resolved.execution.selectedPluginId, EXECUTION_PLUGIN_ID_DCA);
});

test("plugin resolution defaults prediction copier signal source by strategy", () => {
  const resolved = resolveRunnerPluginsForBot(makeBot({
    strategyKey: "prediction_copier"
  }));
  assert.equal(resolved.signalSource.selectedPluginId, SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import {
  mapRiskEventToEnvelope,
  resetTelegramNotificationThrottleCache,
  resolveRunnerTelegramUserDestination
  ,
  shouldThrottleTelegramNotificationEvent
} from "./publisher.js";

function makeBot(): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    exchange: "hyperliquid",
    symbol: "BTCUSDT",
    exchangeAccountId: "acct_1",
    strategyKey: "futures_grid"
  } as ActiveFuturesBot;
}

test("mapRiskEventToEnvelope explains min-investment grid blocks with concrete values", () => {
  const event = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "EXECUTION_DECISION",
    message: "grid_entry_blocked_by_risk",
    meta: {
      status: "noop",
      reason: "grid_entry_blocked_by_risk",
      executionMetadata: {
        currentGridInvestUsd: 1.36,
        risk: {
          entryBlockedByMinInvestment: true,
          minInvestmentUSDT: 1.683333
        }
      }
    },
    now: new Date("2026-04-07T14:20:00.000Z")
  });

  assert.equal(event.type, "risk.guard_block");
  assert.equal(event.title, "Execution blocked");
  assert.equal(
    event.message,
    "Grid entry blocked: minimum grid investment 1.683 USDT exceeds current grid budget 1.36 USDT"
  );
});

test("mapRiskEventToEnvelope downgrades degraded primary plugin runtime errors", () => {
  const event = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "PLUGIN_RUNTIME_ERROR",
    message: "Error: hyperliquid_info_request_failed:429:null",
    meta: {
      stage: "primary",
      pluginId: "core.execution.futures_grid",
      health: {
        status: "degraded",
        consecutiveFailures: 1
      }
    },
    now: new Date("2026-04-07T14:20:00.000Z")
  });

  assert.equal(event.type, "warning.plugin_runtime_degraded");
  assert.equal(event.title, "Primary plugin degraded");
  assert.equal(event.severity, "warn");
  assert.equal(
    event.message,
    "Primary Hyperliquid market-data read rate-limited (429); fallback handling remains active"
  );
});

test("mapRiskEventToEnvelope marks BotVault liquidations critical and user-scoped", () => {
  const event = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "BOT_VAULT_LIQUIDATED",
    message: "bot_vault_liquidated",
    meta: {
      botVaultId: "bv_1",
      symbol: "BTCUSDT"
    },
    now: new Date("2026-04-07T14:20:00.000Z")
  });

  assert.equal(event.type, "vault.bot_vault_liquidated");
  assert.equal(event.category, "risk");
  assert.equal(event.severity, "critical");
  assert.equal(event.scope.userId, "user_1");
  assert.equal(event.scope.botId, "bot_1");
});

test("mapRiskEventToEnvelope maps grid TP and SL events", () => {
  const tp = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "GRID_TP_TRIGGERED",
    message: "grid take profit triggered",
    meta: {},
    now: new Date("2026-04-07T14:20:00.000Z")
  });
  const sl = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "GRID_SL_TRIGGERED",
    message: "grid stop loss triggered",
    meta: {},
    now: new Date("2026-04-07T14:20:00.000Z")
  });

  assert.equal(tp.type, "grid.take_profit_triggered");
  assert.equal(tp.category, "trade");
  assert.equal(sl.type, "grid.stop_loss_triggered");
  assert.equal(sl.category, "risk");
  assert.equal(sl.severity, "critical");
});

test("shouldThrottleTelegramNotificationEvent throttles repeated grid reconciliation blocks", () => {
  resetTelegramNotificationThrottleCache();
  const event = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "EXECUTION_DECISION",
    message: "grid_vault_balance_reconciliation_required",
    meta: {
      status: "blocked",
      reason: "grid_vault_balance_reconciliation_required"
    },
    now: new Date("2026-04-21T14:20:00.000Z")
  });

  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:20:00.000Z")), false);
  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:25:00.000Z")), true);
  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:51:00.000Z")), false);
});

test("shouldThrottleTelegramNotificationEvent throttles repeated futures-grid degradation alerts", () => {
  resetTelegramNotificationThrottleCache();
  const event = mapRiskEventToEnvelope({
    bot: makeBot(),
    type: "PLUGIN_RUNTIME_ERROR",
    message: "Error: hyperliquid_info_request_failed:429:null",
    meta: {
      stage: "primary",
      pluginId: "core.execution.futures_grid",
      health: {
        status: "degraded",
        consecutiveFailures: 1
      }
    },
    now: new Date("2026-04-21T14:20:00.000Z")
  });

  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:20:00.000Z")), false);
  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:30:00.000Z")), true);
  assert.equal(shouldThrottleTelegramNotificationEvent(event, Date.parse("2026-04-21T14:36:00.000Z")), false);
});

test("resolveRunnerTelegramUserDestination does not fall back to admin chat for user-scoped alerts", () => {
  const resolved = resolveRunnerTelegramUserDestination({
    envToken: "env-token",
    envChatId: "-100admin",
    configToken: "db-token",
    userChatId: null
  });

  assert.deepEqual(resolved, {
    botToken: "env-token",
    chatId: null
  });
});

test("resolveRunnerTelegramUserDestination preserves user chat when configured", () => {
  const resolved = resolveRunnerTelegramUserDestination({
    envToken: "env-token",
    envChatId: "-100admin",
    configToken: "db-token",
    userChatId: "-100user"
  });

  assert.deepEqual(resolved, {
    botToken: "env-token",
    chatId: "-100user"
  });
});

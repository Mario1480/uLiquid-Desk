import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot } from "../db.js";
import { mapRiskEventToEnvelope } from "./publisher.js";

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
    message: "HyperliquidAPIError: An unknown error occurred",
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
    "Primary Hyperliquid market-data read degraded; fallback handling remains active"
  );
});

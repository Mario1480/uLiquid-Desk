import assert from "node:assert/strict";
import test from "node:test";
import type { TradeIntent } from "@mm/futures-core";
import type { ExecutionCommonConfig } from "../config.js";
import {
  applyCommonIntentSafety,
  applyExecutionSuccessToState,
  evaluateExecutionGuardrails,
  normalizeExecutionModeState
} from "./guardrails.js";

function buildCommon(overrides: Partial<ExecutionCommonConfig> = {}): ExecutionCommonConfig {
  return {
    maxDailyExecutions: 10,
    cooldownSecAfterExecution: 0,
    maxNotionalPerSymbolUsd: null,
    maxTotalNotionalUsd: null,
    maxOpenPositions: 2,
    enforceReduceOnlyOnClose: true,
    ...overrides
  };
}

function openIntent(symbol = "BTCUSDT"): TradeIntent {
  return {
    type: "open",
    symbol,
    side: "long",
    order: {
      desiredNotionalUsd: 100
    }
  };
}

test("guardrails blocks while cooldown is active", () => {
  const now = new Date("2026-03-05T10:00:00.000Z");
  const state = normalizeExecutionModeState({
    cooldownUntil: "2026-03-05T10:05:00.000Z"
  }, now);

  const result = evaluateExecutionGuardrails({
    intent: openIntent(),
    common: buildCommon(),
    state,
    now
  });

  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.equal(result.reason, "execution_guard_cooldown_active");
});

test("guardrails blocks when projected open positions exceed maxOpenPositions", () => {
  const now = new Date("2026-03-05T10:00:00.000Z");
  const state = normalizeExecutionModeState({
    openPositionSymbols: ["ETHUSDT", "SOLUSDT"]
  }, now);

  const result = evaluateExecutionGuardrails({
    intent: openIntent("BTCUSDT"),
    common: buildCommon({ maxOpenPositions: 2 }),
    state,
    now
  });

  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.equal(result.reason, "execution_guard_max_open_positions_reached");
});

test("guardrails blocks when daily execution cap is reached", () => {
  const now = new Date("2026-03-05T10:00:00.000Z");
  const state = normalizeExecutionModeState({
    dailyExecutionDate: "2026-03-05",
    dailyExecutionCount: 5
  }, now);

  const result = evaluateExecutionGuardrails({
    intent: openIntent("BTCUSDT"),
    common: buildCommon({ maxDailyExecutions: 5 }),
    state,
    now
  });

  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.equal(result.reason, "execution_guard_max_daily_executions_reached");
});

test("guardrails enforces per-symbol notional limit", () => {
  const now = new Date("2026-03-05T10:00:00.000Z");
  const state = normalizeExecutionModeState({}, now);
  const result = evaluateExecutionGuardrails({
    intent: {
      type: "open",
      symbol: "BTCUSDT",
      side: "long",
      order: {
        desiredNotionalUsd: 1000
      }
    },
    common: buildCommon({ maxNotionalPerSymbolUsd: 500 }),
    state,
    now
  });

  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.equal(result.reason, "execution_guard_symbol_notional_limit");
});

test("applyCommonIntentSafety sets reduceOnly for close intents", () => {
  const intent: TradeIntent = {
    type: "close",
    symbol: "BTCUSDT",
    reason: "test_close",
    order: {}
  };

  const safeIntent = applyCommonIntentSafety(intent, buildCommon({ enforceReduceOnlyOnClose: true }));
  assert.equal(safeIntent.type, "close");
  if (safeIntent.type !== "close") return;
  assert.equal(safeIntent.order?.reduceOnly, true);
});

test("applyExecutionSuccessToState increments counters and applies cooldown", () => {
  const now = new Date("2026-03-05T10:00:00.000Z");
  const state = normalizeExecutionModeState({}, now);

  const next = applyExecutionSuccessToState({
    intent: openIntent("BTCUSDT"),
    common: buildCommon({ cooldownSecAfterExecution: 30 }),
    state,
    now
  });

  assert.equal(next.dailyExecutionDate, "2026-03-05");
  assert.equal(next.dailyExecutionCount, 1);
  assert.equal(next.openPositionSymbols.includes("BTCUSDT"), true);
  assert.ok(next.cooldownUntil);
});

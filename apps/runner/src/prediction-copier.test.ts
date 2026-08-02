import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveFuturesBot, BotTradeState, PredictionGateState } from "./db.js";
import {
  buildPredictionCopierIdempotencyKey,
  buildPredictionHash,
  classifyPredictionCopierFailure,
  computePredictionCopierCandidateNotionalUsd,
  evaluatePredictionCopierDecision,
  inferExternalCloseOutcome,
  isPredictionCopierGloballyEnabled,
  readPredictionCopierConfig,
  resolvePredictionCopierLeverage,
  resolveEntryTpSlPrices,
  type PredictionCopierConfig
} from "./prediction-copier.js";

test("prediction copier idempotency key is stable per rule, prediction and action", () => {
  const input = {
    botId: "bot_1",
    predictionStateId: "state_1",
    predictionHash: "prediction_hash_1",
    action: "enter" as const
  };
  assert.equal(buildPredictionCopierIdempotencyKey(input), buildPredictionCopierIdempotencyKey(input));
  assert.notEqual(
    buildPredictionCopierIdempotencyKey(input),
    buildPredictionCopierIdempotencyKey({ ...input, predictionHash: "prediction_hash_2" })
  );
  assert.notEqual(
    buildPredictionCopierIdempotencyKey(input),
    buildPredictionCopierIdempotencyKey({ ...input, action: "exit" })
  );
});

test("unknown order outcomes stay non-retryable for reconciliation", () => {
  assert.equal(classifyPredictionCopierFailure("exchange timeout after submit"), "unknown");
  assert.equal(classifyPredictionCopierFailure("order rejected: invalid qty"), "failed");
});

test("prediction copier global switch fails closed for disabled and kill switch values", () => {
  assert.equal(isPredictionCopierGloballyEnabled({}), true);
  assert.equal(isPredictionCopierGloballyEnabled({ PREDICTION_COPIER_ENABLED: "false" }), false);
  assert.equal(isPredictionCopierGloballyEnabled({ PREDICTION_COPIER_GLOBAL_KILL_SWITCH: "true" }), false);
});

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Prediction Copier",
    symbol: "BTCUSDT",
    exchange: "bitget",
    exchangeAccountId: "acc_1",
    strategyKey: "prediction_copier",
    marginMode: "isolated",
    leverage: 5,
    tickMs: 1000,
    paramsJson: {},
    credentials: {
      apiKey: "key",
      apiSecret: "secret",
      passphrase: "pass"
    },
    marketData: {
      exchange: "bitget",
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "key",
        apiSecret: "secret",
        passphrase: "pass"
      }
    },
    ...overrides
  };
}

function makeState(overrides: Partial<BotTradeState> = {}): BotTradeState {
  return {
    botId: "bot_1",
    symbol: "BTCUSDT",
    lastPredictionHash: null,
    lastSignal: null,
    lastSignalTs: null,
    lastTradeTs: null,
    dailyTradeCount: 0,
    dailyResetUtc: new Date("2026-02-12T00:00:00.000Z"),
    openSide: null,
    openQty: null,
    openEntryPrice: null,
    openTs: null,
    ...overrides
  };
}

function makePrediction(overrides: Partial<PredictionGateState> = {}): PredictionGateState {
  return {
    id: "state_1",
    exchange: "bitget",
    accountId: "acc_1",
    userId: "user_1",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    expectedMovePct: 1.2,
    confidence: 82,
    tags: ["trend_up"],
    tsUpdated: new Date("2026-02-12T12:00:00.000Z"),
    ...overrides
  };
}

function makeConfig(overrides: Partial<PredictionCopierConfig> = {}): PredictionCopierConfig {
  return {
    botType: "prediction_copier",
    exchange: "bitget",
    accountId: "acc_1",
    sourceStateId: null,
    sourceSnapshot: null,
    marketType: "perp",
    symbols: ["BTCUSDT"],
    timeframe: "15m",
    minConfidence: 70,
    maxPredictionAgeSec: 600,
    mode: "enter_exit",
    positionSizing: {
      type: "fixed_usd",
      value: 100
    },
    risk: {
      maxOpenPositions: 3,
      maxDailyTrades: 20,
      cooldownSecAfterTrade: 120,
      maxNotionalPerSymbolUsd: 500,
      maxTotalNotionalUsd: 1500,
      maxLeverage: 5,
      dailyLossLimitUsd: null,
      stopLossPct: null,
      takeProfitPct: null,
      timeStopMin: null
    },
    filters: {
      blockTags: ["data_gap", "low_liquidity"],
      newsRiskBlockEnabled: false,
      requireTags: null,
      allowSignals: ["up", "down"],
      minExpectedMovePct: null
    },
    execution: {
      orderType: "market",
      limitOffsetBps: 2,
      reduceOnlyOnExit: true
    },
    exit: {
      onSignalFlip: false,
      onConfidenceDrop: false
    },
    controls: {
      userEnabled: true
    },
    ...overrides
  };
}

test("readPredictionCopierConfig returns safe defaults", () => {
  const cfg = readPredictionCopierConfig(makeBot());
  assert.equal(cfg.botType, "prediction_copier");
  assert.equal(cfg.exchange, "bitget");
  assert.equal(cfg.timeframe, "15m");
  assert.equal(cfg.positionSizing.type, "fixed_usd");
  assert.equal(cfg.positionSizing.value, 100);
  assert.deepEqual(cfg.filters.allowSignals, ["up", "down"]);
  assert.equal(cfg.exit.onSignalFlip, false);
  assert.equal(cfg.exit.onConfidenceDrop, false);
});

test("readPredictionCopierConfig supports paper execution exchange", () => {
  const cfg = readPredictionCopierConfig(
    makeBot({
      exchange: "paper"
    })
  );
  assert.equal(cfg.exchange, "paper");
});

test("readPredictionCopierConfig keeps sourceStateId and sourceSnapshot", () => {
  const cfg = readPredictionCopierConfig(
    makeBot({
      paramsJson: {
        predictionCopier: {
          sourceStateId: "state_123",
          sourceSnapshot: {
            symbol: "BTCUSDT",
            timeframe: "15m",
            strategyRef: "local:baseline-v1"
          }
        }
      }
    })
  );
  assert.equal(cfg.sourceStateId, "state_123");
  assert.equal(cfg.sourceSnapshot?.symbol, "BTCUSDT");
});

test("readPredictionCopierConfig treats non-positive timeStopMin as disabled", () => {
  const cfg = readPredictionCopierConfig(
    makeBot({
      paramsJson: {
        predictionCopier: {
          risk: {
            timeStopMin: 0
          }
        }
      }
    })
  );
  assert.equal(cfg.risk.timeStopMin, null);
});

test("readPredictionCopierConfig reads explicit exit toggles", () => {
  const cfg = readPredictionCopierConfig(
    makeBot({
      paramsJson: {
        predictionCopier: {
          exit: {
            onSignalFlip: true,
            onConfidenceDrop: true
          }
        }
      }
    })
  );
  assert.equal(cfg.exit.onSignalFlip, true);
  assert.equal(cfg.exit.onConfidenceDrop, true);
});

test("base leverage remains effective even when legacy risk.maxLeverage is present", () => {
  const bot = makeBot({
    leverage: 10,
    paramsJson: {
      predictionCopier: {
        risk: {
          maxLeverage: 2
        }
      }
    }
  });

  const cfg = readPredictionCopierConfig(bot);
  assert.equal(cfg.risk.maxOpenPositions, 3);
  assert.equal(resolvePredictionCopierLeverage(bot.leverage), 10);
});

test("candidate notional scales equity sizing with leverage", () => {
  const candidate = computePredictionCopierCandidateNotionalUsd({
    config: makeConfig({
      positionSizing: {
        type: "equity_pct",
        value: 100
      }
    }),
    accountEquity: 10_000,
    leverage: 7.5
  });
  assert.equal(candidate, 70_000);
});

test("candidate notional uses leverage floor of 1", () => {
  const candidate = computePredictionCopierCandidateNotionalUsd({
    config: makeConfig({
      positionSizing: {
        type: "fixed_usd",
        value: 250
      }
    }),
    accountEquity: 10_000,
    leverage: 0
  });
  assert.equal(candidate, 250);
});

test("buildPredictionHash is deterministic", () => {
  const prediction = makePrediction();
  const h1 = buildPredictionHash(prediction);
  const h2 = buildPredictionHash(prediction);
  assert.equal(h1, h2);
});

test("decision enters on fresh up signal when flat", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();
  const hash = buildPredictionHash(prediction);

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: hash,
    state: makeState(),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "enter");
  if (decision.action === "enter") {
    assert.equal(decision.side, "long");
  }
});

test("decision rejects a cross-user prediction even when all market gates pass", () => {
  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    expectedUserId: "user_1",
    expectedAccountId: "acc_1",
    now: new Date("2026-02-12T12:01:00.000Z"),
    prediction: makePrediction({ userId: "user_2" }),
    predictionHash: "cross_user_hash",
    state: makeState(),
    openPosition: null,
    openTradeCount: 0,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });
  assert.deepEqual(decision, { action: "skip", reason: "prediction_owner_mismatch" });
});

test("AI-shaped prediction metadata cannot override deterministic notional risk gates", () => {
  const prediction = {
    ...makePrediction(),
    riskGateOverride: { allow: true },
    requestedAction: "place_order"
  } as PredictionGateState;
  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    expectedUserId: "user_1",
    expectedAccountId: "acc_1",
    now: new Date("2026-02-12T12:01:00.000Z"),
    prediction,
    predictionHash: "ai_override_hash",
    state: makeState(),
    openPosition: null,
    openTradeCount: 0,
    openPositionsCount: 0,
    totalNotionalUsd: 1_450,
    symbolNotionalUsd: 450,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });
  assert.deepEqual(decision, { action: "skip", reason: "symbol_notional_cap_reached" });
});

test("decision blocks and signals auto-pause after the daily loss limit", () => {
  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({
      risk: {
        ...makeConfig().risk,
        dailyLossLimitUsd: 100
      }
    }),
    now: new Date("2026-02-12T12:01:00.000Z"),
    prediction: makePrediction(),
    predictionHash: "hash_daily_loss",
    state: makeState(),
    openPosition: null,
    openTradeCount: 0,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0,
    dailyRealizedPnlUsd: -100
  });

  assert.deepEqual(decision, { action: "skip", reason: "daily_loss_limit_reached" });
});

test("decision keeps long open when signal flips down and exit toggle is disabled", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "down" });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "signal_flip");
});

test("decision exits long when signal flips down and exit toggle is enabled", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "down" });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({
      exit: {
        onSignalFlip: true,
        onConfidenceDrop: false
      }
    }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "exit");
  if (decision.action === "exit") {
    assert.equal(decision.side, "long");
  }
});

test("decision keeps open position when confidence drops below min", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "up", confidence: 55 });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({ minConfidence: 70 }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openTradeCount: 1,
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "confidence_below_min");
});

test("decision exits open position when confidence drops and exit toggle is enabled", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "up", confidence: 55 });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({
      minConfidence: 70,
      exit: {
        onSignalFlip: false,
        onConfidenceDrop: true
      }
    }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openTradeCount: 1,
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "exit");
  assert.equal(decision.reason, "confidence_below_min");
});

test("decision keeps open position when signal turns neutral", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "neutral", confidence: 82 });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({
      exit: {
        onSignalFlip: true,
        onConfidenceDrop: false
      }
    }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openTradeCount: 1,
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "signal_neutral");
});

test("decision blocks duplicate prediction hash", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();
  const hash = buildPredictionHash(prediction);

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: hash,
    state: makeState({ lastPredictionHash: hash }),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "duplicate_prediction_hash");
});

test("decision blocks cooldown after recent trade", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction();

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ lastTradeTs: new Date("2026-02-12T12:00:15.000Z") }),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "cooldown_active");
});

test("decision does not time-stop when timeStopMin is zero and may scale in", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ signal: "up", confidence: 82 });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig({
      risk: {
        ...makeConfig().risk,
        timeStopMin: 0
      }
    }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:00:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:00:00.000Z") },
    openTradeCount: 1,
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "enter");
  assert.equal(decision.reason, "scale_in_aligned_position");
});

test("decision blocks blocked tags", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ tags: ["data_gap"] });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState(),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "blocked_tag:data_gap");
});

test("decision keeps open position when blocked tags are present", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ tags: ["data_gap"] });

  const decision = evaluatePredictionCopierDecision({
    config: makeConfig(),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState({ openSide: "long", openTs: new Date("2026-02-12T11:50:00.000Z") }),
    openPosition: { side: "long", size: 0.01, openTs: new Date("2026-02-12T11:50:00.000Z") },
    openTradeCount: 1,
    openPositionsCount: 1,
    totalNotionalUsd: 100,
    symbolNotionalUsd: 100,
    candidateNotionalUsd: 100,
    dailyTradeCount: 1
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "blocked_tag:data_gap");
});

test("decision blocks news_risk only when newsRiskBlockEnabled is true", () => {
  const now = new Date("2026-02-12T12:01:00.000Z");
  const prediction = makePrediction({ tags: ["news_risk"] });

  const blocked = evaluatePredictionCopierDecision({
    config: makeConfig({
      filters: {
        ...makeConfig().filters,
        blockTags: ["news_risk", "data_gap"],
        newsRiskBlockEnabled: true
      }
    }),
    now,
    prediction,
    predictionHash: buildPredictionHash(prediction),
    state: makeState(),
    openPosition: null,
    openPositionsCount: 0,
    totalNotionalUsd: 0,
    symbolNotionalUsd: 0,
    candidateNotionalUsd: 100,
    dailyTradeCount: 0
  });
  assert.equal(blocked.action, "skip");
  assert.equal(blocked.reason, "blocked_tag:news_risk");
});

test("resolveEntryTpSlPrices falls back to prediction levels when config tp/sl is empty", () => {
  const resolved = resolveEntryTpSlPrices({
    side: "short",
    referencePrice: 66_000,
    stopLossPct: null,
    takeProfitPct: null,
    predictionStopLossPrice: 66_400,
    predictionTakeProfitPrice: 65_400
  });

  assert.equal(resolved.stopLossPrice, 66_400);
  assert.equal(resolved.takeProfitPrice, 65_400);
});

test("resolveEntryTpSlPrices ignores prediction levels with wrong side direction", () => {
  const resolved = resolveEntryTpSlPrices({
    side: "short",
    referencePrice: 66_000,
    stopLossPct: null,
    takeProfitPct: null,
    predictionStopLossPrice: 65_900,
    predictionTakeProfitPrice: 66_100
  });

  assert.equal(resolved.stopLossPrice, undefined);
  assert.equal(resolved.takeProfitPrice, undefined);
});

test("inferExternalCloseOutcome maps long SL hit", () => {
  const inferred = inferExternalCloseOutcome({
    side: "long",
    markPrice: 64_900,
    tpPrice: 66_500,
    slPrice: 65_000
  });
  assert.equal(inferred.outcome, "sl_hit");
  assert.equal(inferred.reason, "sl_hit_external");
});

test("inferExternalCloseOutcome maps short TP hit", () => {
  const inferred = inferExternalCloseOutcome({
    side: "short",
    markPrice: 64_900,
    tpPrice: 65_000,
    slPrice: 66_500
  });
  assert.equal(inferred.outcome, "tp_hit");
  assert.equal(inferred.reason, "tp_hit_external");
});

test("inferExternalCloseOutcome falls back to unknown when levels not hit", () => {
  const inferred = inferExternalCloseOutcome({
    side: "short",
    markPrice: 66_000,
    tpPrice: 65_000,
    slPrice: 67_000
  });
  assert.equal(inferred.outcome, "unknown");
  assert.equal(inferred.reason, "position_closed_external");
});

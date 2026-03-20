import assert from "node:assert/strict";
import test from "node:test";
import { runCompositeStrategy } from "./runner.js";

const baseFeatureSnapshot = {
  tags: ["trend_up"],
  historyContext: {
    reg: {
      state: "trend_up",
      conf: 70,
      since: "2026-02-15T10:00:00.000Z",
      why: ["ema_stack_bull"]
    },
    ema: {
      stk: "bull"
    }
  }
};

const basePrediction = {
  signal: "up" as const,
  confidence: 68,
  expectedMovePct: 1.2,
  symbol: "BTCUSDT",
  marketType: "perp" as const,
  timeframe: "15m" as const,
  tsCreated: "2026-02-15T12:00:00.000Z"
};

test("pipeline execution order follows topological graph", async () => {
  const executionOrder: string[] = [];
  const result = await runCompositeStrategy({
    compositeId: "comp_1",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_a" },
      { id: "n2", kind: "local", refId: "local_b" },
      { id: "n3", kind: "local", refId: "local_c" }
    ],
    edgesJson: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" }
    ],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => ({ exists: true, version: "1.0.0" }),
    runLocalStrategyFn: async (refId) => {
      executionOrder.push(refId);
      return {
        strategyId: refId,
        strategyType: "regime_gate",
        strategyName: refId,
        version: "1.0.0",
        isEnabled: true,
        allow: true,
        score: 70,
        reasonCodes: [],
        tags: [refId],
        explanation: `ok:${refId}`,
        configHash: "cfg",
        snapshotHash: `snap:${refId}`,
        meta: {}
      };
    }
  });

  assert.deepEqual(executionOrder, ["local_a", "local_b", "local_c"]);
  assert.equal(result.validation.valid, true);
  assert.equal(result.decisionTrace.executedNodeIds.length, 3);
});

test("merge policy first_non_neutral picks first non-neutral node output", async () => {
  const result = await runCompositeStrategy({
    compositeId: "comp_2",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "block" },
      { id: "n2", kind: "ai", refId: "prompt_1" }
    ],
    edgesJson: [{ from: "n1", to: "n2" }],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => ({ exists: true, version: "1.0.0" }),
    resolveAiPromptRef: async () => true,
    runLocalStrategyFn: async () => ({
      strategyId: "block",
      strategyType: "signal_filter",
      strategyName: "block",
      version: "1",
      isEnabled: true,
      allow: false,
      score: 20,
      reasonCodes: ["blocked"],
      tags: ["blocked"],
      explanation: "blocked",
      configHash: "cfg",
      snapshotHash: "snap",
      meta: {}
    }),
    shouldInvokeAiExplainFn: () => ({
      allow: true,
      reasonCodes: ["signal_flip"],
      priority: "high",
      recommendedCooldownSec: 240,
      predictionHash: "pred",
      historyHash: "hist",
      decisionHash: "dec",
      state: {
        windowStartedAt: new Date("2026-02-15T11:00:00.000Z"),
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      }
    }),
    getRuntimePromptSettingsByTemplateId: async () => ({
      promptText: "",
      indicatorKeys: [],
      ohlcvBars: 100,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      promptMode: "trading_explainer" as const,
      marketAnalysisUpdateEnabled: false,
      source: "db",
      activePromptId: "prompt_1",
      activePromptName: "Prompt",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }),
    generatePredictionExplanationFn: async () => ({
      explanation: "ai says up",
      tags: ["trend_up"],
      keyDrivers: [{ name: "historyContext.reg.state", value: "trend_up" }],
      aiPrediction: { signal: "up", confidence: 0.81, expectedMovePct: 1.5 },
      disclaimer: "grounded_features_only"
    })
  });

  assert.equal(result.signal, "up");
  assert.equal(result.aiCallsUsed, 1);
  assert.equal(result.tags.includes("trend_up"), true);
  assert.equal(result.predictionOutput.signalSource, "ai");
  assert.equal(result.predictionOutput.expectedMovePct, 1.5);
});

test("AI nodes respect gating and max AI call budget", async () => {
  let aiCalls = 0;
  const result = await runCompositeStrategy({
    compositeId: "comp_3",
    combineMode: "pipeline",
    outputPolicy: "override_by_confidence",
    nodesJson: [
      { id: "a1", kind: "ai", refId: "prompt_1" },
      { id: "a2", kind: "ai", refId: "prompt_2" }
    ],
    edgesJson: [{ from: "a1", to: "a2" }],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveAiPromptRef: async () => true,
    shouldInvokeAiExplainFn: ({ prediction }) => ({
      allow: prediction.signal !== "neutral",
      reasonCodes: prediction.signal !== "neutral" ? ["signal_flip"] : ["no_actionable_change"],
      priority: "high",
      recommendedCooldownSec: 240,
      predictionHash: "pred",
      historyHash: "hist",
      decisionHash: `dec:${prediction.signal}`,
      state: {
        windowStartedAt: new Date("2026-02-15T11:00:00.000Z"),
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      }
    }),
    getRuntimePromptSettingsByTemplateId: async ({ templateId }) => ({
      promptText: "",
      indicatorKeys: [],
      ohlcvBars: 100,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      promptMode: "trading_explainer" as const,
      marketAnalysisUpdateEnabled: false,
      source: "db",
      activePromptId: templateId ?? "prompt",
      activePromptName: "Prompt",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }),
    generatePredictionExplanationFn: async () => {
      aiCalls += 1;
      return {
        explanation: "ai output",
        tags: ["trend_up"],
        keyDrivers: [],
        aiPrediction: { signal: "up", confidence: 0.8, expectedMovePct: 1.2 },
        disclaimer: "grounded_features_only"
      };
    }
  });

  assert.equal(aiCalls, 1);
  assert.equal(result.aiCallsUsed, 1);
  const second = result.nodes.find((item) => item.nodeId === "a2");
  assert.equal(second?.executed, false);
  assert.equal(second?.skippedReason, "ai_call_budget_exceeded");
});

test("vote mode handles branching graphs with conflicting signals and emits decision trace", async () => {
  const result = await runCompositeStrategy({
    compositeId: "comp_vote",
    combineMode: "vote",
    outputPolicy: "override_by_confidence",
    nodesJson: [
      { id: "l1", kind: "local", refId: "long_bias", refVersion: "1.0.0" },
      { id: "l2", kind: "local", refId: "short_bias", refVersion: "1.0.0" },
      { id: "a1", kind: "ai", refId: "prompt_vote" }
    ],
    edgesJson: [
      { from: "l1", to: "a1" },
      { from: "l2", to: "a1" }
    ],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => ({ exists: true, version: "1.0.0" }),
    resolveAiPromptRef: async () => true,
    runLocalStrategyFn: async (refId) => ({
      strategyId: refId,
      strategyType: refId,
      strategyName: refId,
      version: "1.0.0",
      isEnabled: true,
      allow: refId === "long_bias",
      score: refId === "long_bias" ? 72 : 88,
      reasonCodes: [refId],
      tags: [refId],
      explanation: refId,
      configHash: "cfg",
      snapshotHash: "snap",
      meta: {}
    }),
    shouldInvokeAiExplainFn: () => ({
      allow: true,
      reasonCodes: ["signal_flip"],
      priority: "high",
      recommendedCooldownSec: 240,
      predictionHash: "pred",
      historyHash: "hist",
      decisionHash: "dec",
      state: {
        windowStartedAt: new Date("2026-02-15T11:00:00.000Z"),
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      }
    }),
    getRuntimePromptSettingsByTemplateId: async () => ({
      promptText: "",
      indicatorKeys: [],
      ohlcvBars: 100,
      timeframe: null,
      directionPreference: "either",
      confidenceTargetPct: 60,
      promptMode: "trading_explainer" as const,
      marketAnalysisUpdateEnabled: false,
      source: "db",
      activePromptId: "prompt_vote",
      activePromptName: "Vote Prompt",
      selectedFrom: "active_prompt",
      matchedScopeType: null,
      matchedOverrideId: null
    }),
    generatePredictionExplanationFn: async () => ({
      explanation: "ai says down",
      tags: ["trend_down"],
      keyDrivers: [{ name: "ai.vote", value: "down" }],
      aiPrediction: { signal: "down", confidence: 0.91, expectedMovePct: 1.7 },
      disclaimer: "grounded_features_only"
    })
  });

  assert.equal(result.signal, "down");
  assert.equal(result.decisionTrace.combineMode, "vote");
  assert.equal(result.decisionTrace.conflictingSignals.includes("up"), true);
  assert.equal(result.decisionTrace.conflictingSignals.includes("down"), true);
  assert.equal(result.predictionOutput.selectedNodeId, "a1");
});

test("missing local strategy version fails validation before execution", async () => {
  const result = await runCompositeStrategy({
    compositeId: "comp_missing_version",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_1", refVersion: "1.0.0" }
    ],
    edgesJson: [],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => ({ exists: true, version: null })
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.errors.includes("node_ref_version_missing:local:local_1"), true);
  assert.equal(result.nodes.length, 0);
});

test("partial node failure is recorded and downstream branch is skipped", async () => {
  const result = await runCompositeStrategy({
    compositeId: "comp_partial_failure",
    combineMode: "pipeline",
    outputPolicy: "first_non_neutral",
    nodesJson: [
      { id: "n1", kind: "local", refId: "local_fail", refVersion: "1.0.0" },
      { id: "n2", kind: "local", refId: "local_after", refVersion: "1.0.0" }
    ],
    edgesJson: [{ from: "n1", to: "n2" }],
    featureSnapshot: baseFeatureSnapshot,
    basePrediction
  }, {
    resolveLocalStrategyRef: async () => ({ exists: true, version: "1.0.0" }),
    runLocalStrategyFn: async (refId) => {
      if (refId === "local_fail") {
        throw new Error("missing_local_strategy_version");
      }
      return {
        strategyId: refId,
        strategyType: refId,
        strategyName: refId,
        version: "1.0.0",
        isEnabled: true,
        allow: true,
        score: 80,
        reasonCodes: [],
        tags: [],
        explanation: "ok",
        configHash: "cfg",
        snapshotHash: "snap",
        meta: {}
      };
    }
  });

  const failed = result.nodes.find((item) => item.nodeId === "n1");
  const skipped = result.nodes.find((item) => item.nodeId === "n2");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.diagnostics[0]?.code, "local_node_execution_failed");
  assert.equal(skipped?.status, "skipped");
  assert.equal(skipped?.skippedReason, "dependency_failed:n1");
  assert.equal(result.decisionTrace.failedNodeIds.includes("n1"), true);
});

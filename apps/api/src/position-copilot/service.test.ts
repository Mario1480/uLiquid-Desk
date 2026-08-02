import assert from "node:assert/strict";
import test from "node:test";
import { resetAiAnalyzerState } from "../ai/analyzer.js";
import { buildPositionCopilotSnapshot } from "./core.js";
import { analyzePositionSnapshot, POSITION_COPILOT_TOOLS } from "./service.js";

function snapshot() {
  return buildPositionCopilotSnapshot({
    exchangeAccountId: "acc_1",
    exchange: "bitget",
    marketType: "perp",
    symbol: "BTCUSDT",
    side: "long",
    size: 0.1,
    entryPrice: 65_000,
    markPrice: 64_000,
    unrealizedPnlUsd: -100,
    leverage: 5,
    marginMode: "isolated",
    marginUsd: 1_280,
    notionalUsd: 6_400,
    liquidationPrice: 61_000,
    liquidationDistancePct: 4.6875,
    roePct: -7.8,
    pnlPct: -1.56,
    stopLossPrice: 62_500,
    takeProfitPrice: 68_000,
    observedAt: "2026-08-02T12:00:00.000Z"
  });
}

test("Position Copilot exposes no AI tools and forces toolChoice none", async () => {
  resetAiAnalyzerState();
  assert.deepEqual(POSITION_COPILOT_TOOLS, []);
  let capturedOptions: any = null;
  const result = await analyzePositionSnapshot({
    snapshot: snapshot(),
    userId: "user_1",
    callAiChat: async (_messages, options) => {
      capturedOptions = options;
      return {
        content: JSON.stringify({
          summary: "Critical risk remains visible in the supplied snapshot.",
          thesisStatus: "invalidated",
          riskLevel: "critical",
          riskFactors: [],
          events: []
        }),
        toolCalls: [],
        usage: {},
        model: "test-model",
        provider: "openai",
        finishReason: "stop"
      };
    }
  });
  assert.deepEqual(capturedOptions.tools, []);
  assert.equal(capturedOptions.toolChoice, "none");
  assert.equal(result.analysis.readOnly, true);
});

test("unexpected AI tool calls are rejected and fall back to deterministic analysis", async () => {
  resetAiAnalyzerState();
  const result = await analyzePositionSnapshot({
    snapshot: snapshot(),
    userId: "user_2",
    callAiChat: async () => ({
      content: "{}",
      toolCalls: [{ id: "call_1", name: "close_position", argumentsText: "{}" }],
      usage: {},
      model: "test-model",
      provider: "openai",
      finishReason: "tool_calls"
    })
  });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.analysis.readOnly, true);
  assert.equal(result.analysis.riskLevel, "critical");
});

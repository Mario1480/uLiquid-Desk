import assert from "node:assert/strict";
import test from "node:test";
import { resetAiAnalyzerState } from "../ai/analyzer.js";
import { buildPositionCopilotSnapshot } from "./core.js";
import { analyzePositionSnapshot, POSITION_COPILOT_TOOLS } from "./service.js";
import { buildMarketFeatureContext } from "../ai/features/context.js";
import { evaluateMarketFeature } from "../ai/features/registry.js";
import { storedFeatureEvidence, type MarketSnapshotEvidence } from "../ai/features/evidence.js";

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

test("market features and cached explanations retain original evidence and deterministic risk", async () => {
  resetAiAnalyzerState();
  const feature = evaluateMarketFeature("derivatives.funding-snapshot", { rate: 0, fundingIntervalHours: null }, `mds_${"a".repeat(64)}`);
  const source: MarketSnapshotEvidence = { id: feature.ref.inputSnapshotId, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0",
    market: { providerId: "uliquid-native:bitget", sourceVenue: "bitget", marketType: "perp", symbol: "BTCUSDT" }, dataset: "derivatives", interval: null, limit: null,
    observedAt: null, fetchedAt: "2026-09-05T10:00:00.000Z", ageMs: null, quality: "degraded", warningCodes: ["provider_timestamp_missing"], atomicObservation: false };
  const context = buildMarketFeatureContext([source], [storedFeatureEvidence(feature.ref, feature.value, feature.routineVersions)]);
  let loads = 0, calls = 0;
  const params = { snapshot: snapshot(), userId: "feature-user", loadMarketContext: async () => { loads++; return context; },
    callAiChat: async (messages: any, options: any) => {
      calls++;
      assert.ok(JSON.stringify(messages).includes(feature.ref.snapshotId));
      assert.ok(JSON.stringify(messages).includes("provider_timestamp_missing"));
      assert.ok(JSON.stringify(messages).includes("deterministicRisk"));
      assert.deepEqual(options.tools, []); assert.equal(options.toolChoice, "none");
      assert.equal(options.billingUserId, "feature-user"); assert.equal(options.billingScope, "position_copilot");
      return { content: JSON.stringify({ summary: "Snapshot-only context.", thesisStatus: "unknown", riskLevel: "low", riskFactors: [], events: [] }), toolCalls: [], usage: {}, model: "test", provider: "openai" as const, finishReason: "stop" };
    } };
  const first = await analyzePositionSnapshot(params);
  assert.equal(first.analysis.riskLevel, "critical");
  first.marketContext!.snapshotManifest[0].fetchedAt = "mutated";
  const second = await analyzePositionSnapshot(params);
  assert.equal(second.cacheHit, true); assert.equal(loads, 1); assert.equal(calls, 1);
  assert.equal(second.marketContext!.snapshotManifest[0].fetchedAt, source.fetchedAt);
  assert.equal(second.analysis.snapshotHash, first.analysis.snapshotHash);
});

test("unavailable public context does not suppress AI explanation or deterministic fallback", async () => {
  resetAiAnalyzerState();
  const result = await analyzePositionSnapshot({ snapshot: snapshot(), userId: "context-failure",
    loadMarketContext: async () => { throw new Error("private-error"); },
    callAiChat: async messages => {
      assert.ok(JSON.stringify(messages).includes("market_context_unavailable"));
      assert.ok(!JSON.stringify(messages).includes("private-error"));
      throw new Error("test_ai_unavailable");
    } });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.analysis.riskLevel, "critical");
  assert.equal(result.marketContext, null);
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

test("findings deduplicate stable codes, known stop-loss aliases and identical text without lowering severity", async () => {
  resetAiAnalyzerState();
  const position = { ...snapshot(), stopLossPrice: null };
  const result = await analyzePositionSnapshot({ snapshot: position, userId: "dedupe-owner", language: "en",
    callAiChat: async messages => {
      assert.match(messages[0].content, /Return only additional findings/);
      return { content: JSON.stringify({ summary: "Existing deterministic warnings remain authoritative.", thesisStatus: "unknown", riskLevel: "low",
        riskFactors: [
          { code: "no_stop_loss", severity: "high", message: "No stop-loss is visible in the position snapshot." },
          { code: "stop_loss_missing", severity: "low", message: "The stop-loss is absent." },
          { code: "liquidation_distance_critical", severity: "low", message: "Duplicate low-severity wording." },
          { code: "book_thin", severity: "medium", message: "Book coverage is limited." },
          { code: "book_coverage", severity: "low", message: "Book coverage is limited!" },
          { code: "other_risk", severity: "medium", message: "Independent context is unavailable." }
        ], events: [
          { code: "liquidation_proximity", severity: "low", message: "Duplicate event wording." },
          { code: "context_changed", severity: "medium", message: "A distinct change remains visible." }
        ] }), toolCalls: [], usage: {}, model: "fixture", provider: "openai" as const, finishReason: "stop" };
    } });
  assert.equal(result.analysis.riskLevel, "critical");
  assert.equal(result.analysis.riskFactors.filter(f => f.code === "stop_loss_missing").length, 1);
  const stop = result.analysis.riskFactors.find(f => f.code === "stop_loss_missing")!;
  assert.equal(stop.severity, "high");
  assert.equal(stop.message, "No stop-loss is visible in the snapshot.");
  assert.equal(result.analysis.riskFactors.filter(f => f.code === "liquidation_distance_critical").length, 1);
  assert.equal(result.analysis.riskFactors.find(f => f.code === "liquidation_distance_critical")!.severity, "critical");
  assert.equal(result.analysis.riskFactors.filter(f => f.code.startsWith("book_")).length, 1);
  assert.ok(result.analysis.riskFactors.some(f => f.code === "other_risk"));
  assert.equal(result.analysis.events.filter(f => f.code === "liquidation_proximity").length, 1);
  assert.ok(result.analysis.events.some(f => f.code === "context_changed"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalSchema, mapDecisionToSignal, sanitizeAgentSignalRaw } from "./agent.js";

test("mapDecisionToSignal maps long/short/no_trade to up/down/neutral", () => {
  assert.equal(mapDecisionToSignal("long"), "up");
  assert.equal(mapDecisionToSignal("short"), "down");
  assert.equal(mapDecisionToSignal("no_trade"), "neutral");
});

test("buildSignalSchema requires explanation by default", () => {
  const schema = buildSignalSchema();
  const required = Array.isArray((schema as any).required) ? (schema as any).required : [];
  assert.equal(required.includes("explanation"), true);
});

test("buildSignalSchema applies custom explanation min length", () => {
  const schema = buildSignalSchema({
    explanationRequired: true,
    explanationMinLength: 420
  });
  const explanation = (schema as any)?.properties?.explanation ?? {};
  assert.equal(explanation.minLength, 420);
});

test("sanitizeAgentSignalRaw maps legacy aiPrediction output into agent fields", () => {
  const sanitized = sanitizeAgentSignalRaw({
    explanation: "Breakout setup with improving momentum.",
    aiPrediction: {
      signal: "up",
      confidence: 72
    },
    levels: {
      entry: 101.5,
      stopLoss: 99.1,
      takeProfit: 106.2
    }
  }) as any;

  assert.equal(sanitized.decision, "long");
  assert.equal(sanitized.confidence, 0.72);
  assert.equal(sanitized.reason, "Breakout setup with improving momentum.");
  assert.equal(sanitized.explanation, "Breakout setup with improving momentum.");
  assert.equal(sanitized.entry, 101.5);
  assert.equal(sanitized.stop_loss, 99.1);
  assert.equal(sanitized.take_profit, 106.2);
});

test("sanitizeAgentSignalRaw maps top-level signal aliases into decision", () => {
  const sanitized = sanitizeAgentSignalRaw({
    signal: "neutral",
    confidence: 55,
    reason: "No clean edge."
  }) as any;

  assert.equal(sanitized.decision, "no_trade");
  assert.equal(sanitized.confidence, 0.55);
});

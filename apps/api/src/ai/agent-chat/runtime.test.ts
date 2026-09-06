import assert from "node:assert/strict";
import test from "node:test";
import { toAgentChatError } from "./errors.js";
import { resolveBuiltinAgentProfile } from "./profiles.js";
import { FEATURE_CONTEXT_POLICY } from "../features/context.js";
import {
  AGENT_CHAT_RESPONSE_FORMAT,
  buildSystemMessage,
  resolveAgentChatReservationRouting,
  resolveAgentRunTimeoutMs
} from "./runtime.js";

test("both read-only profiles explicitly consume versioned, source-aware snapshot features", () => {
  for (const key of ["market_analyst", "position_copilot"] as const) {
    const message = buildSystemMessage(resolveBuiltinAgentProfile(key), "en", key === "market_analyst" ? "agent_market" : "agent_position");
    assert.ok(message.includes(FEATURE_CONTEXT_POLICY));
    assert.match(message, /snapshot features contain no history/);
    assert.match(message, /validated derivatives.history-summary/);
    assert.match(message, /do not recalculate or replace null values/);
    assert.match(message, /Never claim to execute/);
  }
});

test("agent chat run timeout leaves enough time for provider and tool iterations", () => {
  assert.equal(resolveAgentRunTimeoutMs(undefined), 90_000);
  assert.equal(resolveAgentRunTimeoutMs("120000"), 120_000);
  assert.equal(resolveAgentRunTimeoutMs("1000"), 30_000);
  assert.equal(resolveAgentRunTimeoutMs("999999"), 180_000);
  assert.equal(resolveAgentRunTimeoutMs("invalid"), 90_000);
});

test("agent chat credit reservation uses the tighter runtime budget", () => {
  const routing = resolveAgentChatReservationRouting({
    modelClass: "analysis",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    maxOutputTokens: 10_000,
    maxToolRounds: 8,
    reasonCode: "multi_source_analysis"
  });

  assert.equal(routing.maxOutputTokens, 6_000);
  assert.equal(routing.maxToolRounds, 4);
});

test("agent chat preserves lower router limits for reservation and execution", () => {
  const routing = {
    modelClass: "standard" as const,
    model: "gpt-5.6-luna",
    reasoningEffort: "low" as const,
    maxOutputTokens: 3_000,
    maxToolRounds: 2,
    reasonCode: "standard_agent"
  };
  assert.deepEqual(resolveAgentChatReservationRouting(routing), routing);
});

test("agent chat requests a JSON object envelope from the Responses API", () => {
  assert.equal(AGENT_CHAT_RESPONSE_FORMAT.type, "json_schema");
  assert.equal(AGENT_CHAT_RESPONSE_FORMAT.json_schema.name, "agent_chat_answer");
  assert.equal(AGENT_CHAT_RESPONSE_FORMAT.json_schema.strict, false);
  assert.deepEqual(
    (AGENT_CHAT_RESPONSE_FORMAT.json_schema.schema as any).required,
    ["content", "blocks", "citations"]
  );
});

test("position copilot does not require a symbol for full portfolio analysis", () => {
  const message = buildSystemMessage(resolveBuiltinAgentProfile("position_copilot"), "en", "agent_position");
  assert.match(message, /symbol is optional/i);
  assert.match(message, /risk_analyze_portfolio without a symbol/i);
});

test("provider aborts are returned as stable agent chat timeout errors", () => {
  const aborted = new Error("This operation was aborted");
  aborted.name = "AbortError";
  const normalized = toAgentChatError(aborted);
  assert.equal(normalized.code, "agent_chat_provider_unavailable");
  assert.equal(normalized.status, 503);
  assert.equal(normalized.message, "The AI provider timed out. Please try again.");
});

test("empty provider responses are returned as stable retryable provider errors", () => {
  const normalized = toAgentChatError(new Error("ai_empty_response:finish_reason:length,completion_tokens:2200"));
  assert.equal(normalized.code, "agent_chat_provider_unavailable");
  assert.equal(normalized.status, 503);
  assert.equal(normalized.message, "The AI provider returned no usable answer. Please try again.");
});

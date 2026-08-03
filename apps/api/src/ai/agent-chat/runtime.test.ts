import assert from "node:assert/strict";
import test from "node:test";
import { toAgentChatError } from "./errors.js";
import { AGENT_CHAT_RESPONSE_FORMAT, resolveAgentRunTimeoutMs } from "./runtime.js";

test("agent chat run timeout leaves enough time for provider and tool iterations", () => {
  assert.equal(resolveAgentRunTimeoutMs(undefined), 90_000);
  assert.equal(resolveAgentRunTimeoutMs("120000"), 120_000);
  assert.equal(resolveAgentRunTimeoutMs("1000"), 30_000);
  assert.equal(resolveAgentRunTimeoutMs("999999"), 180_000);
  assert.equal(resolveAgentRunTimeoutMs("invalid"), 90_000);
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

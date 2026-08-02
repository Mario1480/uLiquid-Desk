import assert from "node:assert/strict";
import test from "node:test";
import { toAgentChatError } from "./errors.js";
import { resolveAgentRunTimeoutMs } from "./runtime.js";

test("agent chat run timeout leaves enough time for provider and tool iterations", () => {
  assert.equal(resolveAgentRunTimeoutMs(undefined), 90_000);
  assert.equal(resolveAgentRunTimeoutMs("120000"), 120_000);
  assert.equal(resolveAgentRunTimeoutMs("1000"), 30_000);
  assert.equal(resolveAgentRunTimeoutMs("999999"), 180_000);
  assert.equal(resolveAgentRunTimeoutMs("invalid"), 90_000);
});

test("provider aborts are returned as stable agent chat timeout errors", () => {
  const aborted = new Error("This operation was aborted");
  aborted.name = "AbortError";
  const normalized = toAgentChatError(aborted);
  assert.equal(normalized.code, "agent_chat_provider_unavailable");
  assert.equal(normalized.status, 503);
  assert.equal(normalized.message, "The AI provider timed out. Please try again.");
});

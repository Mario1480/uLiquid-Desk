import assert from "node:assert/strict";
import test from "node:test";
import { agentAnswerEnvelopeSchema, conversationContextSchema, createMessageSchema } from "./schemas.js";

test("message and UI payloads are bounded", () => {
  assert.equal(createMessageSchema.safeParse({ content: "x".repeat(8_001), locale: "en" }).success, false);
  assert.equal(agentAnswerEnvelopeSchema.safeParse({ content: "ok", blocks: [{ type: "key_metrics", items: Array.from({ length: 13 }, (_, index) => ({ label: String(index), value: "x" })) }], citations: [] }).success, false);
});

test("conversation context keeps the symbol optional for portfolio-wide requests", () => {
  const context = conversationContextSchema.parse({ profileKey: "position_copilot", selectedExchangeAccountId: "acct_1" });
  assert.equal(context.symbol, null);
});

test("action draft blocks are rejected in the read-only MVP", () => {
  assert.equal(agentAnswerEnvelopeSchema.safeParse({ content: "ok", blocks: [{ type: "action_draft_card" }], citations: [] }).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { agentAnswerEnvelopeSchema, createMessageSchema } from "./schemas.js";

test("message and UI payloads are bounded", () => {
  assert.equal(createMessageSchema.safeParse({ content: "x".repeat(8_001), locale: "en" }).success, false);
  assert.equal(agentAnswerEnvelopeSchema.safeParse({ content: "ok", blocks: [{ type: "key_metrics", items: Array.from({ length: 13 }, (_, index) => ({ label: String(index), value: "x" })) }], citations: [] }).success, false);
});

test("action draft blocks are rejected in the read-only MVP", () => {
  assert.equal(agentAnswerEnvelopeSchema.safeParse({ content: "ok", blocks: [{ type: "action_draft_card" }], citations: [] }).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import { getAgentSkillByToolName, listAgentSkillDescriptors } from "./skills.js";

test("agent registry exposes only read-only, namespaced skills", () => {
  const skills = listAgentSkillDescriptors();
  assert.ok(skills.length >= 15);
  assert.equal(skills.every((skill) => skill.sideEffect === false), true);
  assert.equal(skills.every((skill) => skill.id.includes(".")), true);
  assert.equal(skills.some((skill) => /place|close|transfer|activate|write/.test(skill.id)), false);
  assert.equal(getAgentSkillByToolName("market_get_ticker")?.id, "market.get_ticker");
  assert.equal(getAgentSkillByToolName("place_order"), null);
});

test("agent tool schemas preserve optional arguments without strict provider validation", () => {
  const skills = listAgentSkillDescriptors();
  assert.equal(skills.every((skill) => skill.toolDefinition.function.strict !== true), true);

  const ohlcv = getAgentSkillByToolName("market_get_ohlcv");
  assert.ok(ohlcv);
  assert.deepEqual(ohlcv.toolDefinition.function.parameters.required, ["interval"]);
});

test("recursive redaction removes credentials from tool summaries", () => {
  const value = redactAiSafetySecrets({ nested: { apiSecret: "secret-value", authorization: "Bearer abcdefghijklmnop" } }) as any;
  assert.equal(value.nested.apiSecret, "[REDACTED]");
  assert.equal(value.nested.authorization, "[REDACTED]");
});

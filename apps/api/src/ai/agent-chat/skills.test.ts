import assert from "node:assert/strict";
import test from "node:test";
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import { z } from "zod";
import { executeAgentSkill, getAgentSkillByToolName, listAgentSkillDescriptors } from "./skills.js";

test("agent registry exposes only read-only, namespaced skills", () => {
  const skills = listAgentSkillDescriptors();
  assert.ok(skills.length >= 15);
  assert.equal(skills.every((skill) => skill.sideEffect === false), true);
  assert.equal(skills.every((skill) => skill.id.includes(".")), true);
  assert.equal(skills.every((skill) => skill.status === "production" && skill.outputSchemaId.length > 0), true);
  assert.equal(skills.every((skill) => skill.outputSchema instanceof z.ZodType), true);
  assert.equal(skills.every((skill) => !(skill.outputSchema instanceof z.ZodUnknown)), true);
  assert.equal(skills.every((skill) => Number.isInteger(skill.version) && skill.version > 0), true);
  assert.equal(skills.every((skill) => skill.outputSchemaId.endsWith(`.v${skill.version}`)), true);
  assert.equal(skills.every((skill) => skill.allowedProfiles.length > 0), true);
  assert.equal(skills.some((skill) => /place|close|transfer|activate|write/.test(skill.id)), false);
  assert.equal(getAgentSkillByToolName("market_get_ticker")?.id, "market.get_ticker");
  assert.equal(getAgentSkillByToolName("place_order"), null);
});

test("skill profile permissions fail before any tool implementation is invoked", async () => {
  const skill = getAgentSkillByToolName("portfolio_get_positions")!;
  let invoked = false;
  const guarded = { ...skill, execute: async () => { invoked = true; throw new Error("must_not_run"); } };
  const context = { profile: { enabledSkillIds: [skill.id], baseProfileKey: "market_analyst", actionLevel: "account_read" }, marketType: "perp", selectedVenue: "auto" } as any;
  await assert.rejects(() => executeAgentSkill(guarded, context, {}), (error: any) => error?.code === "agent_chat_skill_not_allowed");
  assert.equal(invoked, false);
});

test("invalid tool output is rejected before it can reach the model", async () => {
  const skill = {
    ...getAgentSkillByToolName("market_get_ticker")!,
    cacheTtlMs: 0,
    outputSchema: z.object({ trusted: z.literal(true) }),
    execute: async () => ({ ok: true, data: { trusted: false }, meta: { toolId: "market.get_ticker", fetchedAt: new Date().toISOString(), ageMs: null, quality: "fresh" as const, timestampSource: "request" as const, stale: false, degraded: false, fallbackUsed: false, cacheHit: false, warnings: [], routineVersions: [] } })
  };
  const context = { profile: { enabledSkillIds: [skill.id], baseProfileKey: "market_analyst", actionLevel: "public_data" }, marketType: "perp", selectedVenue: "auto" } as any;
  await assert.rejects(() => executeAgentSkill(skill, context, {}), (error: any) => error?.code === "agent_chat_tool_result_invalid");
});

test("agent tool schemas preserve optional arguments without strict provider validation", () => {
  const skills = listAgentSkillDescriptors();
  assert.equal(skills.every((skill) => skill.toolDefinition.function.strict !== true), true);

  const ohlcv = getAgentSkillByToolName("market_get_ohlcv");
  assert.ok(ohlcv);
  assert.deepEqual(ohlcv.toolDefinition.function.parameters.required, ["interval"]);

  const portfolio = getAgentSkillByToolName("risk_analyze_portfolio");
  assert.ok(portfolio);
  assert.deepEqual(portfolio.toolDefinition.function.parameters.required, []);
  assert.match(portfolio.toolDefinition.function.description, /never requires a symbol/i);
});

test("recursive redaction removes credentials from tool summaries", () => {
  const value = redactAiSafetySecrets({ nested: { apiSecret: "secret-value", authorization: "Bearer abcdefghijklmnop" } }) as any;
  assert.equal(value.nested.apiSecret, "[REDACTED]");
  assert.equal(value.nested.authorization, "[REDACTED]");
});

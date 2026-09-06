import assert from "node:assert/strict";
import test from "node:test";
import { assertProfileSkillsAllowed, resolveBuiltinAgentProfile } from "./profiles.js";

test("built-in profiles are versioned and contain no side-effect skills", () => {
  const market = resolveBuiltinAgentProfile("market_analyst");
  const position = resolveBuiltinAgentProfile("position_copilot");
  assert.equal(market.version, 6);
  assert.equal(position.version, 7);
  assert.equal(market.actionLevel, "public_data");
  assert.equal(position.actionLevel, "account_read");
  assert.equal(position.enabledSkillIds.includes("risk.analyze_portfolio"), true);
  assert.equal(position.enabledSkillIds.some((id) => /order|close|transfer|wallet|vault|bot/i.test(id)), true);
  assert.equal(position.enabledSkillIds.some((id) => /place_order|close_position|transfer_wallet|write_vault|start_bot/i.test(id)), false);
});

test("profile overrides cannot add forbidden or cross-profile skills", () => {
  assert.throws(() => assertProfileSkillsAllowed({ baseProfileKey: "market_analyst", enabledSkillIds: ["portfolio.get_positions"], actionLevel: "public_data" }), /agent_chat_skill_not_allowed/);
  assert.throws(() => assertProfileSkillsAllowed({ baseProfileKey: "position_copilot", enabledSkillIds: ["place_order"], actionLevel: "account_read" }), /agent_chat_skill_not_allowed/);
});

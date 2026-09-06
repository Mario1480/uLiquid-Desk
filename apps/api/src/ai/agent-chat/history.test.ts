import assert from "node:assert/strict";
import test from "node:test";
import { createPublicHistoryStore } from "../../market-data/derivativesHistory.js";
import { historyFeatureDependencies } from "../features/history.js";
import { executeAgentSkill, getAgentSkillByToolName, agentMarketDataAccounts } from "./skills.js";
import { resolveBuiltinAgentProfile } from "./profiles.js";
import type { AgentSkillExecutionContext } from "./contracts.js";
import { projectDecisionLogs } from "./decisionLogs.js";

const at = Date.parse("2026-09-06T12:00:00Z");
function context(overrides: Partial<AgentSkillExecutionContext> = {}): AgentSkillExecutionContext {
  return { db: {}, userId: "owner", runId: "history-run", conversationId: "conversation", locale: "en",
    selectedVenue: "binance", selectedExchangeAccountId: null, marketType: "perp", symbol: "BTCUSDT",
    profile: resolveBuiltinAgentProfile("market_analyst"), budget: { maxToolIterations: 4, maxToolCalls: 10, maxCallsPerSkill: 2, timeoutMs: 30000, maxOutputTokens: 1000 },
    signal: new AbortController().signal, positionRefs: new Map(), ...overrides };
}
function fixtureStore(counter: { calls: number }) {
  return createPublicHistoryStore({ now: () => at, fetch: (async (url, init) => {
    counter.calls++; assert.equal(new URL(String(url)).hostname, "fapi.binance.com");
    assert.equal(init?.method, "GET"); assert.equal(init?.headers, undefined);
    return new Response(JSON.stringify(Array.from({ length: 168 }, (_, i) => ({ symbol: "BTCUSDT", timestamp: at - (167 - i) * 3600000,
      sumOpenInterest: String(100 + i), sumOpenInterestValue: String(1000 + i) }))));
  }) as typeof fetch });
}
test("historical skill pins bounded inputs and persists exact summary/version evidence without raw series", async t => {
  const counter = { calls: 0 }; const store = fixtureStore(counter);
  t.mock.method(historyFeatureDependencies.store, "read", store.read);
  const skill = getAgentSkillByToolName("market_get_open_interest")!; const ctx = context();
  const result = await executeAgentSkill(skill, ctx, { history: true });
  const repeat = await executeAgentSkill(skill, ctx, { history: true });
  assert.deepEqual(repeat, result); assert.equal(counter.calls, 1);
  assert.equal((result.data as any).history.sampleCount, 168);
  assert.equal((result.data as any).history.change, 167);
  assert.deepEqual(result.meta.routineVersions, [{ id: "derivatives.history-summary.v1", version: "1.0.0" }]);
  assert.equal(result.meta.marketSnapshot?.dataset, "derivatives_history");
  assert.equal(JSON.stringify(result).includes('"points"'), false);
  const logs = projectDecisionLogs([{ id: "run", status: "completed", createdAt: new Date(at), completedAt: new Date(at),
    profileSnapshot: ctx.profile, contextSnapshot: {}, traceLogs: [], toolCalls: [{ id: "call", toolName: skill.id, status: "success",
      resultSummary: JSON.parse(JSON.stringify({ ...result.meta, skillVersion: skill.version, outputSchemaId: skill.outputSchemaId })) }] }], []);
  assert.deepEqual(logs[0].evidence[0].featureSnapshots, result.meta.featureSnapshots);
  assert.equal(logs[0].permission.execution, "not_permitted");
  assert.equal(logs[0].evidence[0].skillVersion, 5);
});

test("history obeys explicit venue, spot and profile boundaries before any read", async t => {
  t.mock.method(historyFeatureDependencies.store, "read", async () => { assert.fail("unsupported history must not fetch"); });
  const skill = getAgentSkillByToolName("market_get_open_interest")!;
  for (const venue of ["bitget", "mexc", "bingx", "hyperliquid"] as const) {
    await assert.rejects(executeAgentSkill(skill, context({ selectedVenue: venue }), { history: true }), (e: any) => e.code === "agent_chat_venue_unsupported");
  }
  await assert.rejects(executeAgentSkill(skill, context({ marketType: "spot" }), { history: true }));
  await assert.rejects(executeAgentSkill(skill, context({ profile: { ...resolveBuiltinAgentProfile("market_analyst"), enabledSkillIds: [] } }), { history: true }));
});

test("Paper ownership is rechecked before pinned history and auto fallback records the skipped source", async t => {
  const counter = { calls: 0 }; t.mock.method(historyFeatureDependencies.store, "read", fixtureStore(counter).read);
  let owned = true; let checks = 0;
  const ctx = context({ selectedVenue: "auto", selectedExchangeAccountId: "paper",
    db: { exchangeAccount: { findFirst: async ({ where }: any) => { checks++; assert.equal(where.userId, "owner"); return owned ? { exchange: "paper" } : null; } } } });
  t.mock.method(agentMarketDataAccounts, "resolveLinked", async (userId, id) => {
    assert.equal(userId, "owner"); assert.equal(id, "paper"); return { marketDataAccount: { exchange: "bingx" } } as any;
  });
  const skill = getAgentSkillByToolName("market_get_open_interest")!;
  const result = await executeAgentSkill(skill, ctx, { history: true });
  assert.equal(result.meta.sourceVenue, "binance"); assert.equal(result.meta.fallbackUsed, true);
  assert.ok(result.meta.warnings.includes("agent_chat_venue_unsupported"));
  owned = false;
  await assert.rejects(executeAgentSkill(skill, ctx, { history: true }), (e: any) => e.code === "agent_chat_account_access_denied");
  assert.equal(checks, 2); assert.equal(counter.calls, 1);
});

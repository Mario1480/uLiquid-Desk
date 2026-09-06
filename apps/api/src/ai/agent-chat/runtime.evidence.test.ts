import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "@mm/db";
import { invalidateAiModelCache } from "../provider.js";
import { sharedDerivativesStore, type SharedDerivativesRead } from "../../market-data/sharedDerivatives.js";
import { runAgentChat } from "./runtime.js";
import { resolveBuiltinAgentProfile } from "./profiles.js";
import { getAgentSkillByToolName } from "./skills.js";
import { projectDecisionLogs } from "./decisionLogs.js";

const now = Date.parse("2026-09-05T10:00:00.000Z");

function setup(t: TestContext) {
  invalidateAiModelCache();
  t.after(invalidateAiModelCache);
  const originalSettingsRead = prisma.globalSetting.findUnique;
  prisma.globalSetting.findUnique = (async () => null) as typeof originalSettingsRead;
  t.after(() => { prisma.globalSetting.findUnique = originalSettingsRead; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected_network_call"); });
  t.mock.method(Date, "now", () => now);
  const runs: any[] = [], calls: any[] = [], messages: any[] = [], traces: any[] = [];
  const create = (rows: any[], prefix: string) => async ({ data }: any) => {
    const row = { id: `${prefix}-${rows.length + 1}`, createdAt: new Date(now), ...data };
    rows.push(row); return row;
  };
  const update = (rows: any[]) => async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id), data);
  const db = {
    globalSetting: { findUnique: async () => ({ value: { aiCreditBillingEnabled: false } }) },
    aiAgentRun: { create: create(runs, "run"), update: update(runs) },
    aiAgentToolCall: { create: create(calls, "tool"), update: update(calls) },
    aiAgentMessage: { create: create(messages, "message") },
    aiTraceLog: { create: create(traces, "trace") },
    aiAgentConversation: { update: async () => ({}) }
  };
  const params = { db, userId: "fixture-owner", conversation: { id: "fixture-conversation", profileKey: "market_analyst",
    selectedVenue: "auto", selectedExchangeAccountId: null, marketType: "perp", symbol: "BTCUSDT" },
    profile: resolveBuiltinAgentProfile("market_analyst"), locale: "en" as const, userMessage: "Read-only market fixture.",
    idempotencyKey: "fixture-run", history: [] };
  const logs = () => projectDecisionLogs(JSON.parse(JSON.stringify(runs.map(run => ({ ...run,
    toolCalls: calls.filter(call => call.runId === run.id), traceLogs: traces.filter(trace => trace.agentRunId === run.id) })),
    (_key, value) => typeof value === "bigint" ? value.toString() : value)), JSON.parse(JSON.stringify(messages)));
  return { params, runs, calls, logs };
}

function modelResult(content: string, toolCalls: Array<{ id: string; name: string; argumentsText: string }> = []) {
  return { content, toolCalls, usage: {}, model: "fixture-model", provider: "openai" as const, finishReason: "stop" };
}

function derivatives(): SharedDerivativesRead {
  return { snapshot: { id: `mds_${"a".repeat(64)}`, schemaVersion: "1.0.0",
    market: { providerId: "uliquid-native:binance", sourceVenue: "binance", marketType: "perp", symbol: "BTCUSDT" },
    data: { fundingRate: 0, fundingIntervalHours: 8, openInterest: 12, openInterestUnit: "base_asset", contractSize: null,
      markPrice: 100, observedAt: new Date(now - 180_000).toISOString(), sourceTimestampProvided: true, warnings: [] },
    fetchedAt: new Date(now).toISOString() }, cacheHit: false, ageMs: 180_000, quality: "stale", warnings: ["market_data_stale"] };
}

test("unsupported tool errors retain exact provenance through runtime, model input and reloaded Decision Logs", async t => {
  const fixture = setup(t);
  t.mock.method(sharedDerivativesStore, "read", async () => { assert.fail("unsupported venue must not read market data"); });
  let rounds = 0;
  const response = await runAgentChat({ ...fixture.params, callAiChat: async messages => {
    if (rounds++ === 0) return modelResult("", ["market_get_funding_rate", "market_get_open_interest"].map((name, i) => ({ id: `call-${i}`, name, argumentsText: '{"venue":"bingx"}' })));
    for (const message of messages.filter(message => message.role === "tool")) {
      const payload = JSON.parse(message.content);
      assert.equal(payload.error.code, "agent_chat_venue_unsupported");
      assert.equal(payload.error.retryable, false);
      assert.match(payload.error.message, /unsupported capability, not a temporary data outage/);
      assert.equal(payload.skillVersion, 5);
      assert.equal(payload.outputSchemaId, `${payload.skillId}.v5`);
    }
    return modelResult('{"content":"Requested BingX data is unsupported.","blocks":[],"citations":[]}');
  } });
  assert.equal(response.run.degraded, true);
  const log = fixture.logs()[0];
  assert.equal(log.legacyAssociation, false);
  assert.equal(log.recommendation?.messageId, response.messageId);
  assert.deepEqual(log.dataQuality, { state: "unavailable", reasonCodes: ["agent_chat_venue_unsupported"] });
  assert.equal(log.evidence.length, 2);
  for (const evidence of log.evidence) {
    assert.equal(evidence.skillVersion, 5);
    assert.equal(evidence.outputSchemaId, `${evidence.skillId}.v5`);
    assert.equal(evidence.sourceVenue, "bingx");
    assert.deepEqual(evidence.routineVersions, []);
    assert.deepEqual(evidence.featureSnapshots, []);
    assert.equal(evidence.marketSnapshot, null);
    assert.equal(evidence.observedAt, null);
    assert.equal(evidence.fetchedAt, null);
  }
  assert.doesNotMatch(JSON.stringify(log), /fixture-owner|argumentsSummary/);
});

test("stale auto-fallback values remain pinned and persist after a later model failure", async t => {
  const fixture = setup(t), venues: string[] = [];
  t.mock.method(sharedDerivativesStore, "read", async (key: { sourceVenue: string }) => {
    venues.push(key.sourceVenue);
    if (key.sourceVenue === "hyperliquid") throw new Error("raw-provider-payload fixture-secret");
    return derivatives();
  });
  let rounds = 0;
  await assert.rejects(runAgentChat({ ...fixture.params, callAiChat: async messages => {
    if (rounds++ === 0) return modelResult("", [{ id: "call-1", name: "market_get_funding_rate", argumentsText: "{}" }, { id: "call-2", name: "market_get_open_interest", argumentsText: "{}" }]);
    assert.doesNotMatch(JSON.stringify(messages), /raw-provider-payload|fixture-secret/);
    throw new Error("fixture_provider_unavailable");
  } }), (error: any) => error.code === "agent_chat_provider_unavailable");
  assert.equal(venues.filter(venue => venue === "binance").length, 1);
  const [log] = fixture.logs();
  assert.equal(log.state, "failed"); assert.equal(log.recommendation, null);
  assert.equal(log.evidence.length, 2);
  assert.ok(log.evidence.every(item => item.quality === "stale" && item.fallbackUsed && item.skillVersion === 5));
  assert.ok(log.dataQuality.reasonCodes.includes("market_data_stale"));
  assert.ok(log.dataQuality.reasonCodes.includes("market_data_fallback_used"));
  assert.equal(log.snapshotManifest.length, 1);
  assert.equal(log.snapshotManifest[0].ageMs, 180_000);
  assert.equal((log.evidence[0].featureSnapshots[0].value as any).rateBps, 0);
  assert.doesNotMatch(JSON.stringify(log), /raw-provider-payload|fixture-secret|fixture-owner/);
});

test("invalid tool output is excluded from model input and stored failure evidence", async t => {
  const fixture = setup(t);
  const skill = getAgentSkillByToolName("market_get_funding_rate")!;
  t.mock.method(skill, "execute", async () => ({ ok: true, data: { privatePayload: "untrusted-fixture-payload" }, meta: {} }) as any);
  let rounds = 0;
  await runAgentChat({ ...fixture.params, callAiChat: async messages => {
    if (rounds++ === 0) return modelResult("", [{ id: "call-1", name: "market_get_funding_rate", argumentsText: "{}" }]);
    assert.doesNotMatch(JSON.stringify(messages), /untrusted-fixture-payload/);
    const payload = JSON.parse(messages.find(message => message.role === "tool")!.content);
    assert.equal(payload.error.code, "agent_chat_tool_result_invalid");
    return modelResult('{"content":"No validated data is available.","blocks":[],"citations":[]}');
  } });
  const evidence = fixture.logs()[0].evidence[0];
  assert.equal(evidence.skillVersion, 5);
  assert.deepEqual(evidence.routineVersions, []);
  assert.deepEqual(evidence.warningCodes, ["agent_chat_tool_result_invalid"]);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /untrusted-fixture-payload/);
});

test("failed runs never borrow a nearby successful assistant's legacy association", () => {
  const [log] = projectDecisionLogs([{ id: "failed-run", status: "failed", createdAt: new Date(now),
    completedAt: new Date(now + 1000), traceLogs: [], toolCalls: [] }],
  [{ id: "unrelated-answer", role: "assistant", createdAt: new Date(now + 1100), content: "Nearby successful answer." }]);
  assert.equal(log.recommendation, null);
  assert.equal(log.legacyAssociation, false);
  assert.ok(!log.dataQuality.reasonCodes.includes("legacy_message_association"));
});

test("auto tool arguments cannot relabel or bypass an explicitly selected unsupported venue", async t => {
  const fixture = setup(t);
  fixture.params.conversation.selectedVenue = "bingx";
  t.mock.method(sharedDerivativesStore, "read", async () => { assert.fail("unexpected market read"); });
  let rounds = 0;
  await runAgentChat({ ...fixture.params, callAiChat: async () => rounds++ === 0
    ? modelResult("", [{ id: "call-1", name: "market_get_open_interest", argumentsText: '{"venue":"auto"}' }])
    : modelResult('{"content":"BingX OI is unsupported.","blocks":[],"citations":[]}') });
  const [log] = fixture.logs();
  assert.equal(log.evidence[0].sourceVenue, "bingx");
  assert.deepEqual(log.evidence[0].warningCodes, ["agent_chat_venue_unsupported"]);
  assert.equal(log.technicalActivity[0].venue, "bingx");
});

for (const profileKey of ["market_analyst", "position_copilot"] as const) {
  test(`${profileKey} synthesizes after four rounds without extra budget or fabricated evidence`, async t => {
    const fixture = setup(t);
    t.mock.method(sharedDerivativesStore, "read", async () => derivatives());
    let calls = 0;
    const names = ["market_get_funding_rate", "market_get_funding_rate", "market_get_open_interest", "market_get_open_interest"];
    const response = await runAgentChat({ ...fixture.params, profile: resolveBuiltinAgentProfile(profileKey),
      callAiChat: async (messages, options) => {
        const iteration = calls++;
        assert.equal(options.aiRunContext?.callIndex, iteration);
        assert.equal(options.aiRunContext?.routing.maxToolRounds, 4);
        assert.ok(options.maxTokens! <= 6_000);
        if (iteration < 4) {
          assert.equal(options.toolChoice, "auto");
          if (iteration >= 2) assert.ok(!options.tools!.some(tool => tool.function.name === "market_get_funding_rate"));
          return modelResult("", [{ id: `budget-${iteration}`, name: names[iteration], argumentsText: '{"venue":"binance"}' }]);
        }
        assert.equal(options.toolChoice, "none");
        assert.deepEqual(options.tools, []);
        assert.match(messages.at(-1)!.content, /No further tool calls are permitted/);
        assert.match(messages.at(-1)!.content, /missing requested evidence/);
        assert.equal(messages.filter(message => message.role === "tool").length, 4);
        assert.match(JSON.stringify(messages), /market_data_stale/);
        return modelResult('{"content":"Only stale funding and OI evidence is available; other requested context is unavailable.","blocks":[],"citations":[]}');
      } });
    assert.equal(calls, 5);
    assert.equal(response.run.toolIterations, 4);
    assert.equal(response.run.toolCalls, 4);
    const [log] = fixture.logs();
    assert.equal(log.state, "completed");
    assert.equal(log.recommendation?.messageId, response.messageId);
    assert.equal(log.evidence.length, 4);
    assert.equal(log.snapshotManifest.length, 1);
    assert.ok(log.evidence.every(item => item.quality === "stale"));
    assert.equal(log.permission.execution, "not_permitted");
  });
}

test("final synthesis rejects unexpected provider tool calls without executing or persisting a recommendation", async t => {
  const fixture = setup(t);
  const profile = { ...fixture.params.profile, enabledSkillIds: ["market.get_funding_rate"] };
  t.mock.method(sharedDerivativesStore, "read", async () => derivatives());
  let calls = 0;
  await assert.rejects(runAgentChat({ ...fixture.params, profile, callAiChat: async (_messages, options) => {
    if (++calls === 3) { assert.equal(options.toolChoice, "none"); assert.deepEqual(options.tools, []); }
    return modelResult("", [{ id: `call-${calls}`, name: "market_get_funding_rate", argumentsText: '{"venue":"binance"}' }]);
  } }), (error: any) => error.code === "agent_chat_tool_budget_exceeded");
  assert.equal(calls, 3);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.logs()[0].recommendation, null);
});

test("per-skill caps still fail closed for excessive calls in one model batch", async t => {
  const fixture = setup(t);
  t.mock.method(sharedDerivativesStore, "read", async () => derivatives());
  await assert.rejects(runAgentChat({ ...fixture.params, callAiChat: async () => modelResult("", [0, 1, 2].map(i => ({
    id: `call-${i}`, name: "market_get_funding_rate", argumentsText: '{"venue":"binance"}'
  }))) }), (error: any) => error.code === "agent_chat_tool_budget_exceeded");
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.logs()[0].recommendation, null);
});

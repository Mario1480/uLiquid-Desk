import assert from "node:assert/strict";
import test from "node:test";
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import { z } from "zod";
import { executeAgentSkill, getAgentSkillByToolName, listAgentSkillDescriptors, agentMarketDataAccounts } from "./skills.js";
import { createSharedMarketStore, sharedMarketStore, normalizeSharedCandles } from "../../market-data/sharedMarket.js";
import { sharedDerivativesStore, type SharedDerivativesRead } from "../../market-data/sharedDerivatives.js";
import { resolveBuiltinAgentProfile } from "./profiles.js";
import type { AgentSkillExecutionContext } from "./contracts.js";

function marketContext(overrides: Partial<AgentSkillExecutionContext> = {}): AgentSkillExecutionContext {
  return { db: {}, userId: "user-a", runId: "run-a", conversationId: "conversation-a", locale: "en",
    selectedVenue: "binance", selectedExchangeAccountId: null, marketType: "perp", symbol: "BTCUSDT",
    profile: resolveBuiltinAgentProfile("market_analyst"),
    budget: { maxToolIterations: 4, maxToolCalls: 10, maxCallsPerSkill: 2, timeoutMs: 30000, maxOutputTokens: 1000 },
    signal: new AbortController().signal, positionRefs: new Map(), ...overrides };
}

function sharedFixture(): SharedDerivativesRead {
  return { snapshot: { id: `mds_${"a".repeat(64)}`, schemaVersion: "1.0.0",
    market: { providerId: "uliquid-native:binance", sourceVenue: "binance", marketType: "perp", symbol: "BTCUSDT" },
    data: { fundingRate: 0.0001, fundingIntervalHours: 8, openInterest: 12, openInterestUnit: "base_asset",
      contractSize: null, markPrice: 100, observedAt: "2026-09-05T10:00:00.000Z", sourceTimestampProvided: true, warnings: [] },
    fetchedAt: "2026-09-05T10:00:00.100Z" }, cacheHit: false, ageMs: 100, quality: "fresh", warnings: [] };
}

test("funding and OI skills consume shared snapshots with persisted feature provenance", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-05T10:00:00.100Z"));
  t.mock.method(sharedDerivativesStore, "read", async () => sharedFixture());
  const results = [];
  for (const name of ["market_get_funding_rate", "market_get_open_interest"]) {
    const skill = getAgentSkillByToolName(name)!;
    const result = await executeAgentSkill(skill, marketContext(), {});
    assert.equal(skill.version, 4);
    assert.equal(skill.cacheTtlMs, 0);
    assert.equal(result.meta.fetchedAt, sharedFixture().snapshot.fetchedAt);
    assert.equal(result.meta.ageMs, 100);
    assert.equal(result.meta.featureVersions?.[0].inputSnapshotId, sharedFixture().snapshot.id);
    assert.equal(result.meta.routineVersions.length, 1);
    assert.equal(skill.outputSchema.safeParse(result.data).success, true);
    results.push(result);
  }
  assert.notEqual(results[0].meta.featureVersions?.[0].snapshotId, results[1].meta.featureVersions?.[0].snapshotId);
});

test("explicit unsupported derivatives requests fail before the shared cache", async (t) => {
  let reads = 0;
  t.mock.method(sharedDerivativesStore, "read", async () => { reads++; return sharedFixture(); });
  for (const [venue, name] of [["bingx", "market_get_funding_rate"], ["bingx", "market_get_open_interest"], ["mexc", "market_get_open_interest"]] as const) {
    for (const explicitInput of [false, true]) {
      await assert.rejects(executeAgentSkill(getAgentSkillByToolName(name)!,
        marketContext({ selectedVenue: explicitInput ? "auto" : venue }), explicitInput ? { venue } : {}),
      (error: any) => error.code === "agent_chat_venue_unsupported" && error.status === 400);
    }
  }
  await assert.rejects(executeAgentSkill(getAgentSkillByToolName("market_get_funding_rate")!,
    marketContext({ selectedVenue: "bingx" }), { venue: "auto" }),
  (error: any) => error.code === "agent_chat_venue_unsupported" && error.status === 400);
  assert.equal(reads, 0);
});

test("auto fallback never persists raw provider errors", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-09-05T10:00:00.100Z"));
  const venues: string[] = [];
  t.mock.method(sharedDerivativesStore, "read", async (key: { sourceVenue: string }) => {
    venues.push(key.sourceVenue);
    if (key.sourceVenue === "hyperliquid") throw new Error("private-provider-payload apiKey=fixture-secret");
    return sharedFixture();
  });
  const result = await executeAgentSkill(getAgentSkillByToolName("market_get_funding_rate")!, marketContext({ selectedVenue: "auto" }), {});
  assert.deepEqual(venues, ["hyperliquid", "binance"]);
  assert.equal(result.meta.fallbackUsed, true);
  assert.ok(result.meta.warnings.includes("agent_chat_market_data_degraded"));
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|private-provider-payload/);
});

test("auto skips unavailable fields and records fallback without changing an explicit venue", async (t) => {
  const venues: string[] = [];
  t.mock.method(sharedDerivativesStore, "read", async (key: { sourceVenue: string }) => {
    venues.push(key.sourceVenue);
    const shared = sharedFixture();
    if (key.sourceVenue === "hyperliquid") shared.snapshot.data.openInterest = null;
    return shared;
  });
  const skill = getAgentSkillByToolName("market_get_open_interest")!;
  const result = await executeAgentSkill(skill, marketContext({ selectedVenue: "auto" }), {});
  assert.deepEqual(venues, ["hyperliquid", "binance"]);
  assert.equal(result.meta.fallbackUsed, true);
  assert.ok(result.meta.warnings.includes("openInterest_unavailable"));
  venues.length = 0;
  await assert.rejects(executeAgentSkill(skill, marketContext({ selectedVenue: "hyperliquid" }), {}));
  assert.deepEqual(venues, ["hyperliquid"]);
});

test("shared quality and missing timestamp metadata remain honest in tool output", async (t) => {
  let shared = sharedFixture();
  t.mock.method(sharedDerivativesStore, "read", async () => shared);
  const skill = getAgentSkillByToolName("market_get_funding_rate")!;
  shared.quality = "stale"; shared.ageMs = 180000; shared.warnings = ["market_data_stale"];
  t.mock.method(Date, "now", () => Date.parse("2026-09-05T10:03:00.000Z"));
  const stale = await executeAgentSkill(skill, marketContext(), {});
  assert.equal(stale.meta.quality, "stale");
  shared = sharedFixture(); shared.quality = "degraded"; shared.ageMs = null;
  shared.snapshot.data.sourceTimestampProvided = false; shared.warnings = ["provider_timestamp_missing"];
  const missing = await executeAgentSkill(skill, marketContext(), {});
  assert.equal(missing.meta.quality, "degraded");
  assert.equal(missing.meta.ageMs, null);
  assert.equal(missing.meta.timestampSource, "request");
});

test("tool caching isolates users, runs, implicit symbols and account-derived context", async () => {
  const original = getAgentSkillByToolName("market_get_ticker")!;
  let calls = 0;
  const skill = { ...original, cacheTtlMs: 2000, execute: async (context: AgentSkillExecutionContext) => {
    calls++;
    return { ok: true, data: { symbol: context.symbol, marketType: "perp", last: calls, mark: null, bid: null, ask: null },
      meta: { toolId: original.id, fetchedAt: new Date().toISOString(), ageMs: null, quality: "degraded" as const,
        timestampSource: "request" as const, stale: false, degraded: true, fallbackUsed: false,
        cacheHit: false, warnings: [], routineVersions: [] } };
  } };
  const base = marketContext({ runId: "cache-test" });
  const first = await executeAgentSkill(skill, base, {});
  (first.data as { last: number }).last = 999;
  const cached = await executeAgentSkill(skill, base, {});
  assert.equal(cached.meta.cacheHit, true);
  assert.equal((cached.data as { last: number }).last, 1);
  for (const patch of [{ userId: "user-b" }, { runId: "run-b" }, { symbol: "ETHUSDT" }, { selectedExchangeAccountId: "account-b" }]) {
    const result = await executeAgentSkill(skill, { ...base, ...patch }, {});
    assert.equal(result.meta.cacheHit, false);
  }
  assert.equal(calls, 5);
});

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

test("Copilot analyzes an owned positive-position reference without execution and rejects cross-user reuse", async () => {
  let owner = true;
  const context = marketContext({ profile: resolveBuiltinAgentProfile("position_copilot"), selectedExchangeAccountId: "fixture-account",
    db: { exchangeAccount: { findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "fixture-account", userId: "user-a" });
      return owner ? { id: "fixture-account", exchange: "binance", label: "Synthetic account" } : null;
    } } } });
  context.positionRefs.set("fixture-position", { symbol: "BTCUSDT", side: "long", size: 0.1, entryPrice: 65000,
    markPrice: 64000, unrealizedPnl: -100, leverage: 5, marginMode: "isolated", marginUsd: 1280, notionalUsd: 6400,
    liquidationPrice: 61000, liquidationDistancePct: 4.6875, roePct: -7.8, pnlPct: -1.56,
    stopLossPrice: 62500, takeProfitPrice: 68000 });
  const skill = getAgentSkillByToolName("risk_analyze_position_snapshot")!;
  const result = await executeAgentSkill(skill, context, { positionRef: "fixture-position" });
  assert.equal((result.data as any).riskLevel, "critical");
  assert.equal((result.data as any).readOnly, true);
  assert.equal(result.meta.routineVersions.length, 2);
  assert.equal(skill.sideEffect, false);
  owner = false;
  await assert.rejects(executeAgentSkill(skill, context, { positionRef: "fixture-position" }),
    (error: any) => error.code === "agent_chat_account_access_denied");
});

test("OHLCV and indicators share run-pinned candles and expose stored feature values", async (t) => {
  const at = Date.parse("2026-09-05T10:00:00Z");
  let now = at; let reads = 0;
  t.mock.method(Date, "now", () => now);
  const store = createSharedMarketStore({ now: () => now });
  t.mock.method(sharedMarketStore, "read", async (key: any) => {
    reads++;
    return store.read(key, async () => normalizeSharedCandles(Array.from({ length: 50 }, (_, i) => [at - (50 - i) * 3600000, 100, 102, 99, 101, 5]), "1h", 50, at));
  });
  const context = marketContext();
  const candles = await executeAgentSkill(getAgentSkillByToolName("market_get_ohlcv")!, context, { interval: "1h", limit: 50 });
  now += 40_000;
  const indicators = await executeAgentSkill(getAgentSkillByToolName("market_get_indicators")!, context, { interval: "1h", limit: 50 });
  assert.equal(reads, 1);
  assert.equal(candles.meta.marketSnapshot?.id, indicators.meta.marketSnapshot?.id);
  assert.equal(indicators.meta.quality, "stale");
  assert.equal(indicators.meta.fetchedAt, candles.meta.fetchedAt);
  assert.equal(indicators.meta.featureSnapshots?.[0].id, "technical.indicator-summary");
  assert.equal((indicators.meta.featureSnapshots?.[0].value as any).values.sma20, 101);
});

test("owned BingX zero-price skill result remains read-only and carries corrected provenance", async () => {
  const context = marketContext({ profile: resolveBuiltinAgentProfile("position_copilot"), selectedExchangeAccountId: "fixture-account",
    db: { exchangeAccount: { findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "fixture-account", userId: "user-a" });
      return { id: "fixture-account", exchange: "bingx", label: "Synthetic account" };
    } } } });
  context.positionRefs.set("fixture-position", { symbol: "FIXTUREUSDT", side: "long", size: 1, entryPrice: 100, markPrice: 100,
    liquidationPrice: 0, liquidationDistancePct: null, stopLossPrice: 90 });
  const skill = getAgentSkillByToolName("risk_analyze_position_snapshot")!;
  const result = await executeAgentSkill(skill, context, { positionRef: "fixture-position" });
  assert.equal((result.data as any).riskLevel, "low");
  assert.equal((result.data as any).dataQuality.state, "complete");
  assert.equal((result.data as any).readOnly, true);
  assert.ok((result.data as any).events.some((e: any) => e.code === "no_liquidation_price"));
  assert.equal(skill.version, 2);
  assert.equal(skill.sideEffect, false);
  assert.equal(context.profile.version, 7);
  assert.deepEqual(result.meta.routineVersions, [{ id: "position.snapshot.v1", version: "1.1.0" }, { id: "position.risk.v1", version: "1.1.0" }]);
});

test("ticker and book skills persist separate datasets and safe book analytics", async (t) => {
  const at = Date.parse("2026-09-05T10:00:00Z");
  t.mock.method(Date, "now", () => at);
  const store = createSharedMarketStore({ now: () => at });
  t.mock.method(sharedMarketStore, "read", async (key: any) => store.read(key, async () => ({
    data: key.dataset === "ticker" ? { last: 100, mark: null, bid: 99, ask: 101 } : { bids: [[99, 2]], asks: [[101, 1]] },
    observedAt: null, warnings: []
  })));
  const context = marketContext();
  const ticker = await executeAgentSkill(getAgentSkillByToolName("market_get_ticker")!, context, {});
  const book = await executeAgentSkill(getAgentSkillByToolName("market_get_orderbook")!, context, {});
  assert.equal(ticker.meta.quality, "degraded");
  assert.equal(book.meta.quality, "degraded");
  assert.notEqual(ticker.meta.marketSnapshot?.id, book.meta.marketSnapshot?.id);
  assert.equal(book.meta.featureSnapshots?.[0].id, "orderbook.snapshot");
  assert.equal((book.meta.featureSnapshots?.[0].value as any).midPrice, 100);
});

test("Paper-linked reads check ownership before shared state and preserve linked capability fallback", async (t) => {
  let linkedReads = 0; let marketReads = 0; let owned = false;
  t.mock.method(agentMarketDataAccounts, "resolveLinked", async (userId: string, id: string) => {
    assert.equal(userId, "user-a"); assert.equal(id, "paper-owned"); linkedReads++;
    return { marketDataAccount: { exchange: "bingx" } };
  });
  t.mock.method(sharedDerivativesStore, "read", async (key: any) => {
    marketReads++;
    const data = sharedFixture(); data.snapshot.market = key;
    return data;
  });
  const context = marketContext({ selectedVenue: "auto", selectedExchangeAccountId: "paper-owned", db: {
    exchangeAccount: { findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "paper-owned", userId: "user-a" });
      return owned ? { exchange: "paper" } : null;
    } }
  } });
  const skill = getAgentSkillByToolName("market_get_open_interest")!;
  await assert.rejects(executeAgentSkill(skill, context, {}), (error: any) => error.code === "agent_chat_account_access_denied");
  assert.equal(linkedReads, 0); assert.equal(marketReads, 0);
  owned = true;
  const result = await executeAgentSkill(skill, context, {});
  assert.equal(linkedReads, 1); assert.equal(marketReads, 1);
  assert.equal(result.meta.fallbackUsed, true);
  assert.equal(result.meta.sourceVenue, "hyperliquid");
  owned = false;
  await assert.rejects(executeAgentSkill(skill, context, {}), (error: any) => error.code === "agent_chat_account_access_denied");
  assert.equal(marketReads, 1);
});

test("aborted runs and mismatched market requests never invoke a market reader", async (t) => {
  let reads = 0;
  t.mock.method(sharedDerivativesStore, "read", async () => { reads++; return sharedFixture(); });
  const skill = getAgentSkillByToolName("market_get_funding_rate")!;
  await assert.rejects(executeAgentSkill(skill, marketContext(), { marketType: "spot" }), (error: any) => error.code === "agent_chat_venue_unsupported");
  const abort = new AbortController(); abort.abort();
  await assert.rejects(executeAgentSkill(skill, marketContext({ signal: abort.signal }), {}), (error: any) => error.name === "AbortError");
  assert.equal(reads, 0);
});

test("funding and OI within one run keep the same snapshot after TTL expiration", async (t) => {
  let at = Date.parse("2026-09-05T10:00:00.100Z"); let reads = 0;
  t.mock.method(Date, "now", () => at);
  t.mock.method(sharedDerivativesStore, "read", async () => { reads++; return sharedFixture(); });
  const context = marketContext();
  const funding = await executeAgentSkill(getAgentSkillByToolName("market_get_funding_rate")!, context, {});
  at += 130000;
  const oi = await executeAgentSkill(getAgentSkillByToolName("market_get_open_interest")!, context, {});
  assert.equal(reads, 1);
  assert.equal(oi.meta.quality, "stale");
  assert.equal(funding.meta.marketSnapshot?.id, oi.meta.marketSnapshot?.id);
  assert.equal(oi.meta.ageMs, 130100);
});

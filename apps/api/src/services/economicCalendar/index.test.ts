import assert from "node:assert/strict";
import test from "node:test";
import { applyNewsRiskToFeatureSnapshot, evaluateNewsRiskForSymbol, listEconomicEvents } from "./index.js";

test("listEconomicEvents preserves unavailable release values as null", async () => {
  const events = await listEconomicEvents({
    db: {
      economicCalendarConfig: { upsert: async () => ({}) },
      economicEvent: {
        findMany: async () => [{
          id: "evt_1",
          sourceId: "official:evt_1",
          ts: new Date("2026-08-12T12:30:00.000Z"),
          country: "US",
          currency: "USD",
          title: "Consumer Price Index",
          impact: "high",
          forecast: null,
          previous: null,
          actual: null,
          source: "official"
        }]
      }
    },
    from: "2026-08-12",
    to: "2026-08-12"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.forecast, null);
  assert.equal(events[0]?.previous, null);
  assert.equal(events[0]?.actual, null);
});

test("applyNewsRiskToFeatureSnapshot sets newsRisk + tag", () => {
  const next = applyNewsRiskToFeatureSnapshot(
    {
      tags: ["trend_up", "high_vol"]
    },
    {
      newsRisk: true,
      currency: "USD",
      nextEvent: {
        id: "evt1",
        sourceId: "evt1",
        ts: "2026-02-12T12:30:00.000Z",
        country: "US",
        currency: "USD",
        title: "CPI",
        impact: "high",
        forecast: null,
        previous: null,
        actual: null,
        source: "fmp"
      },
      activeWindow: {
        from: "2026-02-12T12:00:00.000Z",
        to: "2026-02-12T13:00:00.000Z",
        event: {
          id: "evt1",
          sourceId: "evt1",
          ts: "2026-02-12T12:30:00.000Z",
          country: "US",
          currency: "USD",
          title: "CPI",
          impact: "high",
          forecast: null,
          previous: null,
          actual: null,
          source: "fmp"
        }
      }
    }
  );

  assert.equal(next.newsRisk, true);
  assert.ok(Array.isArray(next.tags));
  assert.equal((next.tags as string[])[0], "news_risk");
});

test("applyNewsRiskToFeatureSnapshot clears news_risk when inactive", () => {
  const next = applyNewsRiskToFeatureSnapshot(
    { tags: ["news_risk", "trend_down"] },
    {
      newsRisk: false,
      currency: "USD",
      nextEvent: null,
      activeWindow: null
    }
  );

  assert.equal(next.newsRisk, false);
  assert.deepEqual(next.tags, ["trend_down"]);
});

test("applyNewsRiskToFeatureSnapshot exposes degraded calendar state without adding news_risk tag", () => {
  const next = applyNewsRiskToFeatureSnapshot(
    { tags: ["trend_up"] },
    {
      newsRisk: false,
      currency: "USD",
      nextEvent: null,
      activeWindow: null,
      degraded: true,
      degradedReason: "fmp_api_key_missing"
    }
  );

  assert.equal(next.newsRisk, false);
  assert.equal(next.newsRiskDegraded, true);
  assert.deepEqual(next.tags, ["trend_up"]);
  assert.equal((next.newsBlackout as any)?.degraded, true);
  assert.equal((next.newsBlackout as any)?.degradedReason, "fmp_api_key_missing");
});

test("evaluateNewsRiskForSymbol conservatively marks missing provider-neutral schema as degraded", async () => {
  const result = await evaluateNewsRiskForSymbol({
    db: {},
    symbol: "BTC/USDC:USDC",
    now: new Date("2026-02-12T12:00:00.000Z")
  });

  assert.equal(result.newsRisk, false);
  assert.equal(result.degraded, true);
  assert.equal(result.degradedReason, "schema_not_ready");
});

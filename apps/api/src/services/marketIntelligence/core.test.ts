import assert from "node:assert/strict";
import test from "node:test";
import type { NewsItem } from "./contracts/news.js";
import { StaleWhileRevalidateCache, ProviderCircuitBreaker } from "./cache.js";
import { generateGroundedMarketSummary } from "./summary.js";
import { ProviderRegistry, envFlag, parseProviderIds } from "./registry/index.js";

test("provider registry preserves configured priority and reports missing providers", () => {
  const registry = new ProviderRegistry([{ id: "rss" }, { id: "legacy_fmp" }]);
  const resolved = registry.resolve(["rss", "missing", "legacy_fmp"]);
  assert.deepEqual(resolved.providers.map((provider) => provider.id), ["rss", "legacy_fmp"]);
  assert.deepEqual(resolved.missing, ["missing"]);
  assert.deepEqual(parseProviderIds("rss,rss,legacy_fmp", []), ["rss", "legacy_fmp"]);
  assert.equal(envFlag("off", true), false);
});

test("stale-while-revalidate cache and circuit breaker expose safe degraded states", () => {
  const cache = new StaleWhileRevalidateCache();
  cache.set("k", { value: 1 }, 100, 500, 1_000);
  assert.deepEqual(cache.get("k", 1_050), { value: { value: 1 }, stale: false });
  assert.deepEqual(cache.get("k", 1_200), { value: { value: 1 }, stale: true });
  assert.equal(cache.get("k", 1_501), null);

  const circuit = new ProviderCircuitBreaker(2, 1_000);
  circuit.failure("rss", 1_000);
  circuit.failure("rss", 1_100);
  assert.equal(circuit.state("rss", 1_200), "open");
  assert.equal(circuit.canRequest("rss", 1_200), false);
  assert.equal(circuit.state("rss", 2_101), "half_open");
});

function news(id: string, sentiment?: "negative" | "neutral" | "positive"): NewsItem {
  return {
    id,
    provider: "rss",
    sourceName: "Official source",
    sourceUrl: `https://example.org/${id}`,
    title: `Fixture ${id}`,
    publishedAt: "2026-08-02T08:00:00.000Z",
    fetchedAt: "2026-08-02T08:01:00.000Z",
    symbols: ["BTC"],
    categories: ["crypto_market"],
    ...(sentiment ? { sentiment: { score: sentiment === "positive" ? 0.5 : sentiment === "negative" ? -0.5 : 0, label: sentiment, origin: "local_model" as const } } : {}),
    contentHash: `hash-${id}`
  };
}

test("grounded summary handles missing, conflicting, and stale inputs without fabrication", async () => {
  const missing = await generateGroundedMarketSummary({
    news: [],
    events: [],
    degraded: true,
    warnings: ["No provider data available."],
    now: new Date("2026-08-02T09:00:00.000Z")
  });
  assert.equal(missing.summary.overallRisk, "unknown");
  assert.equal(missing.summary.highlights.length, 0);
  assert.equal(missing.meta.degraded, true);

  const conflicting = await generateGroundedMarketSummary({
    news: [news("positive", "positive"), news("negative", "negative")],
    events: [],
    now: new Date("2026-08-02T09:00:00.000Z")
  });
  assert.equal(conflicting.summary.sentiment, "mixed");
  assert.equal(conflicting.summary.highlights.every((item) => item.sourceIds.length > 0), true);
  assert.equal(conflicting.citations.length, 2);

  const stale = await generateGroundedMarketSummary({
    news: [news("stale")],
    events: [],
    degraded: true,
    warnings: ["News data is stale (7200s old)."],
    now: new Date("2026-08-02T10:00:00.000Z")
  });
  assert.equal(stale.meta.degraded, true);
  assert.equal(stale.summary.uncertainties.some((entry) => entry.includes("stale")), true);
});

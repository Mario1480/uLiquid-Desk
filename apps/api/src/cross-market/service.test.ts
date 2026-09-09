import assert from "node:assert/strict";
import test from "node:test";
import type { CrossMarketBook, CrossMarketVenue } from "./core.js";
import { CrossMarketInsufficientDataError, runCrossMarketScan } from "./service.js";

function book(venue: CrossMarketVenue): CrossMarketBook {
  return {
    venue,
    bids: [[101, 5]],
    asks: [[100, 5]],
    observedAt: null,
    fetchedAt: "2026-09-09T10:00:00.000Z",
    ageMs: null,
    quality: "degraded",
    warnings: ["provider_timestamp_missing"],
    snapshotId: `snapshot:${venue}`,
    providerId: `native:${venue}`
  };
}

const request = {
  kind: "arbitrage" as const,
  symbol: "BTCUSDT",
  venues: ["binance", "bitget", "mexc"] as CrossMarketVenue[],
  targetNotionalUsd: 1_000,
  bookLimit: 25,
  safetyBufferBps: 3,
  minNetEdgeBps: 5,
  maxBookAgeMs: 30_000,
  maxObservationSkewMs: 2_000,
  feeProfiles: {}
};

test("scanner returns partial provider evidence when at least two public books are available", async () => {
  const result = await runCrossMarketScan(request, async ({ venue }) => {
    if (venue === "mexc") throw new Error("provider detail must not leak");
    return book(venue);
  });

  assert.equal(result.mode, "scanner_only");
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.failures, [{ venue: "mexc", code: "provider_unavailable" }]);
  assert.ok(result.opportunities.length > 0);
});

test("scanner fails closed when fewer than two public books are available", async () => {
  await assert.rejects(
    runCrossMarketScan(request, async ({ venue }) => {
      if (venue !== "binance") throw new Error("offline");
      return book(venue);
    }),
    (error) => error instanceof CrossMarketInsufficientDataError && error.failures.length === 2
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  scanArbitrage,
  scanXemm,
  type CrossMarketBook,
  type CrossMarketScanOptions,
  type CrossMarketVenue
} from "./core.js";

function book(venue: CrossMarketVenue, bid: number, ask: number, depth = 20, quality: CrossMarketBook["quality"] = "fresh"): CrossMarketBook {
  return {
    venue,
    bids: [[bid, depth], [bid - 0.5, depth]],
    asks: [[ask, depth], [ask + 0.5, depth]],
    observedAt: "2026-09-09T10:00:00.000Z",
    fetchedAt: "2026-09-09T10:00:00.010Z",
    ageMs: 10,
    quality,
    warnings: [],
    snapshotId: `snapshot:${venue}`,
    providerId: `native:${venue}`
  };
}

function options(books: CrossMarketBook[], patch: Partial<CrossMarketScanOptions> = {}): CrossMarketScanOptions {
  return {
    symbol: "BTCUSDT",
    marketType: "perp",
    targetNotionalUsd: 1_000,
    safetyBufferBps: 3,
    minNetEdgeBps: 5,
    maxBookAgeMs: 30_000,
    maxObservationSkewMs: 2_000,
    books,
    feeProfiles: {},
    ...patch
  };
}

test("arbitrage uses executable depth and converts a positive headline spread into a net loss after costs", () => {
  const [result] = scanArbitrage(options([
    book("binance", 99.9, 100),
    book("bitget", 100.15, 100.25)
  ])).filter((item) => item.buyVenue === "binance" && item.sellVenue === "bitget");

  assert.ok(result.grossEdgeBps > 0);
  assert.ok(result.netEdgeBps < 0);
  assert.equal(result.status, "below_threshold");
  assert.equal(result.inventory.state, "unknown");
  assert.ok(result.warnings.includes("inventory_not_provided"));
});

test("arbitrage blocks stale books and insufficient requested depth while keeping values quantity-consistent", () => {
  const shallow = book("bitget", 101, 101.1, 0.25, "stale");
  shallow.ageMs = 45_000;
  const [result] = scanArbitrage(options([book("binance", 99.9, 100), shallow], {
    targetNotionalUsd: 1_000
  })).filter((item) => item.buyVenue === "binance" && item.sellVenue === "bitget");

  assert.equal(result.status, "blocked");
  assert.equal(result.score, 0);
  assert.ok(result.depthCoverage < 1);
  assert.ok(result.executableUsd < 1_000);
  assert.ok(result.warnings.includes("target_depth_insufficient"));
  assert.ok(result.warnings.includes("bitget_book_stale"));
});

test("arbitrage inventory readiness is deterministic and blocks insufficient conservative perp collateral", () => {
  const [result] = scanArbitrage(options([
    book("binance", 99.9, 100),
    book("bitget", 101, 101.1)
  ], {
    inventory: {
      binance: { quoteUsd: 2_000 },
      bitget: { quoteUsd: 500 }
    }
  })).filter((item) => item.buyVenue === "binance" && item.sellVenue === "bitget");

  assert.equal(result.inventory.model, "perp_conservative_1x");
  assert.equal(result.inventory.state, "insufficient");
  assert.equal(result.status, "blocked");
});

test("cross-venue observations outside the atomic skew budget fail closed", () => {
  const first = book("binance", 99.9, 100);
  const second = book("bitget", 101, 101.1);
  second.observedAt = "2026-09-09T10:00:03.000Z";
  const [result] = scanArbitrage(options([first, second])).filter((item) => item.buyVenue === "binance" && item.sellVenue === "bitget");

  assert.equal(result.status, "blocked");
  assert.ok(result.warnings.includes("book_observation_skew_exceeded"));
});

test("XEMM evaluates both passive sides, includes hedge slippage and never presents a fill as guaranteed", () => {
  const results = scanXemm(options([
    book("binance", 100, 101),
    book("bitget", 101.5, 102)
  ], {
    feeProfiles: {
      binance: { makerBps: 0, takerBps: 10, source: "request_override" },
      bitget: { makerBps: 0, takerBps: 1, source: "request_override" }
    }
  }));
  const makerBuy = results.find((item) => item.makerVenue === "binance" && item.takerVenue === "bitget" && item.makerSide === "buy");

  assert.ok(makerBuy);
  assert.ok(makerBuy.netEdgeBps > 0);
  assert.equal(makerBuy.status, "candidate");
  assert.ok(makerBuy.warnings.includes("maker_fill_not_guaranteed"));
  assert.equal(results.some((item) => item.makerSide === "sell"), true);
});

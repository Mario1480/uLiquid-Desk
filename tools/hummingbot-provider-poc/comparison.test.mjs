import assert from "node:assert/strict";
import test from "node:test";
import { comparePublicProbes, summarizeProbe } from "./comparison.mjs";

const native = {
  providerId: "uliquid-native:bitget",
  schemaVersion: "1.0.0",
  status: "observed",
  venue: "bitget",
  marketType: "perpetual",
  symbol: "BTCUSDT",
  requestAttempts: 5,
  samples: [{
    fetchedAtMs: 1_000,
    durationMs: 100,
    ticker: { last: 100 },
    orderbook: { bids: [[99, 1]], asks: [[101, 1]] },
    funding: { rate: 0.0001 }
  }],
  limitations: []
};

test("comparison retains temporal skew and never promotes a public read to full POC PASS", () => {
  const result = comparePublicProbes(native, {
    providerId: "hummingbot-poc:bitget-perpetual",
    schemaVersion: "1.0.0",
    status: "observed",
    venue: "bitget",
    marketType: "perpetual",
    symbol: "BTCUSDT",
    samples: [{
      fetchedAtMs: 1_050,
      durationMs: 120,
      ticker: { last: 100.1 },
      orderbook: { bids: [[99.1, 1]], asks: [[101.1, 1]] },
      funding: { rate: 0.00011 }
    }],
    limitations: ["candles_unsupported_by_pinned_hummingbot_connector"]
  });
  assert.equal(result.pairedSamples, 1);
  assert.equal(result.observations[0].observationSkewMs, 50);
  assert.equal(result.decision, "public_comparison_observed");
  assert.equal(result.fullPocStatus, "not_assessed");
});

test("missing Hummingbot evidence stays not assessed", () => {
  const result = comparePublicProbes(native, {
    providerId: "hummingbot-poc:bitget-perpetual",
    status: "blocked",
    samples: [],
    limitations: ["runtime_unavailable"]
  });
  assert.equal(result.pairedSamples, 0);
  assert.equal(result.decision, "not_assessed");
  assert.equal(summarizeProbe(result.hummingbot).samples, 0);
});

test("malformed, failed or mismatched probe identities cannot produce affirmative evidence", () => {
  const invalid = comparePublicProbes(native, {
    schemaVersion: "1.0.0",
    providerId: "unexpected-provider",
    status: "observed",
    venue: "bitget",
    marketType: "perpetual",
    symbol: "ETHUSDT",
    samples: [{ fetchedAtMs: 1_000, durationMs: 1 }]
  });
  assert.equal(invalid.pairedSamples, 0);
  assert.equal(invalid.decision, "not_assessed");
  assert.deepEqual(invalid.integrityWarnings, ["probe_identity_or_status_invalid"]);

  const malformed = comparePublicProbes(native, {
    schemaVersion: "1.0.0",
    providerId: "hummingbot-poc:bitget-perpetual",
    status: "observed",
    venue: "bitget",
    marketType: "perpetual",
    symbol: "BTCUSDT",
    samples: [{}]
  });
  assert.equal(malformed.pairedSamples, 0);
  assert.equal(malformed.decision, "not_assessed");
  assert.equal(summarizeProbe(malformed.hummingbot).successfulSamples, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateMarketPriceCandidate } from "./price.service.js";

const now = new Date("2026-08-22T12:00:00.000Z");
const healthy = {
  priceUsd: "0.002",
  spotPriceUsd: "0.0021",
  twapWindowSeconds: 86_400,
  spotTwapDeviationBps: 500,
  liquidityUsd: "50000",
  poolAgeSeconds: 30 * 86_400,
  observedAt: new Date(now.getTime() - 29 * 60_000),
  validUntil: new Date(now.getTime() + 60_000)
};

test("market price gate accepts only a healthy 24h TWAP candidate", () => {
  assert.equal(validateMarketPriceCandidate(healthy, now), null);
  assert.equal(validateMarketPriceCandidate({ ...healthy, twapWindowSeconds: 3_600 }, now), "twap_window_not_24h");
  assert.equal(validateMarketPriceCandidate({ ...healthy, liquidityUsd: "49999.99" }, now), "pool_tvl_below_50000_usd");
  assert.equal(validateMarketPriceCandidate({ ...healthy, spotTwapDeviationBps: 2_501 }, now), "spot_twap_deviation_above_25pct");
  assert.equal(
    validateMarketPriceCandidate({ ...healthy, observedAt: new Date(now.getTime() - 31 * 60_000) }, now),
    "price_older_than_30m"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveUliqPriceSnapshot, validateMarketPriceCandidate } from "./price.service.js";
import type { UliqRuntimeConfig } from "./config.js";

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

test("price resolution degrades after observation when no approved market reference exists", async () => {
  let created: any = null;
  let alert: any = null;
  const config = {
    chainId: 421614,
    contracts: {
      token: "0x1111111111111111111111111111111111111111",
      presale: "0x2222222222222222222222222222222222222222",
      vesting: "0x3333333333333333333333333333333333333333",
      locker: "0x4444444444444444444444444444444444444444",
      usdc: "0x5555555555555555555555555555555555555555"
    }
  } as UliqRuntimeConfig;
  const decision = await resolveUliqPriceSnapshot({
    db: {
      uliqPriceSnapshot: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          created = { id: "price-degraded", ...data };
          return created;
        }
      },
      platformAlert: {
        findFirst: async () => null,
        create: async ({ data }: any) => { alert = data; return data; }
      }
    },
    config,
    blockNumber: 123n,
    blockHash: "0xabc",
    dexLaunchTimestamp: BigInt(Math.floor((now.getTime() - 31 * 86_400_000) / 1_000)),
    now
  });
  assert.equal(decision.qualityStatus, "DEGRADED");
  assert.equal(decision.degradationReason, "market_reference_unavailable_after_observation");
  assert.equal(created.priceUsd, "0.001000000000000000");
  assert.equal(alert.type, "uliq_price_degraded");
});

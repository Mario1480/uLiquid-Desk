import assert from "node:assert/strict";
import test from "node:test";
import { calculateEligibleRaw, calculateEligibleUsdScaled, calculateUntrackedEligibleRaw, resolveEffectiveTierForPrice, resolveUliqTier } from "./entitlement.service.js";
import { allocateUliqDiscountAcrossLines, calculateUliqDiscountCents } from "./math.js";

test("eligible balance counts wallet, unreleased vesting and locked exactly once", () => {
  assert.equal(calculateEligibleRaw(250_000n, 650_000n, 100_000n), 1_000_000n);
});

test("reference-price tier thresholds use integer decimal math", () => {
  const raw = 1_500_000n * 10n ** 18n;
  const usd = calculateEligibleUsdScaled(raw, "0.001");
  const configs = [
    { code: "BASIC", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "0" },
    { code: "GOLD", configVersion: 1, featureFlags: {}, aiDiscountBps: 1500, subscriptionDiscountBps: 1500, minUsdValue: "1500" }
  ];
  assert.equal(resolveUliqTier(usd, configs).code, "GOLD");
});

test("BPS discount rounds down and preserves base-discount-final invariant", () => {
  const result = calculateUliqDiscountCents(999, 1_500);
  assert.deepEqual(result, { baseAmountCents: 999, discountAmountCents: 149, finalAmountCents: 850 });
});

test("line allocation sums exactly to the order discount", () => {
  const lines = allocateUliqDiscountAcrossLines([333, 667], 150);
  assert.equal(lines.reduce((sum, line) => sum + line.discountAmountCents, 0), 150);
  assert.equal(lines.reduce((sum, line) => sum + line.finalAmountCents, 0), 850);
  assert.ok(lines.every((line) => line.baseAmountCents - line.discountAmountCents === line.finalAmountCents));
});

test("claim, lock and unlock transitions preserve eligible balance without double counting", () => {
  const finalized = calculateEligibleRaw(250_000n, 750_000n, 0n);
  const halfClaimed = calculateEligibleRaw(625_000n, 375_000n, 0n);
  const locked = calculateEligibleRaw(525_000n, 375_000n, 100_000n);
  const unlocked = calculateEligibleRaw(625_000n, 375_000n, 0n);
  assert.equal(finalized, 1_000_000n);
  assert.equal(halfClaimed, finalized);
  assert.equal(locked, finalized);
  assert.equal(unlocked, finalized);
});

test("degraded pricing holds the last healthy tier and blocks both upgrade and downgrade", () => {
  const configs = [
    { code: "BASIC", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "0" },
    { code: "SILVER", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "500" },
    { code: "GOLD", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "1500" }
  ];
  const heldFromUpgrade = resolveEffectiveTierForPrice({ freshTier: configs[2]!, configs, priceQualityStatus: "DEGRADED", previousHealthyTierCode: "SILVER" });
  const heldFromDowngrade = resolveEffectiveTierForPrice({ freshTier: configs[0]!, configs, priceQualityStatus: "STALE", previousHealthyTierCode: "SILVER" });
  assert.equal(heldFromUpgrade.code, "SILVER");
  assert.equal(heldFromDowngrade.code, "SILVER");
});

test("unknown holdings are detected conservatively without exceeding onchain eligible balance", () => {
  assert.equal(calculateUntrackedEligibleRaw(1_000n, 750n), 250n);
  assert.equal(calculateUntrackedEligibleRaw(1_000n, 1_100n), 0n);
});

import assert from "node:assert/strict";
import test from "node:test";
import { calculateEligibleRaw, calculateEligibleUsdScaled, calculateUntrackedEligibleRaw, resolveEffectiveTierForPrice, resolveUliqTier } from "./entitlement.service.js";
import {
  allocateUliqDiscountAcrossLines,
  calculateRequiredLockRaw,
  calculateUliqDiscountCents,
  decideUliqLockGate,
  ULIQ_PLATFORM_FEE_DISCOUNT_BPS
} from "./math.js";

test("eligible balance counts wallet, unreleased vesting and locked exactly once", () => {
  assert.equal(calculateEligibleRaw(250_000n, 650_000n, 100_000n), 1_000_000n);
});

test("reference-price tier thresholds use integer decimal math", () => {
  const raw = 1_500_000n * 10n ** 18n;
  const usd = calculateEligibleUsdScaled(raw, "0.001");
  const configs = [
    { code: "BASIC", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "0", minimumLockDurationDays: null, monetaryBenefitCaps: null },
    { code: "GOLD", configVersion: 1, featureFlags: {}, aiDiscountBps: 1500, subscriptionDiscountBps: 1500, minUsdValue: "1500", minimumLockDurationDays: null, monetaryBenefitCaps: null }
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
    { code: "BASIC", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "0", minimumLockDurationDays: null, monetaryBenefitCaps: null },
    { code: "SILVER", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "500", minimumLockDurationDays: null, monetaryBenefitCaps: null },
    { code: "GOLD", configVersion: 1, featureFlags: {}, aiDiscountBps: 0, subscriptionDiscountBps: 0, minUsdValue: "1500", minimumLockDurationDays: null, monetaryBenefitCaps: null }
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

test("lock threshold is 25 percent of the rounded-up current tier minimum", () => {
  const scale = 10n ** 18n;
  assert.equal(calculateRequiredLockRaw({
    tierMinimumUsdScaled: 1_500n * scale,
    referencePriceUsdScaled: 1_000_000_000_000_000n
  }), 375_000n * scale);
  assert.equal(calculateRequiredLockRaw({
    tierMinimumUsdScaled: 1n,
    referencePriceUsdScaled: 3n
  }), 83_333_333_333_333_334n);
});

test("ULIQ never discounts platform fees", () => {
  assert.equal(ULIQ_PLATFORM_FEE_DISCOUNT_BPS, 0);
});

test("lock gate accepts exact term boundary and aggregates only covering locks", () => {
  const requiredUntil = new Date("2027-02-28T12:00:00.000Z");
  const decision = decideUliqLockGate({
    requiredLockedRaw: 100n,
    requiredBenefitUntil: requiredUntil,
    stateFresh: true,
    positions: [
      { lockId: "1", amountRaw: 40n, unlockAt: requiredUntil, withdrawn: false },
      { lockId: "2", amountRaw: 60n, unlockAt: new Date(requiredUntil.getTime() + 1), withdrawn: false },
      { lockId: "3", amountRaw: 1_000n, unlockAt: new Date(requiredUntil.getTime() - 1), withdrawn: false }
    ]
  });
  assert.equal(decision.qualifies, true);
  assert.equal(decision.qualifyingLockedRaw, "100");
  assert.deepEqual(decision.qualifyingLockIds, ["1", "2"]);
});

test("lock gate distinguishes missing amount, short term and stale canonical state", () => {
  const requiredUntil = new Date("2027-01-01T00:00:00.000Z");
  const short = { lockId: "1", amountRaw: 1_000n, unlockAt: new Date(requiredUntil.getTime() - 1), withdrawn: false };
  assert.equal(decideUliqLockGate({ requiredLockedRaw: 0n, requiredBenefitUntil: requiredUntil, positions: [], stateFresh: true }).failureReason, "uliq_lock_required");
  assert.equal(decideUliqLockGate({ requiredLockedRaw: 100n, requiredBenefitUntil: requiredUntil, positions: [], stateFresh: true }).failureReason, "uliq_lock_required");
  assert.equal(decideUliqLockGate({ requiredLockedRaw: 100n, requiredBenefitUntil: requiredUntil, positions: [short], stateFresh: true }).failureReason, "uliq_lock_term_insufficient");
  assert.equal(decideUliqLockGate({ requiredLockedRaw: 100n, requiredBenefitUntil: requiredUntil, positions: [{ ...short, amountRaw: 99n, unlockAt: requiredUntil }], stateFresh: true }).failureReason, "uliq_lock_amount_insufficient");
  assert.equal(decideUliqLockGate({ requiredLockedRaw: 100n, requiredBenefitUntil: requiredUntil, positions: [{ ...short, unlockAt: requiredUntil }], stateFresh: false }).failureReason, "uliq_lock_state_stale");
});

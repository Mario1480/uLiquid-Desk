import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUliqBenefitPreset,
  buildUliqTierBenefitRequest,
  createUliqTierBenefitDraft
} from "./tierBenefits.js";

test("ULIQ tier benefit drafts preserve exact percent and cent values", () => {
  const draft = createUliqTierBenefitDraft({
    code: "GOLD",
    minUsdValue: "1500.000000000000000000",
    subscriptionDiscountBps: 1_000,
    aiDiscountBps: 1_500,
    monetaryBenefitCaps: { aiCreditDiscountMonthlyCents: "1250" }
  });
  assert.deepEqual(draft, {
    code: "GOLD",
    minUsdValue: "1500",
    subscriptionDiscountPercent: "10",
    aiDiscountPercent: "15",
    aiCreditDiscountMonthlyUsd: "12.5"
  });
  assert.deepEqual(buildUliqTierBenefitRequest([draft], "Staging benefit activation"), {
    reason: "Staging benefit activation",
    tiers: [{
      code: "GOLD",
      minUsdValue: "1500",
      subscriptionDiscountBps: 1_000,
      aiDiscountBps: 1_500,
      aiCreditDiscountMonthlyCents: 1_250
    }]
  });
});
test("approved benefit preset changes only BPS and keeps operator-entered caps", () => {
  const result = applyUliqBenefitPreset([{
    code: "PLATINUM",
    minUsdValue: "5000",
    subscriptionDiscountPercent: "0",
    aiDiscountPercent: "0",
    aiCreditDiscountMonthlyUsd: "50"
  }], [{ code: "PLATINUM", subscriptionDiscountBps: 1_500, aiDiscountBps: 2_000 }]);
  assert.deepEqual(result[0], {
    code: "PLATINUM",
    minUsdValue: "5000",
    subscriptionDiscountPercent: "15",
    aiDiscountPercent: "20",
    aiCreditDiscountMonthlyUsd: "50"
  });
});

test("positive AI discounts fail closed without a positive monthly cap", () => {
  assert.throws(
    () => buildUliqTierBenefitRequest([{
      code: "BRONZE",
      minUsdValue: "100",
      subscriptionDiscountPercent: "0",
      aiDiscountPercent: "5",
      aiCreditDiscountMonthlyUsd: ""
    }], "Staging benefit activation"),
    /uliq_tier_benefit_ai_cap_required/
  );
});

test("benefit parsing rejects sub-cent and sub-basis-point values", () => {
  assert.throws(
    () => buildUliqTierBenefitRequest([{
      code: "SILVER",
      minUsdValue: "500",
      subscriptionDiscountPercent: "5.001",
      aiDiscountPercent: "10",
      aiCreditDiscountMonthlyUsd: "25"
    }], "Staging benefit activation"),
    /uliq_tier_benefit_invalid_number/
  );
});

test("tier minimums must remain strictly increasing and BASIC stays at zero", () => {
  const baseDraft = {
    subscriptionDiscountPercent: "0",
    aiDiscountPercent: "0",
    aiCreditDiscountMonthlyUsd: ""
  };
  assert.throws(
    () => buildUliqTierBenefitRequest([
      { ...baseDraft, code: "BASIC", minUsdValue: "1" },
      { ...baseDraft, code: "BRONZE", minUsdValue: "100" }
    ], "Threshold validation"),
    /uliq_tier_threshold_basic_zero/
  );
  assert.throws(
    () => buildUliqTierBenefitRequest([
      { ...baseDraft, code: "BASIC", minUsdValue: "0" },
      { ...baseDraft, code: "BRONZE", minUsdValue: "500" },
      { ...baseDraft, code: "SILVER", minUsdValue: "500" }
    ], "Threshold validation"),
    /uliq_tier_threshold_order_invalid/
  );
});

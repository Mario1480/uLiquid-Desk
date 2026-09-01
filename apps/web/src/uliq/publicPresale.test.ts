import assert from "node:assert/strict";
import test from "node:test";
import {
  isUliqPublicPresaleAdminVisible,
  isUliqPublicPresaleLiveDataEnabled,
  isUliqPublicPresaleWebEnabled
} from "../../lib/uliqPublicPresale";
import { countdownLabel, createPublicPresalePreviewOverview, progressPercent, secondsToDays } from "./publicPresale";

test("public presale web activation is fail closed", () => {
  assert.equal(isUliqPublicPresaleWebEnabled(undefined), false);
  assert.equal(isUliqPublicPresaleWebEnabled("false"), false);
  assert.equal(isUliqPublicPresaleWebEnabled("true"), true);
  assert.equal(isUliqPublicPresaleWebEnabled("ON"), true);
  assert.equal(isUliqPublicPresaleAdminVisible(undefined), false);
  assert.equal(isUliqPublicPresaleAdminVisible("true"), true);
  assert.equal(isUliqPublicPresaleLiveDataEnabled(undefined), false);
  assert.equal(isUliqPublicPresaleLiveDataEnabled("true"), true);
});

test("public presale preview exposes approved round parameters without enabling purchases", () => {
  const overview = createPublicPresalePreviewOverview(42_161);
  assert.equal(overview.chainId, 42_161);
  assert.equal(overview.purchasesEnabled, false);
  assert.equal(overview.rounds[0]?.state, "DRAFT");
  assert.equal(overview.rounds[0]?.allocationCapUliqRaw, (50_000_000n * 10n ** 18n).toString());
  assert.equal(overview.rounds[0]?.priceUsdcRawPerUliq, "2000");
  assert.equal(overview.rounds[0]?.minPurchaseUsdcRaw, "500000000");
  assert.equal(overview.rounds[0]?.maxPurchaseUsdcRaw, "10000000000");
  assert.equal(overview.rounds[1]?.allocationCapUliqRaw, (100_000_000n * 10n ** 18n).toString());
  assert.equal(overview.rounds[1]?.priceUsdcRawPerUliq, "3500");
  assert.equal(overview.rounds[1]?.minPurchaseUsdcRaw, "100000000");
  assert.equal(overview.rounds[1]?.maxPurchaseUsdcRaw, "5000000000");
  assert.equal(overview.rounds.every((round) => !round.purchaseEnabled), true);
});

test("public presale progress uses integer raw values without floating-point input loss", () => {
  assert.equal(progressPercent("25000000000", "100000000000"), 25);
  assert.equal(progressPercent("1", "3"), 33.33);
  assert.equal(progressPercent("100", "0"), 0);
});

test("public presale schedule helpers expose compact countdowns and day durations", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z");
  assert.equal(countdownLabel("2026-09-03T13:30:00.000Z", now), "2d 3h");
  assert.equal(countdownLabel("2026-09-01T12:45:00.000Z", now), "2h 45m");
  assert.equal(countdownLabel("2026-09-01T09:00:00.000Z", now), null);
  assert.equal(secondsToDays(String(90 * 24 * 60 * 60)), 90);
  assert.equal(secondsToDays(String(548 * 24 * 60 * 60)), 548);
});

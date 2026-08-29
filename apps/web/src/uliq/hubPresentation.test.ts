import assert from "node:assert/strict";
import test from "node:test";
import { deriveUliqHubPresentation } from "./hubPresentation.js";

test("purchase controls only exist while the configured round is active", () => {
  assert.equal(deriveUliqHubPresentation({ saleState: "ACTIVE" }).purchaseVisible, true);
  assert.equal(deriveUliqHubPresentation({ saleState: "ENDED" }).purchaseVisible, false);
});

test("presale and vesting routes disappear only after vesting and purchases fully settle", () => {
  const now = new Date("2027-06-01T00:00:00.000Z");
  const settled = deriveUliqHubPresentation({
    saleState: "DEX_LAUNCHED",
    vestingEnd: "2027-05-22T00:00:00.000Z",
    unreleasedRaw: "0",
    claimableRaw: "0",
    purchaseStatuses: ["FINALIZED"],
    trackedPurchaseStatuses: [],
    now
  });
  assert.equal(settled.presaleVisible, false);
  assert.equal(settled.vestingVisible, false);

  const reviewRequired = deriveUliqHubPresentation({
    saleState: "DEX_LAUNCHED",
    vestingEnd: "2027-05-22T00:00:00.000Z",
    unreleasedRaw: "0",
    claimableRaw: "0",
    trackedPurchaseStatuses: ["REVIEW_REQUIRED"],
    now
  });
  assert.equal(reviewRequired.presaleVisible, true);
});

test("next action prioritizes reconciliation before settlement and claims", () => {
  assert.equal(deriveUliqHubPresentation({
    saleState: "ACTIVE",
    claimableRaw: "100",
    purchaseStatuses: ["PENDING_WITHDRAWAL"],
    trackedPurchaseStatuses: ["SAFE"]
  }).nextAction, "RECONCILE_PURCHASE");
});

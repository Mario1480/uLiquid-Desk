import assert from "node:assert/strict";
import test from "node:test";
import { formatBillingAmount, formatBillingToken, paymentEvidence, subscriptionSyncEvidence, type AdminPaymentOrder } from "./adminPayments";

test("admin money formatting preserves explicit currency and exact raw token precision", () => {
  assert.equal(formatBillingAmount(500, "USD", "en"), "5.00 USD");
  assert.equal(formatBillingAmount(500, "USDC", "de"), "5,00 USDC");
  assert.equal(formatBillingToken("9007199254740993", 6), "9007199254.740993");
  assert.equal(formatBillingToken("1", 6), "0.000001");
  assert.equal(formatBillingToken("0", 0), "0");
});

test("payment presentation never equates confirmations or transaction submission with verified finality", () => {
  const payment = { txHash: null, verifiedAt: null, confirmations: 100 } as AdminPaymentOrder["payment"];
  assert.equal(paymentEvidence(null), "PROVIDER");
  assert.equal(paymentEvidence(payment), "AWAITING");
  assert.equal(paymentEvidence({ ...payment!, txHash: "0xabc" }), "SUBMITTED");
  assert.equal(paymentEvidence({ ...payment!, txHash: "0xabc", verifiedAt: "2026-09-12T10:00:00Z" }), "VERIFIED");
});

test("current sync presentation does not treat a false pending flag as historical success", () => {
  assert.equal(subscriptionSyncEvidence(null), "UNKNOWN");
  const sync = { id: "sub", entitlementSyncPending: false, entitlementSyncAttempts: 0, entitlementSyncedAt: null };
  assert.equal(subscriptionSyncEvidence(sync), "UNKNOWN");
  assert.equal(subscriptionSyncEvidence({ ...sync, entitlementSyncedAt: "2026-09-12" }), "SYNCED");
  assert.equal(subscriptionSyncEvidence({ ...sync, entitlementSyncPending: true, entitlementSyncedAt: "2026-09-12" }), "PENDING");
});

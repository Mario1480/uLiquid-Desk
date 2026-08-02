import assert from "node:assert/strict";
import test from "node:test";
import {
  executeBillingWriteIfFresh,
  isBillingPaymentExpired,
  selectResumableBillingCheckout,
  shouldResumeBillingCheckout
} from "./onchainCheckout.js";

test("checkout expiry is inclusive at the server deadline", () => {
  const expiresAt = "2026-08-02T12:00:00.000Z";
  assert.equal(isBillingPaymentExpired(expiresAt, Date.parse("2026-08-02T11:59:59.999Z")), false);
  assert.equal(isBillingPaymentExpired(expiresAt, Date.parse(expiresAt)), true);
  assert.equal(isBillingPaymentExpired(null, Date.parse(expiresAt)), true);
  assert.equal(isBillingPaymentExpired("not-a-date", Date.parse(expiresAt)), true);
});

test("an expired checkout never invokes the wallet write", async () => {
  let writes = 0;
  const result = await executeBillingWriteIfFresh({
    expiresAt: "2026-08-02T12:00:00.000Z",
    now: () => Date.parse("2026-08-02T12:00:00.001Z"),
    write: async () => {
      writes += 1;
      return "0xhash";
    }
  });
  assert.deepEqual(result, { status: "expired" });
  assert.equal(writes, 0);
});

test("an expired checkout remains recoverable when its transaction hash only exists locally", () => {
  assert.equal(shouldResumeBillingCheckout({
    status: "expired",
    hasOnchainPayment: true,
    hasStoredTxHash: true
  }), true);
  assert.equal(shouldResumeBillingCheckout({
    status: "expired",
    hasOnchainPayment: true,
    hasStoredTxHash: false
  }), false);
  assert.equal(shouldResumeBillingCheckout({
    status: "paid",
    hasOnchainPayment: true,
    hasStoredTxHash: true
  }), false);
});

test("an active checkout takes precedence over an older locally tracked expired payment", () => {
  const selected = selectResumableBillingCheckout([
    {
      id: "expired_with_local_hash",
      status: "expired",
      hasOnchainPayment: true,
      hasStoredTxHash: true
    },
    {
      id: "current_pending",
      status: "pending",
      hasOnchainPayment: true,
      hasStoredTxHash: false
    }
  ]);
  assert.equal(selected?.id, "current_pending");
});

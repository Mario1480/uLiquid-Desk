import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizedClaimAmountRaw,
  isPendingClaimTransaction,
  pendingClaimMatchesWallet,
  type PendingClaimTransaction
} from "./pendingClaim";

const pending: PendingClaimTransaction = {
  chainId: 421614,
  contractAddress: `0x${"b".repeat(40)}`,
  walletAddress: `0x${"c".repeat(40)}`,
  transactionHash: `0x${"a".repeat(64)}`,
  releasedRawBefore: "6000",
  submittedAt: "2026-08-25T16:53:04.000Z"
};

test("pending claim parser accepts only complete persisted transaction state", () => {
  assert.equal(isPendingClaimTransaction(pending), true);
  assert.equal(isPendingClaimTransaction({ ...pending, transactionHash: "0x1234" }), false);
  assert.equal(isPendingClaimTransaction({ ...pending, releasedRawBefore: "1e18" }), false);
  assert.equal(isPendingClaimTransaction({ ...pending, submittedAt: "invalid" }), false);
});

test("pending claim applies only to the connected chain and wallet", () => {
  assert.equal(pendingClaimMatchesWallet(pending, 421614, pending.walletAddress.toUpperCase()), true);
  assert.equal(pendingClaimMatchesWallet(pending, 42161, pending.walletAddress), false);
  assert.equal(pendingClaimMatchesWallet(pending, 421614, `0x${"d".repeat(40)}`), false);
});

test("claim completes only after the finalized released amount increases", () => {
  assert.equal(finalizedClaimAmountRaw(pending, "5999"), null);
  assert.equal(finalizedClaimAmountRaw(pending, "6000"), null);
  assert.equal(finalizedClaimAmountRaw(pending, "7250"), "1250");
  assert.equal(finalizedClaimAmountRaw(pending, "invalid"), null);
});

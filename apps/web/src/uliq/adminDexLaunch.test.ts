import assert from "node:assert/strict";
import test from "node:test";
import { deriveDexLaunchConfirmationStatus, isDexLaunchTracking } from "./adminDexLaunch";

const base = {
  receiptStatus: "success" as const,
  receiptBlockNumber: BigInt(100),
  receiptBlockHash: "0xaaaa",
  canonicalBlockHash: "0xaaaa",
  safeBlockNumber: BigInt(99),
  finalizedBlockNumber: BigInt(98)
};

test("DEX launch confirmation keeps receipt, safe, and finalized distinct", () => {
  assert.equal(deriveDexLaunchConfirmationStatus(base), "SOFT_CONFIRMED");
  assert.equal(deriveDexLaunchConfirmationStatus({ ...base, safeBlockNumber: BigInt(100) }), "SAFE");
  assert.equal(deriveDexLaunchConfirmationStatus({ ...base, safeBlockNumber: BigInt(101), finalizedBlockNumber: BigInt(100) }), "FINALIZED");
});

test("DEX launch confirmation fails closed for revert and canonical mismatch", () => {
  assert.equal(deriveDexLaunchConfirmationStatus({ ...base, receiptStatus: "reverted" }), "FAILED");
  assert.equal(deriveDexLaunchConfirmationStatus({ ...base, canonicalBlockHash: "0xbbbb" }), "REORGED");
});

test("DEX launch tracking parser rejects malformed persisted state", () => {
  const valid = {
    chainId: 421614,
    contractAddress: `0x${"b".repeat(40)}`,
    transactionHash: `0x${"a".repeat(64)}`,
    dexLaunchTimestamp: "1787673600",
    confirmationStatus: "SUBMITTED",
    receiptBlockNumber: null,
    submittedAt: "2026-08-25T14:00:00.000Z",
    updatedAt: "2026-08-25T14:00:00.000Z"
  };
  assert.equal(isDexLaunchTracking(valid), true);
  assert.equal(isDexLaunchTracking({ ...valid, transactionHash: "0x1234" }), false);
  assert.equal(isDexLaunchTracking({ ...valid, confirmationStatus: "CONFIRMED" }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFundingBridgeClient,
  FundingBridgeError,
  validateBridgeDeposit,
  validateBridgeWithdraw
} from "../../lib/funding/bridgeClient";

test("validateBridgeDeposit rejects amount below minimum", () => {
  assert.throws(
    () =>
      validateBridgeDeposit({
        amount: "1",
        minDepositUsdc: 5,
        sourceBalanceRaw: "10000000",
        sourceBalanceAvailable: true,
        gasBalanceRaw: "1",
        gasAvailable: true,
        connectedChainId: 42161,
        expectedChainId: 42161
      }),
    (error: unknown) =>
      error instanceof FundingBridgeError
      && error.code === "min_deposit_not_met"
  );
});

test("validateBridgeWithdraw rejects amount that does not clear fee", () => {
  assert.throws(
    () =>
      validateBridgeWithdraw({
        amount: "1",
        feeUsdc: 1,
        sourceBalanceRaw: "1000000",
        sourceBalanceAvailable: true,
        destination: "0x1234567890123456789012345678901234567890",
        connectedChainId: 42161,
        expectedChainId: 42161
      }),
    (error: unknown) =>
      error instanceof FundingBridgeError
      && error.code === "amount_below_fee"
  );
});

test("submitDeposit returns tx hash even when receipt wait times out", async () => {
  const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const client = createFundingBridgeClient({
    async submitDeposit() {
      return txHash;
    },
    async submitWithdraw() {
      throw new Error("not_used");
    },
    async waitForReceipt() {
      throw new Error("timeout");
    }
  });

  const result = await client.submitDeposit({
    amount: "5",
    walletClient: {} as any,
    publicClient: {} as any,
    address: "0x1234567890123456789012345678901234567890",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    bridgeContractAddress: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7"
  });

  assert.equal(result.txHash, txHash);
  assert.equal(result.receiptConfirmed, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsdClassTransferClient,
  HyperliquidUsdClassTransferError,
  validateUsdClassTransfer
} from "../../lib/funding/usdClassTransferClient";

test("validateUsdClassTransfer rejects insufficient spot source balance", () => {
  assert.throws(
    () =>
      validateUsdClassTransfer({
        amount: "2",
        toPerp: true,
        spotBalanceRaw: "1000000",
        spotBalanceAvailable: true,
        perpBalanceRaw: "0",
        perpBalanceAvailable: true
      }),
    (error: unknown) =>
      error instanceof HyperliquidUsdClassTransferError
      && error.code === "insufficient_balance"
  );
});

test("validateUsdClassTransfer returns normalized raw amount for target reconciliation", () => {
  const result = validateUsdClassTransfer({
    amount: "1.25",
    toPerp: false,
    spotBalanceRaw: "0",
    spotBalanceAvailable: true,
    perpBalanceRaw: "2000000",
    perpBalanceAvailable: true
  });

  assert.equal(result.normalizedAmount, "1.25");
  assert.equal(result.amountRaw, BigInt(1250000));
});

test("submitTransfer normalizes amount before SDK submit", async () => {
  const calls: string[] = [];
  const client = createUsdClassTransferClient({
    async submitTransfer(input) {
      calls.push(input.amount);
    }
  });

  await client.submitTransfer({
    amount: " 1.25 ",
    toPerp: true,
    walletClient: {} as any,
    address: "0x1234567890123456789012345678901234567890",
    hyperliquidExchangeUrl: "https://api.hyperliquid.xyz",
    signatureChainId: 42161
  });

  assert.deepEqual(calls, ["1.25"]);
});

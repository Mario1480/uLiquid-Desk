import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "viem";
import {
  RELAY_DEFAULT_HYPE_TOPUP_USDC,
  RelayFundingError,
  executeRelayLeg,
  shouldSuggestHypeTopup,
  validateRelayFunding,
  validateRelayWithdrawal
} from "../../lib/funding/relayClient";

test("validateRelayFunding rejects wrong Arbitrum chain", () => {
  assert.throws(
    () => validateRelayFunding({
      usdcAmount: "10",
      includeHypeTopup: false,
      hypeTopupUsdcAmount: RELAY_DEFAULT_HYPE_TOPUP_USDC,
      arbitrumUsdcRaw: "100000000",
      arbitrumUsdcAvailable: true,
      arbitrumEthRaw: "1",
      arbitrumEthAvailable: true,
      connectedChainId: 999,
      expectedChainId: 42161
    }),
    (error) => error instanceof RelayFundingError && error.code === "wrong_chain"
  );
});

test("validateRelayFunding includes HYPE top-up in source balance check", () => {
  assert.throws(
    () => validateRelayFunding({
      usdcAmount: "10",
      includeHypeTopup: true,
      hypeTopupUsdcAmount: "5",
      arbitrumUsdcRaw: "12000000",
      arbitrumUsdcAvailable: true,
      arbitrumEthRaw: "1",
      arbitrumEthAvailable: true,
      connectedChainId: 42161,
      expectedChainId: 42161
    }),
    (error) => error instanceof RelayFundingError && error.code === "insufficient_balance"
  );
});

test("validateRelayFunding rejects missing Arbitrum ETH gas", () => {
  assert.throws(
    () => validateRelayFunding({
      usdcAmount: "10",
      includeHypeTopup: false,
      hypeTopupUsdcAmount: RELAY_DEFAULT_HYPE_TOPUP_USDC,
      arbitrumUsdcRaw: "100000000",
      arbitrumUsdcAvailable: true,
      arbitrumEthRaw: "0",
      arbitrumEthAvailable: true,
      connectedChainId: 42161,
      expectedChainId: 42161
    }),
    (error) => error instanceof RelayFundingError && error.code === "missing_gas_balance"
  );
});

test("shouldSuggestHypeTopup uses the 0.02 HYPE threshold", () => {
  assert.equal(shouldSuggestHypeTopup("0"), true);
  assert.equal(shouldSuggestHypeTopup(parseUnits("0.019", 18).toString()), true);
  assert.equal(shouldSuggestHypeTopup(parseUnits("0.02", 18).toString()), false);
  assert.equal(shouldSuggestHypeTopup(parseUnits("0.1", 18).toString()), false);
});

test("validateRelayWithdrawal rejects wrong HyperEVM chain", () => {
  assert.throws(
    () => validateRelayWithdrawal({
      usdcAmount: "10",
      hyperEvmUsdcRaw: "100000000",
      hyperEvmUsdcAvailable: true,
      hyperEvmHypeRaw: "1",
      hyperEvmHypeAvailable: true,
      connectedChainId: 42161,
      expectedChainId: 999
    }),
    (error) => error instanceof RelayFundingError && error.code === "wrong_chain"
  );
});

test("validateRelayWithdrawal rejects insufficient HyperEVM USDC", () => {
  assert.throws(
    () => validateRelayWithdrawal({
      usdcAmount: "10",
      hyperEvmUsdcRaw: "9000000",
      hyperEvmUsdcAvailable: true,
      hyperEvmHypeRaw: "1",
      hyperEvmHypeAvailable: true,
      connectedChainId: 999,
      expectedChainId: 999
    }),
    (error) => error instanceof RelayFundingError && error.code === "insufficient_balance"
  );
});

test("validateRelayWithdrawal rejects missing HyperEVM HYPE gas", () => {
  assert.throws(
    () => validateRelayWithdrawal({
      usdcAmount: "10",
      hyperEvmUsdcRaw: "100000000",
      hyperEvmUsdcAvailable: true,
      hyperEvmHypeRaw: "0",
      hyperEvmHypeAvailable: true,
      connectedChainId: 999,
      expectedChainId: 999
    }),
    (error) => error instanceof RelayFundingError && error.code === "missing_gas_balance"
  );
});

test("executeRelayLeg sends Relay step transactions in order", async () => {
  const sent: string[] = [];
  const waited: string[] = [];
  const hashes = [
    `0x${"a".repeat(64)}` as `0x${string}`,
    `0x${"b".repeat(64)}` as `0x${string}`
  ];

  const result = await executeRelayLeg({
    leg: {
      legId: "usdc_withdrawal",
      asset: "USDC",
      sourceAmount: { raw: "1000000", formatted: "1", symbol: "USDC", decimals: 6, chainId: 999 },
      destinationAmount: { raw: "990000", formatted: "0.99", symbol: "USDC", decimals: 6, chainId: 42161 },
      feeAmount: null,
      gasAmount: null,
      timeEstimateSeconds: 2,
      requestId: `0x${"c".repeat(64)}`,
      steps: [
        {
          id: "approve",
          kind: "transaction",
          requestId: null,
          items: [{
            status: "incomplete",
            tx: { chainId: 999, to: "0x1111111111111111111111111111111111111111", data: "0x01", value: "0" }
          }]
        },
        {
          id: "deposit",
          kind: "transaction",
          requestId: `0x${"c".repeat(64)}`,
          items: [{
            status: "incomplete",
            tx: { chainId: 999, to: "0x2222222222222222222222222222222222222222", data: "0x02", value: "0" }
          }]
        }
      ]
    },
    walletClient: {
      sendTransaction: async (tx: any) => {
        sent.push(String(tx.to));
        return hashes[sent.length - 1];
      }
    } as any,
    publicClient: {
      waitForTransactionReceipt: async ({ hash }: any) => {
        waited.push(String(hash));
      }
    } as any,
    address: "0x3333333333333333333333333333333333333333"
  });

  assert.deepEqual(sent, [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222"
  ]);
  assert.deepEqual(waited, hashes);
  assert.equal(result.txHash, hashes[1]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "viem";
import {
  RELAY_DEFAULT_HYPE_TOPUP_USDC,
  RelayFundingError,
  shouldSuggestHypeTopup,
  validateRelayFunding
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

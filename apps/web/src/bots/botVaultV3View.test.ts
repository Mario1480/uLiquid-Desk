import assert from "node:assert/strict";
import test from "node:test";
import { deriveStableBotVaultV3Capabilities, mergeStableBotVaultV3State } from "./botVaultV3View.js";

test("mergeStableBotVaultV3State preserves last known stable identifiers and status strings", () => {
  const result = mergeStableBotVaultV3State(
    {
      id: "bv_1",
      fundingStatus: "hyper_evm_confirmed_onchain",
      hypercoreFundingStatus: "pending",
      vaultAddress: "0x1111111111111111111111111111111111111111",
      controllerAddress: "0x2222222222222222222222222222222222222222",
      claimableProfitUsd: 12.5,
      canClaim: true
    },
    {
      id: "bv_1",
      fundingStatus: null,
      hypercoreFundingStatus: null,
      vaultAddress: null,
      controllerAddress: null,
      claimableProfitUsd: 12.5
    }
  );

  assert.equal(result?.fundingStatus, "hyper_evm_confirmed_onchain");
  assert.equal(result?.hypercoreFundingStatus, "pending");
  assert.equal(result?.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.controllerAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(result?.canClaim, true);
});

test("deriveStableBotVaultV3Capabilities falls back to stronger combined conditions when flags are missing", () => {
  const result = deriveStableBotVaultV3Capabilities({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    status: "ACTIVE",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "pending",
    claimableProfitUsd: 4.2,
    allocatedUsd: 100
  });

  assert.deepEqual(result, {
    hasOnchainVault: true,
    fundingConfirmedOnchain: true,
    canClaim: true,
    canClose: true,
    canRecover: false,
    canSetAgentWallet: true
  });
});

test("mergeStableBotVaultV3State keeps explicit address aliases aligned with legacy fields", () => {
  const result = mergeStableBotVaultV3State(
    {
      vaultAddress: "0x1111111111111111111111111111111111111111",
      agentWallet: "0x3333333333333333333333333333333333333333"
    },
    {
      onchainBotVaultAddress: "0x1111111111111111111111111111111111111111",
      agentWalletAddress: "0x3333333333333333333333333333333333333333"
    }
  );

  assert.equal(result?.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.onchainBotVaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.agentWallet, "0x3333333333333333333333333333333333333333");
  assert.equal(result?.agentWalletAddress, "0x3333333333333333333333333333333333333333");
});

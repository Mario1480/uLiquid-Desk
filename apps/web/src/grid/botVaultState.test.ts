import assert from "node:assert/strict";
import test from "node:test";
import { hasExistingOnchainBotVault } from "./botVaultState.js";

test("explicit hasOnchainBotVault flag keeps existing BotVault state even when vaultAddress is missing", () => {
  assert.equal(
    hasExistingOnchainBotVault({
      explicit: true,
      botVault: {
        id: "bv_1",
        allocatedUsd: 100,
        realizedNetUsd: 0,
        profitShareAccruedUsd: 0,
        withdrawnUsd: 0,
        withdrawableUsd: 0,
        availableUsd: 100,
        providerMetadataSummary: {
          vaultAddress: null,
          agentWallet: null
        }
      }
    }),
    true
  );
  assert.equal(
    hasExistingOnchainBotVault({
      explicit: false,
      botVault: {
        id: "bv_1",
        allocatedUsd: 100,
        realizedNetUsd: 0,
        profitShareAccruedUsd: 0,
        withdrawnUsd: 0,
        withdrawableUsd: 0,
        availableUsd: 100,
        providerMetadataSummary: {
          vaultAddress: "0x1111111111111111111111111111111111111111"
        }
      }
    }),
    false
  );
});

test("helper falls back to stable identity fields when explicit flag is unavailable", () => {
  assert.equal(
    hasExistingOnchainBotVault({
      botVault: {
        id: "bv_1",
        allocatedUsd: 100,
        realizedNetUsd: 0,
        profitShareAccruedUsd: 0,
        withdrawnUsd: 0,
        withdrawableUsd: 0,
        availableUsd: 100,
        providerMetadataSummary: {
          agentWallet: "0x2222222222222222222222222222222222222222"
        }
      }
    }),
    true
  );
  assert.equal(
    hasExistingOnchainBotVault({
      botVault: {
        id: "bv_1",
        allocatedUsd: 100,
        realizedNetUsd: 0,
        profitShareAccruedUsd: 0,
        withdrawnUsd: 0,
        withdrawableUsd: 0,
        availableUsd: 100,
        providerMetadataSummary: {}
      }
    }),
    false
  );
});

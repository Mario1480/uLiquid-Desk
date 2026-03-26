import assert from "node:assert/strict";
import test from "node:test";
import { resolveHyperliquidExecutionVaultAddress } from "./botVaultExecutionSupervisor.js";

test("resolveHyperliquidExecutionVaultAddress prefers provider metadata over fallback values", () => {
  const vaultAddress = resolveHyperliquidExecutionVaultAddress({
    executionMetadata: {
      providerState: {
        vaultAddress: "0x1111111111111111111111111111111111111111"
      }
    },
    fallbackPassphrase: "0x2222222222222222222222222222222222222222"
  });

  assert.equal(vaultAddress, "0x1111111111111111111111111111111111111111");
});

test("resolveHyperliquidExecutionVaultAddress falls back to exchange credentials when provider metadata is absent", () => {
  const vaultAddress = resolveHyperliquidExecutionVaultAddress({
    executionMetadata: {
      providerState: {
        vaultAddress: "not_an_address"
      }
    },
    fallbackPassphrase: "0x3333333333333333333333333333333333333333"
  });

  assert.equal(vaultAddress, "0x3333333333333333333333333333333333333333");
});

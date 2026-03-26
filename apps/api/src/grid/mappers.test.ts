import assert from "node:assert/strict";
import test from "node:test";
import { deriveHasOnchainBotVault, mergeExecutionStateIntoBotVault } from "./mappers.js";

test("mergeExecutionStateIntoBotVault preserves existing vault identity fields when sync is partial", () => {
  const merged = mergeExecutionStateIntoBotVault(
    {
      id: "bv_1",
      executionStatus: "created",
      providerMetadataSummary: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        agentWallet: "0x2222222222222222222222222222222222222222",
        marketDataExchange: "hyperliquid",
        providerMode: "demo"
      }
    },
    {
      status: "running",
      observedAt: "2026-03-26T10:00:00.000Z",
      providerMetadata: {
        providerState: {
          marketDataExchange: "hyperliquid",
          providerMode: "demo"
        }
      }
    },
    false
  );

  assert.equal(merged?.executionStatus, "running");
  assert.equal(merged?.providerMetadataSummary?.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(merged?.providerMetadataSummary?.agentWallet, "0x2222222222222222222222222222222222222222");
});

test("mergeExecutionStateIntoBotVault enriches existing summary with new non-null fields", () => {
  const merged = mergeExecutionStateIntoBotVault(
    {
      id: "bv_1",
      providerMetadataSummary: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        agentWallet: null,
        marketDataExchange: null,
        providerMode: "demo",
        providerSelectionReason: "sticky_existing_vault"
      }
    },
    {
      providerMetadata: {
        providerSelectionReason: "synced_enrichment",
        providerState: {
          marketDataExchange: "hyperliquid",
          agentWallet: "0x3333333333333333333333333333333333333333",
          lastAction: "assignAgent"
        }
      }
    },
    false
  );

  assert.equal(merged?.providerMetadataSummary?.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(merged?.providerMetadataSummary?.agentWallet, "0x3333333333333333333333333333333333333333");
  assert.equal(merged?.providerMetadataSummary?.marketDataExchange, "hyperliquid");
  assert.equal(merged?.providerMetadataSummary?.providerSelectionReason, "synced_enrichment");
  assert.equal(merged?.providerMetadataSummary?.lastAction, "assignAgent");
});

test("mergeExecutionStateIntoBotVault allows complete synced metadata to override summary fields", () => {
  const merged = mergeExecutionStateIntoBotVault(
    {
      id: "bv_1",
      providerMetadataSummary: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        agentWallet: "0x2222222222222222222222222222222222222222",
        marketDataExchange: "hyperliquid",
        providerMode: "demo"
      }
    },
    {
      providerMetadata: {
        providerMode: "live",
        marketDataExchange: "hyperliquid",
        vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        agentWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        providerState: {
          lastAction: "startBotExecution"
        }
      }
    },
    false
  );

  assert.equal(merged?.providerMetadataSummary?.vaultAddress, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(merged?.providerMetadataSummary?.agentWallet, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(merged?.providerMetadataSummary?.providerMode, "live");
  assert.equal(merged?.providerMetadataSummary?.lastAction, "startBotExecution");
});

test("deriveHasOnchainBotVault stays true for stable identity fields and close-only states", () => {
  assert.equal(
    deriveHasOnchainBotVault({
      onchainVaultAddress: "0x1111111111111111111111111111111111111111"
    }),
    true
  );
  assert.equal(
    deriveHasOnchainBotVault({
      providerMetadataSummary: {},
      executionStatus: "close_only"
    }),
    true
  );
  assert.equal(
    deriveHasOnchainBotVault({
      providerMetadataSummary: {}
    }),
    false
  );
});

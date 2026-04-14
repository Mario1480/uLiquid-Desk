import assert from "node:assert/strict";
import test from "node:test";
import { deriveHasOnchainBotVault, mapGridInstanceRow, mergeExecutionStateIntoBotVault } from "./mappers.js";

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

test("mapGridInstanceRow exposes BotVault v3 execution readiness", () => {
  const mapped = mapGridInstanceRow({
    id: "grid_1",
    workspaceId: "ws_1",
    userId: "user_1",
    exchangeAccountId: "acct_1",
    templateId: "tpl_1",
    botId: "bot_1",
    state: "created",
    archivedAt: null,
    archivedReason: null,
    investUsd: 200,
    leverage: 5,
    extraMarginUsd: 0,
    slippagePct: 0.2,
    autoMarginEnabled: false,
    template: {
      id: "tpl_1",
      symbol: "BTCUSDT",
      marketType: "perp",
      mode: "long",
      gridMode: "arithmetic",
      lowerPrice: 60000,
      upperPrice: 70000,
      gridCount: 10
    },
    bot: {
      id: "bot_1",
      name: "Grid",
      symbol: "BTCUSDT",
      status: "running",
      exchange: "hyperliquid",
      exchangeAccount: {
        id: "acct_1",
        exchange: "hyperliquid",
        label: "Hyperliquid"
      }
    },
    botVault: {
      id: "bv_1",
      userId: "user_1",
      masterVaultId: "mv_1",
      templateId: "tpl_1",
      gridInstanceId: "grid_1",
      botId: "bot_1",
      vaultModel: "bot_vault_v3",
      status: "FUNDED",
      vaultAddress: `0x${"1".repeat(40)}`,
      fundingStatus: "hyper_evm_confirmed_onchain",
      hypercoreFundingStatus: "pending",
      executionStatus: "created",
      executionMetadata: {
        marginAddFinalization: {
          verificationState: "transfer_submitted",
          verificationBlockingReason: "transfer_not_yet_observed"
        }
      },
      onchainActions: []
    }
  });

  assert.equal(mapped.botVault?.executionReadiness?.ready, false);
  assert.equal(mapped.botVault?.executionReadiness?.reason, "bot_vault_v3_hypercore_transfer_not_observed");
});

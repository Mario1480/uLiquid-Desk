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
      onchainBotVaultAddress: `0x${"2".repeat(40)}`,
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
  assert.equal(mapped.botVault?.executionReadiness?.stage, "blocked");
  assert.equal(mapped.botVault?.executionReadiness?.reason, "bot_vault_v3_execution_blocked");
  assert.equal(mapped.botVault?.executionReadiness?.detail, "created");
  assert.equal(mapped.botVault?.executionReadiness?.verificationBlockingReason, "transfer_not_yet_observed");
});

test("mapGridInstanceRow exposes BotVault v3 reconciliation state", () => {
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
      status: "ACTIVE",
      vaultAddress: `0x${"1".repeat(40)}`,
      fundingStatus: "hyper_evm_confirmed_onchain",
      hypercoreFundingStatus: "funded",
      executionStatus: "running",
      executionMetadata: {
        botVaultV3Reconciliation: {
          status: "warning",
          checkedAt: "2026-04-14T00:00:00.000Z",
          detail: "db_onchain_available_usd_mismatch",
          autoApplied: true,
          issues: [
            {
              code: "db_onchain_available_usd_mismatch",
              severity: "warning",
              statusCategory: "retryable",
              mismatchCategory: "observed_state_incomplete",
              recoveryAction: "retry",
              recoveryHint: "retry_reconcile",
              sourceOfTruth: "onchain",
              detail: "availableUsd differed from onchain EVM USDC balance and was resynced"
            }
          ],
          executionSnapshot: {
            state: "ok",
            coreSpotUsd: 0,
            perpAvailableMarginUsd: 15,
            perpEquityUsd: 20,
            totalVisibleUsd: 20,
            detail: null
          }
        }
      },
      onchainActions: []
    }
  });

  assert.equal(mapped.botVault?.reconciliation?.status, "warning");
  assert.equal(mapped.botVault?.reconciliation?.issues?.[0]?.code, "db_onchain_available_usd_mismatch");
  assert.equal(mapped.botVault?.statusReason, "db_onchain_available_usd_mismatch");
  assert.equal(mapped.botVault?.statusMismatchCategory, "observed_state_incomplete");
  assert.equal(mapped.botVault?.statusRecoveryAction, "retry");
  assert.equal(mapped.botVault?.statusRecoveryHint, "retry_reconcile");
  assert.equal(mapped.botVault?.reconciliation?.executionSnapshot?.state, "ok");
});

function buildGridInstanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grid_health_1",
    workspaceId: "ws_1",
    userId: "user_1",
    exchangeAccountId: "acct_1",
    templateId: "tpl_1",
    botId: "bot_1",
    state: "running",
    archivedAt: null,
    archivedReason: null,
    investUsd: 200,
    leverage: 5,
    extraMarginUsd: 0,
    slippagePct: 0.2,
    autoMarginEnabled: false,
    stateJson: {},
    metricsJson: {},
    lastPlanAt: "2026-04-17T10:00:00.000Z",
    lastPlanError: null,
    createdAt: "2026-04-17T09:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
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
    ...overrides
  };
}

test("mapGridInstanceRow exposes explicit grid health diagnostics", () => {
  const mapped = mapGridInstanceRow(buildGridInstanceRow({
    stateJson: {
      gridHealth: {
        code: "awaiting_market_price",
        severity: "warning",
        reason: "grid_missing_mark_price",
        updatedAt: "2026-04-17T10:01:00.000Z",
        details: {
          markPriceFallback: "adapter_ticker_failed"
        }
      }
    }
  }));

  assert.deepEqual(mapped.health, {
    code: "awaiting_market_price",
    severity: "warning",
    reason: "grid_missing_mark_price",
    updatedAt: "2026-04-17T10:01:00.000Z",
    details: {
      markPriceFallback: "adapter_ticker_failed"
    }
  });
});

test("mapGridInstanceRow derives running_unseeded when the bot is live without seed or position", () => {
  const mapped = mapGridInstanceRow(buildGridInstanceRow({
    stateJson: {
      initialSeedPending: true,
      initialSeedExecuted: false
    },
    metricsJson: {
      initialSeedExecuted: false,
      openOrdersCount: 0,
      positionSnapshot: {
        qty: 0
      }
    }
  }));

  assert.deepEqual(mapped.health, {
    code: "running_unseeded",
    severity: "warning",
    reason: "grid_initial_seed_confirmation_pending",
    updatedAt: "2026-04-17T10:00:00.000Z",
    details: {
      seedPending: true,
      initialSeedExecuted: false,
      openOrdersCount: 0
    }
  });
});

test("mapGridInstanceRow derives active_no_orders when a seeded bot has no active orders", () => {
  const mapped = mapGridInstanceRow(buildGridInstanceRow({
    stateJson: {
      initialSeedExecuted: true
    },
    metricsJson: {
      initialSeedExecuted: true,
      openOrdersCount: 0,
      positionSnapshot: {
        qty: 0.012
      }
    }
  }));

  assert.deepEqual(mapped.health, {
    code: "active_no_orders",
    severity: "warning",
    reason: "grid_running_without_active_orders",
    updatedAt: "2026-04-17T10:00:00.000Z",
    details: {
      openOrdersCount: 0,
      hasOpenPosition: true
    }
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { createGridLifecycleService } from "./lifecycle.js";
import { ManualTradingError } from "../trading.js";

function buildGridRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grid_1",
    userId: "user_1",
    botId: "bot_1",
    exchangeAccountId: "acct_1",
    state: "created",
    investUsd: 200,
    extraMarginUsd: 0,
    leverage: 5,
    slippagePct: 0.2,
    marginMode: "MANUAL",
    autoMarginEnabled: false,
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: 70,
    autoReserveTargetLiqDistancePct: null,
    autoReserveMaxPreviewIterations: 8,
    activeOrderWindowSize: 100,
    recenterDriftLevels: 1,
    tpPct: null,
    slPrice: null,
    triggerPrice: null,
    stateJson: {},
    template: {
      id: "tpl_1",
      symbol: "BTCUSDT",
      marketType: "perp",
      mode: "long",
      lowerPrice: 60000,
      upperPrice: 70000,
      gridCount: 10,
      autoReservePolicy: "LIQ_GUARD_MAX_GRID",
      autoReserveFixedGridPct: 70,
      autoReserveTargetLiqDistancePct: null,
      autoReserveMaxPreviewIterations: 8,
      activeOrderWindowSize: 100,
      recenterDriftLevels: 1
    },
    bot: {
      exchange: "hyperliquid",
      exchangeAccount: {
        exchange: "hyperliquid"
      }
    },
    botVault: null,
    ...overrides
  };
}

test("startGridInstanceNow blocks BotVault v3 execution when funding is only requested", async () => {
  const service = createGridLifecycleService({
    db: {
      gridBotInstance: {
        update() {
          throw new Error("should_not_update_grid");
        }
      },
      bot: {
        update() {
          throw new Error("should_not_update_bot");
        }
      },
      $transaction() {
        throw new Error("should_not_run_transaction");
      }
    },
    vaultService: {
      activateBotVaultForGridInstance() {
        throw new Error("should_not_activate_vault");
      }
    } as any,
    resolveVenueContext: async () => ({
      markPrice: 65000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: 0.0001,
        qtyStep: 0.0001,
        priceTick: 1,
        minNotional: 10,
        feeRate: 0.0005
      },
      feeBufferPct: 0.1,
      mmrPct: 0.005,
      liqDistanceMinPct: 1,
      warnings: []
    }),
    allowedGridExchanges: new Set(["hyperliquid"])
  });

  await assert.rejects(
    () => service.startGridInstanceNow({
      row: buildGridRow({
        botVault: {
          vaultModel: "bot_vault_v3",
          vaultAddress: `0x${"1".repeat(40)}`,
          status: "FUNDED",
          executionStatus: "created",
          fundingStatus: "hyper_evm_funding_requested",
          hypercoreFundingStatus: "not_funded"
        }
      }),
      userId: "user_1"
    }),
    (error: unknown) => {
      assert.ok(error instanceof ManualTradingError);
      assert.equal((error as ManualTradingError).code, "bot_vault_v3_execution_not_ready");
      assert.equal((error as Error).message, "bot_vault_v3_funding_requested_not_confirmed");
      return true;
    }
  );
});

test("startGridInstanceNow blocks BotVault v3 execution when HyperCore funding is not started", async () => {
  const service = createGridLifecycleService({
    db: {
      gridBotInstance: {
        update() {
          throw new Error("should_not_update_grid");
        }
      },
      bot: {
        update() {
          throw new Error("should_not_update_bot");
        }
      },
      $transaction() {
        throw new Error("should_not_run_transaction");
      }
    },
    vaultService: {
      activateBotVaultForGridInstance() {
        throw new Error("should_not_activate_vault");
      }
    } as any,
    resolveVenueContext: async () => ({
      markPrice: 65000,
      marketDataVenue: "hyperliquid",
      venueConstraints: {
        minQty: 0.0001,
        qtyStep: 0.0001,
        priceTick: 1,
        minNotional: 10,
        feeRate: 0.0005
      },
      feeBufferPct: 0.1,
      mmrPct: 0.005,
      liqDistanceMinPct: 1,
      warnings: []
    }),
    allowedGridExchanges: new Set(["hyperliquid"])
  });

  await assert.rejects(
    () => service.startGridInstanceNow({
      row: buildGridRow({
        botVault: {
          vaultModel: "bot_vault_v3",
          vaultAddress: `0x${"2".repeat(40)}`,
          status: "FUNDED",
          executionStatus: "created",
          fundingStatus: "hyper_evm_confirmed_onchain",
          hypercoreFundingStatus: "not_funded"
        }
      }),
      userId: "user_1"
    }),
    (error: unknown) => {
      assert.ok(error instanceof ManualTradingError);
      assert.equal((error as ManualTradingError).code, "bot_vault_v3_execution_not_ready");
      assert.equal((error as Error).message, "bot_vault_v3_hypercore_funding_not_started");
      return true;
    }
  );
});

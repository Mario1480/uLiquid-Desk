import assert from "node:assert/strict";
import test from "node:test";
import {
  getVaultProfitShareTreasurySettings,
  normalizeProfitShareFeeRatePct,
  normalizeTreasuryWalletAddress,
  setVaultProfitShareTreasurySettings
} from "./profitShareTreasury.settings.js";
import { GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY } from "./executionMode.js";
import { GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY } from "./profitShareTreasury.settings.js";

function createDb(initialValue: unknown = null, actions: any[] = []) {
  let value = initialValue;
  let updatedAt = new Date("2026-03-11T10:00:00.000Z");

  return {
    globalSetting: {
      async findUnique(input: any) {
        const key = String(input?.where?.key ?? "");
        if (key === GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY) {
          return { value: { mode: "offchain_shadow" }, updatedAt };
        }
        if (key !== GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY || value == null) return null;
        return { value, updatedAt };
      },
      async upsert(input: any) {
        value = input.update?.value ?? input.create?.value ?? null;
        updatedAt = new Date("2026-03-11T10:05:00.000Z");
        return { updatedAt };
      }
    },
    onchainAction: {
      async findMany() {
        return actions;
      }
    }
  };
}

test("normalizeTreasuryWalletAddress returns checksum address", () => {
  assert.equal(
    normalizeTreasuryWalletAddress("0x000000000000000000000000000000000000beef"),
    "0x000000000000000000000000000000000000bEEF"
  );
  assert.equal(normalizeTreasuryWalletAddress("invalid"), null);
});

test("normalizeProfitShareFeeRatePct validates integer percentage", () => {
  assert.equal(normalizeProfitShareFeeRatePct(20), 20);
  assert.equal(normalizeProfitShareFeeRatePct(0), 0);
  assert.equal(normalizeProfitShareFeeRatePct(100), 100);
  assert.equal(normalizeProfitShareFeeRatePct(20.5), null);
  assert.equal(normalizeProfitShareFeeRatePct(101), null);
});

test("setVaultProfitShareTreasurySettings persists wallet and returns pending before onchain sync", async () => {
  const db = createDb();
  const saved = await setVaultProfitShareTreasurySettings(db as any, {
    enabled: true,
    walletAddress: "0x000000000000000000000000000000000000beef",
    feeRatePct: 20
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.walletAddress, "0x000000000000000000000000000000000000bEEF");
  assert.equal(saved.feeRatePct, 20);
  assert.equal(saved.onchainSyncStatus, "pending");
  assert.equal(saved.feeRateSyncStatus, "pending");
});

test("getVaultProfitShareTreasurySettings reports pending when latest config tx targets current wallet", async () => {
  const db = createDb(
    {
      enabled: true,
      walletAddress: "0x000000000000000000000000000000000000beef",
      feeRatePct: 25
    },
    [
      {
        id: "action_1",
        actionType: "set_treasury_recipient",
        txHash: "0x1234",
        status: "submitted",
        metadata: {
          requestedRecipient: "0x000000000000000000000000000000000000bEEF"
        }
      },
      {
        id: "action_2",
        actionType: "set_profit_share_fee_rate",
        txHash: "0x2345",
        status: "submitted",
        metadata: {
          requestedFeeRatePct: 25
        }
      }
    ]
  );

  const settings = await getVaultProfitShareTreasurySettings(db as any);
  assert.equal(settings.onchainSyncStatus, "pending");
  assert.equal(settings.feeRateSyncStatus, "pending");
  assert.equal(settings.lastSyncActionId, "action_1");
  assert.equal(settings.lastSyncTxHash, "0x1234");
});

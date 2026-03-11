import assert from "node:assert/strict";
import test from "node:test";
import {
  getVaultProfitShareTreasurySettings,
  normalizeTreasuryWalletAddress,
  setVaultProfitShareTreasurySettings
} from "./profitShareTreasury.settings.js";

function createDb(initialValue: unknown = null, actions: any[] = []) {
  let value = initialValue;
  let updatedAt = new Date("2026-03-11T10:00:00.000Z");

  return {
    globalSetting: {
      async findUnique() {
        if (value == null) return null;
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

test("setVaultProfitShareTreasurySettings persists wallet and returns pending before onchain sync", async () => {
  const db = createDb();
  const saved = await setVaultProfitShareTreasurySettings(db as any, {
    enabled: true,
    walletAddress: "0x000000000000000000000000000000000000beef"
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.walletAddress, "0x000000000000000000000000000000000000bEEF");
  assert.equal(saved.onchainSyncStatus, "pending");
});

test("getVaultProfitShareTreasurySettings reports pending when latest config tx targets current wallet", async () => {
  const db = createDb(
    {
      enabled: true,
      walletAddress: "0x000000000000000000000000000000000000beef"
    },
    [{
      id: "action_1",
      txHash: "0x1234",
      status: "submitted",
      metadata: {
        requestedRecipient: "0x000000000000000000000000000000000000bEEF"
      }
    }]
  );

  const settings = await getVaultProfitShareTreasurySettings(db as any);
  assert.equal(settings.onchainSyncStatus, "pending");
  assert.equal(settings.lastSyncActionId, "action_1");
  assert.equal(settings.lastSyncTxHash, "0x1234");
});

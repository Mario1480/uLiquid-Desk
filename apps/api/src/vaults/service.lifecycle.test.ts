import assert from "node:assert/strict";
import test from "node:test";
import { mapBotVaultSnapshot } from "./service.js";

test("mapBotVaultSnapshot derives withdraw pending lifecycle from pending onchain action", () => {
  const snapshot = mapBotVaultSnapshot({
    id: "bv_1",
    userId: "user_1",
    masterVaultId: "mv_1",
    gridInstanceId: "grid_1",
    botId: null,
    principalAllocated: 100,
    principalReturned: 100,
    realizedPnlNet: 20,
    feePaidTotal: 0,
    highWaterMark: 0,
    allocatedUsd: 100,
    realizedGrossUsd: 20,
    realizedFeesUsd: 0,
    realizedNetUsd: 20,
    profitShareAccruedUsd: 0,
    withdrawnUsd: 0,
    availableUsd: 20,
    executionProvider: "mock",
    executionUnitId: "unit_1",
    executionStatus: "paused",
    executionLastSyncedAt: new Date("2026-03-19T10:00:00.000Z"),
    executionLastError: null,
    executionLastErrorAt: null,
    executionMetadata: {},
    status: "ACTIVE",
    lastAccountingAt: null,
    updatedAt: new Date("2026-03-19T10:00:00.000Z"),
    onchainActions: [
      {
        actionKey: "claim_1",
        actionType: "claim_from_bot_vault",
        status: "submitted",
        updatedAt: new Date("2026-03-19T10:05:00.000Z")
      }
    ]
  });

  assert.equal(snapshot.lifecycle.state, "withdraw_pending");
  assert.equal(snapshot.lifecycle.pendingActionKey, "claim_1");
  assert.equal(snapshot.lifecycle.pendingActionUpdatedAt, "2026-03-19T10:05:00.000Z");
});

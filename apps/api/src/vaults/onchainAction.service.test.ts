import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCloseBotVaultPreflight,
  assertSetBotVaultCloseOnlyPreflight,
  computeSettlementPreview,
  deriveClaimFromBotVaultSettlement,
  deriveCloseBotVaultSettlement
} from "./onchainAction.service.js";
import { computeFeeSettlementMath } from "./feeSettlement.math.js";

test("assertCloseBotVaultPreflight requires onchain close-only status", () => {
  assert.throws(
    () =>
      assertCloseBotVaultPreflight({
        onchainStatus: "ACTIVE",
        releasedReservedUsd: 240,
        grossReturnedUsd: 240,
        principalOutstandingUsd: 240,
        reservedBalanceUsd: 240,
        tokenSurplusUsd: 0
      }),
    /bot_vault_onchain_close_only_required:ACTIVE/
  );
});

test("assertCloseBotVaultPreflight rejects close values beyond principal and surplus", () => {
  assert.throws(
    () =>
      assertCloseBotVaultPreflight({
        onchainStatus: "CLOSE_ONLY",
        releasedReservedUsd: 260,
        grossReturnedUsd: 260,
        principalOutstandingUsd: 240,
        reservedBalanceUsd: 240,
        tokenSurplusUsd: 0
      }),
    /bot_vault_released_reserved_exceeds_outstanding/
  );

  assert.throws(
    () =>
      assertCloseBotVaultPreflight({
        onchainStatus: "CLOSE_ONLY",
        releasedReservedUsd: 240,
        grossReturnedUsd: 241,
        principalOutstandingUsd: 240,
        reservedBalanceUsd: 240,
        tokenSurplusUsd: 0
      }),
    /bot_vault_gross_return_exceeds_limit/
  );
});

test("assertCloseBotVaultPreflight accepts valid close settlement values", () => {
  assert.doesNotThrow(() =>
    assertCloseBotVaultPreflight({
      onchainStatus: "CLOSE_ONLY",
      releasedReservedUsd: 240,
      grossReturnedUsd: 240,
      principalOutstandingUsd: 240,
      reservedBalanceUsd: 240,
      tokenSurplusUsd: 0
    })
  );
});

test("assertSetBotVaultCloseOnlyPreflight blocks noop or invalid statuses", () => {
  assert.throws(
    () => assertSetBotVaultCloseOnlyPreflight({ onchainStatus: "CLOSE_ONLY" }),
    /bot_vault_onchain_close_only_already_set:CLOSE_ONLY/
  );
  assert.throws(
    () => assertSetBotVaultCloseOnlyPreflight({ onchainStatus: "CLOSED" }),
    /bot_vault_onchain_close_only_already_set:CLOSED/
  );
  assert.throws(
    () => assertSetBotVaultCloseOnlyPreflight({ onchainStatus: "UNKNOWN" }),
    /bot_vault_onchain_close_only_invalid_status:UNKNOWN/
  );
  assert.doesNotThrow(() => assertSetBotVaultCloseOnlyPreflight({ onchainStatus: "ACTIVE" }));
});

test("deriveCloseBotVaultSettlement auto-derives full close values from current state", () => {
  assert.deepEqual(
    deriveCloseBotVaultSettlement({
      dbAvailableUsd: 240,
      dbPrincipalAllocatedUsd: 240,
      dbPrincipalReturnedUsd: 0,
      onchainPrincipalOutstandingUsd: 240,
      onchainReservedBalanceUsd: 240,
      onchainTokenSurplusUsd: 0
    }),
    {
      releasedReservedUsd: 240,
      grossReturnedUsd: 240,
      defaults: {
        releasedReservedUsd: 240,
        grossReturnedUsd: 240
      },
      limits: {
        maxReleasedReservedUsd: 240,
        maxGrossReturnedUsd: 240
      }
    }
  );
});

test("deriveCloseBotVaultSettlement caps auto gross return at onchain close limit", () => {
  const result = deriveCloseBotVaultSettlement({
    dbAvailableUsd: 300,
    dbPrincipalAllocatedUsd: 240,
    dbPrincipalReturnedUsd: 0,
    onchainPrincipalOutstandingUsd: 240,
    onchainReservedBalanceUsd: 240,
    onchainTokenSurplusUsd: 15
  });

  assert.equal(result.releasedReservedUsd, 240);
  assert.equal(result.grossReturnedUsd, 255);
  assert.equal(result.limits.maxGrossReturnedUsd, 255);
});

test("deriveCloseBotVaultSettlement prefers onchain settlement state when db values lag behind", () => {
  const result = deriveCloseBotVaultSettlement({
    dbAvailableUsd: 0,
    dbPrincipalAllocatedUsd: 0,
    dbPrincipalReturnedUsd: 0,
    onchainPrincipalOutstandingUsd: 50,
    onchainReservedBalanceUsd: 50,
    onchainTokenSurplusUsd: 0
  });

  assert.equal(result.releasedReservedUsd, 50);
  assert.equal(result.grossReturnedUsd, 50);
  assert.equal(result.defaults.releasedReservedUsd, 50);
  assert.equal(result.defaults.grossReturnedUsd, 50);
});

test("deriveClaimFromBotVaultSettlement auto-derives profit-only claim amount", () => {
  assert.deepEqual(
    deriveClaimFromBotVaultSettlement({
      dbAvailableUsd: 280,
      dbPrincipalAllocatedUsd: 240,
      dbPrincipalReturnedUsd: 0,
      onchainTokenSurplusUsd: 40
    }),
    {
      releasedReservedUsd: 0,
      grossReturnedUsd: 40,
      defaults: {
        releasedReservedUsd: 0,
        grossReturnedUsd: 40
      },
      limits: {
        maxGrossReturnedUsd: 40
      }
    }
  );
});

test("deriveClaimFromBotVaultSettlement caps claim at onchain token surplus", () => {
  const result = deriveClaimFromBotVaultSettlement({
    dbAvailableUsd: 300,
    dbPrincipalAllocatedUsd: 240,
    dbPrincipalReturnedUsd: 0,
    onchainTokenSurplusUsd: 15
  });

  assert.equal(result.releasedReservedUsd, 0);
  assert.equal(result.grossReturnedUsd, 15);
  assert.equal(result.limits.maxGrossReturnedUsd, 15);
});

test("computeSettlementPreview delegates fee math to centralized settlement logic", () => {
  const preview = computeSettlementPreview({
    contractVersion: "v4",
    treasuryPayoutModel: "direct_split_v4",
    treasuryRecipient: "0x4444444444444444444444444444444444444444",
    feeRatePct: 30,
    releasedReservedUsd: 100,
    grossReturnedUsd: 150,
    realizedPnlBeforeSettlementUsd: 30,
    highWaterMarkUsd: 20
  });
  const centralized = computeFeeSettlementMath({
    mode: "FINAL_CLOSE",
    availableUsd: 150,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 80,
    highWaterMarkUsd: 20,
    feeRatePct: 30
  });

  assert.equal(preview.feeBaseUsd, centralized.feeBaseUsd);
  assert.equal(preview.feeAmountUsd, centralized.feeAmountUsd);
  assert.equal(preview.netReturnedUsd, centralized.netTransferUsd);
  assert.equal(preview.highWaterMarkBeforeUsd, centralized.highWaterMarkBeforeUsd);
  assert.equal(preview.highWaterMarkAfterUsd, centralized.highWaterMarkAfterUsd);
});

test("computeSettlementPreview treats pnl input as pre-settlement realized pnl", () => {
  const profitReturn = computeSettlementPreview({
    contractVersion: "v4",
    treasuryPayoutModel: "direct_split_v4",
    treasuryRecipient: null,
    feeRatePct: 20,
    releasedReservedUsd: 100,
    grossReturnedUsd: 125,
    realizedPnlBeforeSettlementUsd: 0,
    highWaterMarkUsd: 0
  });
  assert.equal(profitReturn.realizedPnlAfterUsd, 25);
  assert.equal(profitReturn.feeBaseUsd, 25);

  const lossReturn = computeSettlementPreview({
    contractVersion: "v4",
    treasuryPayoutModel: "direct_split_v4",
    treasuryRecipient: null,
    feeRatePct: 20,
    releasedReservedUsd: 100,
    grossReturnedUsd: 80,
    realizedPnlBeforeSettlementUsd: 0,
    highWaterMarkUsd: 0
  });
  assert.equal(lossReturn.realizedPnlAfterUsd, -20);
  assert.equal(lossReturn.feeBaseUsd, 0);

  const alreadyFinalized = computeSettlementPreview({
    contractVersion: "v4",
    treasuryPayoutModel: "direct_split_v4",
    treasuryRecipient: null,
    feeRatePct: 20,
    releasedReservedUsd: 0,
    grossReturnedUsd: 0,
    realizedPnlBeforeSettlementUsd: 12,
    highWaterMarkUsd: 5
  });
  assert.equal(alreadyFinalized.realizedPnlAfterUsd, 12);
  assert.equal(alreadyFinalized.feeBaseUsd, 7);
});

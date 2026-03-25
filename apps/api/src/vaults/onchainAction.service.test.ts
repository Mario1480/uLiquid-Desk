import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCloseBotVaultPreflight,
  assertSetBotVaultCloseOnlyPreflight
} from "./onchainAction.service.js";

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

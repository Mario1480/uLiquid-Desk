import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBotVaultGridReadiness,
  getBotVaultGridReadiness
} from "./botVaultGridReadiness.js";

function readyVault(overrides: Record<string, unknown> = {}) {
  return {
    botVaultId: "bv_1",
    userId: "user_1",
    gridInstanceId: "grid_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    status: "ACTIVE",
    executionStatus: "running",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionMetadata: {
      marginAddFinalization: {
        verificationState: "funding_verified",
        fundingVerified: true
      }
    },
    ...overrides
  };
}

test("getBotVaultGridReadiness returns ready for active funded assigned vault", () => {
  const readiness = getBotVaultGridReadiness({
    userId: "user_1",
    gridInstanceId: "grid_1",
    botId: "bot_1",
    botVault: readyVault(),
    minOrderQty: 0.001,
    minOrderNotionalUsd: 10,
    plannedOrderQty: 0.002,
    plannedOrderNotionalUsd: 20
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reasonCode, null);
});

test("getBotVaultGridReadiness blocks at least five production readiness failures", () => {
  const cases: Array<{
    name: string;
    botVault: Record<string, unknown>;
    input?: Record<string, unknown>;
    reasonCode: string;
    recoveryHint: string | null;
  }> = [
    {
      name: "inactive vault",
      botVault: readyVault({ status: "FUNDED", executionStatus: "created" }),
      reasonCode: "bot_vault_grid_vault_not_active",
      recoveryHint: "retry_reconcile"
    },
    {
      name: "user mismatch",
      botVault: readyVault({ userId: "other_user" }),
      reasonCode: "bot_vault_grid_user_mismatch",
      recoveryHint: "request_user_action"
    },
    {
      name: "hypercore funding missing",
      botVault: readyVault({ hypercoreFundingStatus: "not_funded" }),
      reasonCode: "bot_vault_grid_hypercore_funding_not_confirmed",
      recoveryHint: "retry_reconcile"
    },
    {
      name: "perp funding not verified",
      botVault: readyVault({
        executionMetadata: {
          marginAddFinalization: {
            verificationState: "transfer_submitted",
            verificationBlockingReason: "transfer_not_yet_observed"
          }
        }
      }),
      reasonCode: "transfer_not_yet_observed",
      recoveryHint: "retry_reconcile"
    },
    {
      name: "pending contract balance reconciliation",
      botVault: readyVault({
        executionMetadata: {
          marginAddFinalization: {
            verificationState: "funding_verified",
            fundingVerified: true
          },
          contractBalanceReconciliation: {
            state: "pending_reconciliation",
            reasonCode: "insufficient_contract_balance",
            expectedAmountAtomic: "1000000",
            actualBalanceAtomic: "0"
          }
        }
      }),
      reasonCode: "insufficient_contract_balance",
      recoveryHint: "retry_reconcile"
    },
    {
      name: "below minimum notional",
      botVault: readyVault(),
      input: {
        minOrderNotionalUsd: 25,
        plannedOrderNotionalUsd: 5
      },
      reasonCode: "bot_vault_grid_order_notional_below_minimum",
      recoveryHint: "request_user_action"
    }
  ];

  for (const item of cases) {
    const readiness = getBotVaultGridReadiness({
      userId: "user_1",
      gridInstanceId: "grid_1",
      botId: "bot_1",
      botVault: item.botVault,
      minOrderQty: 0.001,
      minOrderNotionalUsd: 10,
      plannedOrderQty: 0.002,
      plannedOrderNotionalUsd: 20,
      ...item.input
    });

    assert.equal(readiness.ready, false, item.name);
    assert.equal(readiness.reasonCode, item.reasonCode, item.name);
    assert.equal(readiness.recoveryHint, item.recoveryHint, item.name);
    assert.ok(readiness.blockers.length >= 1, item.name);
  }
});

test("assertBotVaultGridReadiness throws with UI recovery metadata", () => {
  assert.throws(
    () => assertBotVaultGridReadiness({
      userId: "user_1",
      gridInstanceId: "grid_1",
      botId: "bot_1",
      botVault: readyVault({ gridInstanceId: "grid_2" })
    }),
    (error: unknown) => {
      assert.equal((error as Error).name, "BotVaultGridReadinessError");
      const readiness = (error as any).readiness;
      assert.equal(readiness.reasonCode, "bot_vault_grid_instance_mismatch");
      assert.equal(readiness.recoveryHint, "request_user_action");
      return true;
    }
  );
});

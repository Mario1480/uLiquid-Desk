import assert from "node:assert/strict";
import test from "node:test";
import { AiCreditError, isAiCreditBillingEnabledForDatabase, releaseAiReservation, reserveAiCredits } from "./creditService.js";

function reservationDatabase(balance = 100n) {
  const state = {
    subscription: { id: "sub-1", userId: "user-1", aiCreditBalance: balance, aiCreditsReserved: 0n, aiMaxRunCredits: null, aiDailyLimitCredits: null, aiMonthlyLimitCredits: null },
    reservations: [] as any[],
    ledger: [] as any[]
  };
  const database: any = {
    globalSetting: { findUnique: async () => ({ value: { aiCreditBillingEnabled: true } }) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(database),
    userSubscription: {
      upsert: async () => ({ ...state.subscription }),
      findUnique: async () => ({ ...state.subscription }),
      updateMany: async ({ where, data }: any) => {
        if (where.aiCreditBalance !== undefined && where.aiCreditBalance !== state.subscription.aiCreditBalance) return { count: 0 };
        if (where.aiCreditsReserved !== undefined && where.aiCreditsReserved !== state.subscription.aiCreditsReserved) return { count: 0 };
        state.subscription.aiCreditsReserved = data.aiCreditsReserved;
        return { count: 1 };
      }
    },
    aiAgentRun: {
      aggregate: async () => ({ _sum: { chargedCredits: 0n } }),
      update: async () => ({})
    },
    aiCreditReservation: {
      findUnique: async ({ where }: any) => state.reservations.find((row) =>
        where.idempotencyKey ? row.idempotencyKey === where.idempotencyKey : row.agentRunId === where.agentRunId
      ) ?? null,
      create: async ({ data }: any) => {
        const row = { ...data };
        state.reservations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.reservations.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      }
    },
    aiCreditLedger: {
      create: async ({ data }: any) => {
        state.ledger.push(data);
        return data;
      }
    }
  };
  return { database, state };
}

test("database feature flag can disable the rollout flag", async () => {
  const previous = process.env.AI_CREDIT_BILLING_V2;
  process.env.AI_CREDIT_BILLING_V2 = "true";
  try {
    assert.equal(await isAiCreditBillingEnabledForDatabase({ globalSetting: { findUnique: async () => ({ value: { aiCreditBillingEnabled: false } }) } }), false);
  } finally {
    if (previous === undefined) delete process.env.AI_CREDIT_BILLING_V2;
    else process.env.AI_CREDIT_BILLING_V2 = previous;
  }
});

test("reservation is idempotent and release restores available credits", async () => {
  const previous = process.env.AI_CREDIT_BILLING_V2;
  process.env.AI_CREDIT_BILLING_V2 = "true";
  const { database, state } = reservationDatabase();
  try {
    const params = { database, userId: "user-1", agentRunId: "run-1", credits: 30n, idempotencyKey: "request-1:reserve" };
    const first = await reserveAiCredits(params);
    const duplicate = await reserveAiCredits(params);
    assert.equal(first.id, duplicate.id);
    assert.equal(state.subscription.aiCreditsReserved, 30n);
    assert.equal(state.ledger.length, 1);

    await releaseAiReservation({ database, agentRunId: "run-1", reason: "provider_failed_without_usage" });
    await releaseAiReservation({ database, agentRunId: "run-1", reason: "duplicate_release" });
    assert.equal(state.subscription.aiCreditsReserved, 0n);
    assert.equal(state.ledger.length, 2);
  } finally {
    if (previous === undefined) delete process.env.AI_CREDIT_BILLING_V2;
    else process.env.AI_CREDIT_BILLING_V2 = previous;
  }
});

test("reservation fails before dispatch when balance is insufficient", async () => {
  const previous = process.env.AI_CREDIT_BILLING_V2;
  process.env.AI_CREDIT_BILLING_V2 = "true";
  try {
    const { database } = reservationDatabase(5n);
    await assert.rejects(
      reserveAiCredits({ database, userId: "user-1", agentRunId: "run-1", credits: 6n, idempotencyKey: "request-2:reserve" }),
      (error: unknown) => error instanceof AiCreditError && error.code === "ai_credit_balance_exhausted"
    );
  } finally {
    if (previous === undefined) delete process.env.AI_CREDIT_BILLING_V2;
    else process.env.AI_CREDIT_BILLING_V2 = previous;
  }
});

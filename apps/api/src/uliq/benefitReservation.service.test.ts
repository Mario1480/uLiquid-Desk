import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeUliqBenefitReservationInTransaction,
  createUliqBenefitReservationInTransaction,
  expireUliqBenefitReservations,
  prepareUliqBillingBenefit,
  releaseOpenUliqReservationsForWalletChange,
  resolveUliqDiscountSelection,
  type PreparedUliqBillingBenefit,
  UliqBenefitGateError
} from "./benefitReservation.service.js";
import { resolveIndexerAlignedEntitlementBlock } from "./entitlement.service.js";

const now = new Date("2026-08-22T12:00:00.000Z");
const wallet = "0x1111111111111111111111111111111111111111";
const prepared: PreparedUliqBillingBenefit = {
  userId: "user-1",
  walletAddress: wallet,
  entitlementSnapshotId: "snapshot-1",
  priceSnapshotId: "price-1",
  asOfBlock: 100n,
  configVersion: 1,
  tierSnapshot: "GOLD",
  benefitType: "SUBSCRIPTION_DISCOUNT",
  discountBps: 1_500,
  baseAmountCents: 1_000,
  discountAmountCents: 150,
  finalAmountCents: 850,
  expiresAt: new Date(now.getTime() + 600_000),
  priceQualityStatus: "HEALTHY",
  degradationReason: null,
  lockDecision: {
    version: "LOCK_GATE_V1",
    qualifies: true,
    requiredLockedRaw: "100",
    qualifyingLockedRaw: "150",
    qualifyingLockIds: ["7"],
    requiredBenefitUntil: new Date("2026-09-22T12:00:00.000Z"),
    coverageShareBps: 2_500,
    failureReason: null
  },
  plannedTermWindow: {
    startsAt: now,
    endsAt: new Date("2026-09-22T12:00:00.000Z"),
    graceEndsAt: new Date("2026-09-25T12:00:00.000Z")
  },
  sourceSubscriptionTermId: null,
  aiMonthlyCapCents: null,
  lockerContractAddress: "0x4444444444444444444444444444444444444444"
};

const entitlement = {
  id: "snapshot-1",
  walletAddress: wallet,
  validUntil: new Date(now.getTime() + 300_000),
  priceQualityStatus: "HEALTHY",
  priceSnapshotId: "price-1",
  asOfBlock: 100n,
  tierConfigVersion: 1,
  monetaryTier: "GOLD",
  aiDiscountBps: 1_500,
  subscriptionDiscountBps: 1_500,
  degradationReason: null
} as any;

async function withDiscountFlags<T>(run: () => Promise<T>): Promise<T> {
  const previousEnabled = process.env.ULIQ_ENABLED;
  const previousDiscounts = process.env.ULIQ_DISCOUNTS_ENABLED;
  process.env.ULIQ_ENABLED = "true";
  process.env.ULIQ_DISCOUNTS_ENABLED = "true";
  try {
    return await run();
  } finally {
    if (previousEnabled === undefined) delete process.env.ULIQ_ENABLED;
    else process.env.ULIQ_ENABLED = previousEnabled;
    if (previousDiscounts === undefined) delete process.env.ULIQ_DISCOUNTS_ENABLED;
    else process.env.ULIQ_DISCOUNTS_ENABLED = previousDiscounts;
  }
}

test("ULIQ discounts exclude capacity add-ons and reject mixed subscription/AI discount classes", () => {
  assert.equal(resolveUliqDiscountSelection([
    { kind: "addon", addonType: "running_bots" }
  ]), null);
  assert.deepEqual(resolveUliqDiscountSelection([
    { kind: "plan", addonType: null },
    { kind: "addon", addonType: "running_bots" }
  ]), {
    benefitType: "SUBSCRIPTION_DISCOUNT",
    eligibleLineIndexes: [0]
  });
  assert.deepEqual(resolveUliqDiscountSelection([
    { kind: "addon", addonType: "ai_credits" },
    { kind: "addon", addonType: "running_predictions_ai" }
  ]), {
    benefitType: "AI_CREDIT_DISCOUNT",
    eligibleLineIndexes: [0]
  });
  assert.throws(() => resolveUliqDiscountSelection([
    { kind: "plan", addonType: null },
    { kind: "addon", addonType: "ai_credits" }
  ]), /uliq_mixed_discount_types_not_supported/);
});

test("AI discount requires an active subscription term that consumed a ULIQ subscription discount", async () => {
  await withDiscountFlags(async () => {
    await assert.rejects(
      prepareUliqBillingBenefit({
        db: { subscriptionTerm: { findFirst: async () => null } },
        userId: "user-1",
        baseAmountCents: 1_000,
        benefitType: "AI_CREDIT_DISCOUNT",
        entitlementService: {
          getForUser: async () => entitlement,
          getLockDecisionForBenefit: async () => { throw new Error("unexpected_lock_check"); }
        },
        now
      }),
      (error: unknown) => error instanceof UliqBenefitGateError
        && error.message === "uliq_ai_discounted_subscription_required"
    );
  });
});

test("AI discount fails closed when the active tier has no versioned monthly cap", async () => {
  await withDiscountFlags(async () => {
    await assert.rejects(
      prepareUliqBillingBenefit({
        db: {
          subscriptionTerm: {
            findFirst: async () => ({ id: "term-1", endsAt: prepared.lockDecision.requiredBenefitUntil })
          }
        },
        userId: "user-1",
        baseAmountCents: 1_000,
        benefitType: "AI_CREDIT_DISCOUNT",
        entitlementService: {
          getForUser: async () => entitlement,
          getLockDecisionForBenefit: async () => ({
            ...prepared.lockDecision,
            tierCode: "GOLD",
            configVersion: 1,
            monetaryBenefitCaps: null,
            lockerContractAddress: prepared.lockerContractAddress
          })
        },
        now
      }),
      (error: unknown) => error instanceof UliqBenefitGateError
        && error.message === "uliq_ai_cap_unconfigured"
    );
  });
});

test("subscription discount aligns its entitlement snapshot to the finalized indexer cursor", async () => {
  await withDiscountFlags(async () => {
    let entitlementOptions: Record<string, unknown> | null = null;
    const result = await prepareUliqBillingBenefit({
      db: {},
      userId: "user-1",
      baseAmountCents: 1_000,
      benefitType: "SUBSCRIPTION_DISCOUNT",
      requiredBenefitUntil: prepared.lockDecision.requiredBenefitUntil,
      entitlementService: {
        getForUser: async (_userId, options) => {
          entitlementOptions = options as Record<string, unknown>;
          return entitlement;
        },
        getLockDecisionForBenefit: async () => ({
          ...prepared.lockDecision,
          tierCode: "GOLD",
          tierMinimumUsd: "1500",
          priceSnapshotId: "price-1",
          configVersion: 1,
          lockerContractAddress: prepared.lockerContractAddress,
          monetaryBenefitCaps: null
        })
      },
      now
    });
    assert.equal(result.discountAmountCents, 150);
    assert.equal(result.finalAmountCents, 850);
    assert.deepEqual(entitlementOptions, {
      forceRefresh: true,
      alignToIndexer: true,
      now
    });
  });
});

test("entitlement alignment uses only clean finalized indexer evidence", () => {
  assert.equal(resolveIndexerAlignedEntitlementBlock({
    finalizedBlock: 120n,
    cursor: { lastProcessedBlock: 100n, failureCount: 0, lastError: null }
  }), 100n);
  assert.equal(resolveIndexerAlignedEntitlementBlock({
    finalizedBlock: 120n,
    cursor: { lastProcessedBlock: 125n, failureCount: 0, lastError: null }
  }), 120n);
  assert.equal(resolveIndexerAlignedEntitlementBlock({
    finalizedBlock: 120n,
    cursor: { lastProcessedBlock: 100n, failureCount: 1, lastError: null }
  }), 120n);
  assert.equal(resolveIndexerAlignedEntitlementBlock({
    finalizedBlock: 120n,
    cursor: { lastProcessedBlock: 100n, failureCount: 0, lastError: "rpc_error" }
  }), 120n);
  assert.equal(resolveIndexerAlignedEntitlementBlock({
    finalizedBlock: 120n,
    cursor: null
  }), 120n);
});

test("reservation creation binds exact wallet/snapshots and ten-minute expiry", async () => {
  let createData: any = null;
  const tx = {
    user: { findUnique: async () => ({ walletAddress: wallet }) },
    uliqEntitlementSnapshot: {
      findUnique: async () => ({
        userId: "user-1",
        walletAddress: wallet,
        chainId: 421614,
        validUntil: new Date(now.getTime() + 300_000),
        priceSnapshotId: "price-1",
        asOfBlock: 100n,
        monetaryEligibleRaw: "1",
        lockModifier: "LOCK_GATE_V1"
      })
    },
    onchainSyncCursor: {
      findUnique: async () => ({ lastProcessedBlock: 100n, failureCount: 0, lastError: null })
    },
    uliqLockPosition: {
      findMany: async () => [{ amountRaw: "150" }]
    },
    uliqBenefitReservation: {
      findUnique: async () => null,
      create: async ({ data }: any) => { createData = data; return { id: "reservation-1", ...data }; }
    }
  };
  const row = await createUliqBenefitReservationInTransaction({
    tx,
    prepared,
    referenceType: "BILLING_ORDER",
    referenceId: "order-1",
    idempotencyKey: "idem-1",
    now
  });
  assert.equal(row.id, "reservation-1");
  assert.equal(createData.expiresAt.getTime() - now.getTime(), 600_000);
  assert.equal(createData.baseAmount, "10.00");
  assert.equal(createData.discountAmount, "1.50");
  assert.equal(createData.finalAmount, "8.50");
});

test("reservation rejects lock evidence until the indexed finalized cursor reaches its snapshot", async () => {
  const tx = {
    user: { findUnique: async () => ({ walletAddress: wallet }) },
    uliqEntitlementSnapshot: {
      findUnique: async () => ({
        userId: "user-1",
        walletAddress: wallet,
        chainId: 421614,
        validUntil: new Date(now.getTime() + 300_000),
        priceSnapshotId: "price-1",
        asOfBlock: 100n,
        monetaryEligibleRaw: "1",
        lockModifier: "LOCK_GATE_V1"
      })
    },
    onchainSyncCursor: {
      findUnique: async () => ({ lastProcessedBlock: 99n, failureCount: 0, lastError: null })
    },
    uliqLockPosition: { findMany: async () => [{ amountRaw: "150" }] },
    uliqBenefitReservation: { findUnique: async () => null, create: async () => ({}) }
  };
  await assert.rejects(
    createUliqBenefitReservationInTransaction({
      tx,
      prepared,
      referenceType: "BILLING_ORDER",
      referenceId: "order-stale",
      idempotencyKey: "idem-stale",
      now
    }),
    (error: unknown) => error instanceof UliqBenefitGateError
      && error.message === "uliq_lock_state_stale"
  );
});

test("AI monthly discount cap counts reserved and consumed discounts and fails closed at the boundary", async () => {
  const aiPrepared: PreparedUliqBillingBenefit = {
    ...prepared,
    benefitType: "AI_CREDIT_DISCOUNT",
    sourceSubscriptionTermId: "term-1",
    aiMonthlyCapCents: 200
  };
  const tx = {
    user: { findUnique: async () => ({ walletAddress: wallet }) },
    uliqEntitlementSnapshot: {
      findUnique: async () => ({
        userId: "user-1",
        walletAddress: wallet,
        chainId: 421614,
        validUntil: new Date(now.getTime() + 300_000),
        priceSnapshotId: "price-1",
        asOfBlock: 100n,
        monetaryEligibleRaw: "1",
        lockModifier: "LOCK_GATE_V1"
      })
    },
    onchainSyncCursor: {
      findUnique: async () => ({ lastProcessedBlock: 100n, failureCount: 0, lastError: null })
    },
    uliqLockPosition: { findMany: async () => [{ amountRaw: "150" }] },
    uliqBenefitReservation: {
      findUnique: async () => null,
      aggregate: async () => ({ _sum: { discountAmount: "0.51" } }),
      create: async () => ({})
    },
    subscriptionTerm: {
      findUnique: async () => ({
        id: "term-1",
        userId: "user-1",
        status: "ACTIVE",
        endsAt: prepared.lockDecision.requiredBenefitUntil,
        order: { uliqBenefitReservation: { benefitType: "SUBSCRIPTION_DISCOUNT", status: "CONSUMED" } }
      })
    }
  };
  await assert.rejects(
    createUliqBenefitReservationInTransaction({
      tx,
      prepared: aiPrepared,
      referenceType: "BILLING_ORDER",
      referenceId: "order-ai-cap",
      idempotencyKey: "idem-ai-cap",
      now
    }),
    (error: unknown) => error instanceof UliqBenefitGateError
      && error.message === "uliq_ai_cap_exceeded"
      && error.details.usedCents === 51
      && error.details.requestedDiscountCents === 150
  );
});

test("parallel consumption claims exactly once and writes one append-only ledger entry", async () => {
  let status = "RESERVED";
  const ledger: any[] = [];
  const reservation = {
    id: "reservation-1",
    userId: "user-1",
    walletAddress: wallet,
    benefitType: "AI_CREDIT_DISCOUNT",
    referenceType: "BILLING_ORDER",
    referenceId: "order-1",
    configVersion: 1,
    priceSnapshotId: "price-1",
    entitlementSnapshotId: "snapshot-1",
    currency: "USD",
    baseAmount: "10.00",
    discountAmount: "1.50",
    finalAmount: "8.50",
    expiresAt: prepared.expiresAt,
    metadata: { tierSnapshot: "GOLD" },
    billingOrder: { onchainPayment: { txHash: "0xabc" } },
    entitlementSnapshot: { chainId: 421614 },
    lockGateVersion: "LOCK_GATE_V1",
    lockContractAddress: prepared.lockerContractAddress,
    requiredBenefitUntil: prepared.lockDecision.requiredBenefitUntil,
    requiredLockedRaw: prepared.lockDecision.requiredLockedRaw,
    qualifyingLockIds: prepared.lockDecision.qualifyingLockIds,
    asOfBlock: prepared.asOfBlock
  };
  const tx = {
    onchainSyncCursor: {
      findUnique: async () => ({ lastProcessedBlock: 100n, failureCount: 0, lastError: null })
    },
    uliqLockPosition: {
      findMany: async () => [{ amountRaw: "150" }]
    },
    uliqBenefitReservation: {
      findUnique: async () => ({ ...reservation, status }),
      updateMany: async () => {
        if (status !== "RESERVED") return { count: 0 };
        status = "CONSUMED";
        return { count: 1 };
      }
    },
    uliqBenefitLedger: { create: async ({ data }: any) => { ledger.push(data); } }
  };
  const parallel = await Promise.allSettled([
    consumeUliqBenefitReservationInTransaction({ tx, reservationId: reservation.id, now }),
    consumeUliqBenefitReservationInTransaction({ tx, reservationId: reservation.id, now })
  ]);
  assert.equal(parallel.filter((result) => result.status === "fulfilled" && result.value === true).length, 1);
  assert.equal(parallel.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await consumeUliqBenefitReservationInTransaction({ tx, reservationId: reservation.id, now }), false);
  assert.equal(ledger.length, 1);
});

test("wallet mutation and reservation release share one transaction", async () => {
  const calls: string[] = [];
  const db = {
    $transaction: async (run: (tx: any) => Promise<any>) => run({
      uliqBenefitReservation: {
        updateMany: async () => { calls.push("release"); return { count: 2 }; }
      },
      user: { update: async () => { calls.push("wallet"); } }
    })
  };
  const released = await releaseOpenUliqReservationsForWalletChange({
    db,
    userId: "user-1",
    previousWalletAddress: wallet,
    nextWalletAddress: null,
    updateWallet: (tx) => tx.user.update(),
    now
  });
  assert.equal(released, 2);
  assert.deepEqual(calls, ["release", "wallet"]);
});

test("expired ten-minute reservation releases and expires an unsigned billing order atomically", async () => {
  let reservationStatus = "RESERVED";
  let orderStatus = "PENDING";
  const db = {
    $transaction: async (run: (tx: any) => Promise<any>) => run({
      uliqBenefitReservation: {
        findMany: async () => [{ id: "reservation-1", billingOrder: { id: "order-1", status: orderStatus } }],
        updateMany: async () => {
          if (reservationStatus !== "RESERVED") return { count: 0 };
          reservationStatus = "RELEASED";
          return { count: 1 };
        }
      },
      billingOrder: {
        updateMany: async () => {
          if (orderStatus !== "PENDING") return { count: 0 };
          orderStatus = "EXPIRED";
          return { count: 1 };
        }
      }
    })
  };
  assert.equal(await expireUliqBenefitReservations(db, now), 1);
  assert.equal(reservationStatus, "RELEASED");
  assert.equal(orderStatus, "EXPIRED");
});

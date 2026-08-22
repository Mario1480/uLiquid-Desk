import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeUliqBenefitReservationInTransaction,
  createUliqBenefitReservationInTransaction,
  expireUliqBenefitReservations,
  releaseOpenUliqReservationsForWalletChange,
  type PreparedUliqBillingBenefit
} from "./benefitReservation.service.js";

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
  benefitType: "AI_CREDIT_DISCOUNT",
  discountBps: 1_500,
  baseAmountCents: 1_000,
  discountAmountCents: 150,
  finalAmountCents: 850,
  expiresAt: new Date(now.getTime() + 600_000),
  priceQualityStatus: "HEALTHY",
  degradationReason: null
};

test("reservation creation binds exact wallet/snapshots and ten-minute expiry", async () => {
  let createData: any = null;
  const tx = {
    user: { findUnique: async () => ({ walletAddress: wallet }) },
    uliqEntitlementSnapshot: {
      findUnique: async () => ({
        userId: "user-1",
        walletAddress: wallet,
        validUntil: new Date(now.getTime() + 300_000),
        priceSnapshotId: "price-1",
        asOfBlock: 100n,
        monetaryEligibleRaw: "1"
      })
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

test("consumption is exactly once and writes one append-only ledger entry", async () => {
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
    billingOrder: { onchainPayment: { txHash: "0xabc" } }
  };
  const tx = {
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
  assert.equal(await consumeUliqBenefitReservationInTransaction({ tx, reservationId: reservation.id, now }), true);
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

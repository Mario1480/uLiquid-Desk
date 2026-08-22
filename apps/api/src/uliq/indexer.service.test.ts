import assert from "node:assert/strict";
import test from "node:test";
import { acquireUliqIndexerLease, rollbackUliqAfterReorg, shouldConsumeHoldingTransfer } from "./indexer.service.js";
import type { UliqRuntimeConfig } from "./config.js";

const config = {
  chainId: 421614,
  startBlock: 100n
} as UliqRuntimeConfig;

function leaseDb(initial?: { owner: string | null; expiresAt: Date | null; nextRetryAt?: Date | null }) {
  let row: any = initial ? {
    id: "uliq:421614:all",
    leaseOwner: initial.owner,
    leaseExpiresAt: initial.expiresAt,
    nextRetryAt: initial.nextRetryAt ?? null
  } : null;
  return {
    $transaction: async (run: (tx: any) => Promise<any>) => run({
      onchainSyncCursor: {
        upsert: async ({ create }: any) => row ??= { ...create, leaseOwner: null, leaseExpiresAt: null, nextRetryAt: null },
        updateMany: async ({ data }: any) => {
          const now = new Date("2026-08-22T12:00:00.000Z");
          const retryReady = !row.nextRetryAt || row.nextRetryAt <= now;
          const leaseReady = !row.leaseOwner || row.leaseExpiresAt <= now || row.leaseOwner === data.leaseOwner;
          if (!retryReady || !leaseReady) return { count: 0 };
          row = { ...row, ...data };
          return { count: 1 };
        },
        findUnique: async () => row
      }
    })
  };
}

test("indexer DB lease excludes a second worker until expiry", async () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const db = leaseDb();
  const first = await acquireUliqIndexerLease({ db, config, owner: "worker-a", now, leaseMs: 30_000 });
  const second = await acquireUliqIndexerLease({ db, config, owner: "worker-b", now, leaseMs: 30_000 });
  assert.equal(first.leaseOwner, "worker-a");
  assert.equal(second, null);
});

test("indexer lease honors retry backoff", async () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  const db = leaseDb({ owner: null, expiresAt: null, nextRetryAt: new Date(now.getTime() + 30_000) });
  assert.equal(await acquireUliqIndexerLease({ db, config, owner: "worker-a", now }), null);
});

test("reorg invalidation releases quotes and reverses consumed benefits with an alert", async () => {
  const calls: string[] = [];
  const reservation = {
    id: "reservation-consumed",
    userId: "user-1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    benefitType: "SUBSCRIPTION_DISCOUNT",
    referenceType: "BILLING_ORDER",
    referenceId: "order-1",
    configVersion: 1,
    priceSnapshotId: "price-1",
    entitlementSnapshotId: "snapshot-1",
    currency: "USD",
    baseAmount: "100.00",
    discountAmount: "10.00",
    finalAmount: "90.00",
    metadata: { tierSnapshot: "GOLD" }
  };
  const tx = {
    onchainIndexedEvent: { updateMany: async () => { calls.push("events-orphaned"); } },
    uliqPresalePurchase: { deleteMany: async () => undefined },
    uliqVestingPosition: { deleteMany: async () => undefined },
    uliqLockPosition: { deleteMany: async () => undefined },
    uliqHoldingLot: { deleteMany: async () => undefined },
    uliqEntitlementSnapshot: {
      findMany: async () => [{ id: "snapshot-1" }],
      updateMany: async () => { calls.push("snapshot-degraded"); }
    },
    uliqBenefitReservation: {
      findMany: async () => [reservation],
      updateMany: async ({ where }: any) => {
        calls.push(where.status === "CONSUMED" ? "consumed-reversed" : "reserved-released");
        return { count: 1 };
      }
    },
    uliqBenefitLedger: { upsert: async ({ create }: any) => { calls.push(`ledger-${create.entryType}`); } },
    platformAlert: { create: async () => { calls.push("alert-created"); } },
    onchainSyncCursor: { updateMany: async () => { calls.push("cursor-rewound"); } }
  };
  const db = { $transaction: async (run: (value: any) => Promise<any>) => run(tx) };
  await rollbackUliqAfterReorg({
    db,
    config: {
      ...config,
      contracts: {
        token: "0x1111111111111111111111111111111111111111",
        presale: "0x2222222222222222222222222222222222222222",
        vesting: "0x3333333333333333333333333333333333333333",
        locker: "0x4444444444444444444444444444444444444444",
        usdc: "0x5555555555555555555555555555555555555555"
      }
    },
    ancestor: 110n,
    owner: "worker-a",
    now: new Date("2026-08-22T12:00:00.000Z")
  });
  assert.ok(calls.includes("reserved-released"));
  assert.ok(calls.includes("consumed-reversed"));
  assert.ok(calls.includes("ledger-REVERSED"));
  assert.ok(calls.includes("alert-created"));
  assert.ok(calls.includes("cursor-rewound"));
});

test("holding provenance survives locker transitions but consumes ordinary and unknown exits", () => {
  const completeConfig = {
    ...config,
    contracts: {
      token: "0x1111111111111111111111111111111111111111",
      presale: "0x2222222222222222222222222222222222222222",
      vesting: "0x3333333333333333333333333333333333333333",
      locker: "0x4444444444444444444444444444444444444444",
      usdc: "0x5555555555555555555555555555555555555555"
    }
  };
  const wallet = "0x6666666666666666666666666666666666666666";
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: completeConfig.contracts.locker, config: completeConfig }), false);
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: "0x7777777777777777777777777777777777777777", config: completeConfig }), true);
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: completeConfig.contracts.presale, config: completeConfig }), true);
  assert.equal(shouldConsumeHoldingTransfer({ from: completeConfig.contracts.vesting, to: wallet, config: completeConfig }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { uliqPaymentCustodyAbi, uliqPresaleAbi } from "./abi.js";
import { acquireUliqIndexerLease, decodeUliqLog, projectUliqEvent, rollbackUliqAfterReorg, shouldConsumeHoldingTransfer } from "./indexer.service.js";
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
        paymentCustody: "0x6666666666666666666666666666666666666666",
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
      paymentCustody: "0x8888888888888888888888888888888888888888",
      usdc: "0x5555555555555555555555555555555555555555"
    }
  };
  const wallet = "0x6666666666666666666666666666666666666666";
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: completeConfig.contracts.locker, config: completeConfig }), false);
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: "0x7777777777777777777777777777777777777777", config: completeConfig }), true);
  assert.equal(shouldConsumeHoldingTransfer({ from: wallet, to: completeConfig.contracts.presale, config: completeConfig }), true);
  assert.equal(shouldConsumeHoldingTransfer({ from: completeConfig.contracts.vesting, to: wallet, config: completeConfig }), false);
});

test("indexer attributes a finalized purchase's released tUSDC to the active treasury", async () => {
  const completeConfig = {
    ...config,
    contracts: {
      token: "0x1111111111111111111111111111111111111111",
      presale: "0x2222222222222222222222222222222222222222",
      vesting: "0x3333333333333333333333333333333333333333",
      locker: "0x4444444444444444444444444444444444444444",
      usdc: "0x5555555555555555555555555555555555555555",
      paymentCustody: "0x6666666666666666666666666666666666666666"
    }
  } as UliqRuntimeConfig;
  const transactionHash = `0x${"ab".repeat(32)}` as `0x${string}`;
  const blockHash = `0x${"cd".repeat(32)}` as `0x${string}`;
  const buyer = "0x7777777777777777777777777777777777777777" as const;
  const treasury = "0x8888888888888888888888888888888888888888" as const;
  const log = {
    address: completeConfig.contracts.paymentCustody,
    topics: encodeEventTopics({
      abi: uliqPaymentCustodyAbi,
      eventName: "PaymentReleased",
      args: { purchaseId: 1n, buyer, treasury }
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [10_000_000n]),
    blockNumber: 123n,
    blockHash,
    transactionHash,
    logIndex: 4
  } as any;
  const decoded = decodeUliqLog(log, completeConfig);
  assert.equal(decoded?.eventName, "PaymentReleased");
  let update: any = null;
  await projectUliqEvent({
    tx: { uliqPresalePurchase: { updateMany: async (value: any) => { update = value; } } },
    config: completeConfig,
    log,
    decoded: decoded!,
    eventKey: "event-1",
    blockTimestamp: new Date("2026-08-23T12:00:00.000Z")
  });
  assert.equal(update.where.purchaseIdOnchain, "1");
  assert.equal(update.data.treasuryRecipient, treasury.toLowerCase());
  assert.equal(update.data.treasuryReleasedUsdcRaw, "10000000");
  assert.equal(update.data.treasuryReleaseTxHash, transactionHash);
});

test("indexer records an unsold presale release as an ordinary treasury holding", async () => {
  const completeConfig = {
    ...config,
    contracts: {
      token: "0x1111111111111111111111111111111111111111",
      presale: "0x2222222222222222222222222222222222222222",
      vesting: "0x3333333333333333333333333333333333333333",
      locker: "0x4444444444444444444444444444444444444444",
      usdc: "0x5555555555555555555555555555555555555555",
      paymentCustody: "0x6666666666666666666666666666666666666666"
    }
  } as UliqRuntimeConfig;
  const treasury = "0x7777777777777777777777777777777777777777" as const;
  const transactionHash = `0x${"12".repeat(32)}` as `0x${string}`;
  const blockHash = `0x${"34".repeat(32)}` as `0x${string}`;
  const releasedAmount = 119_000_000n * 10n ** 18n;
  const log = {
    address: completeConfig.contracts.presale,
    topics: encodeEventTopics({
      abi: uliqPresaleAbi,
      eventName: "UnsoldUliqReleased",
      args: { treasury }
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [releasedAmount]),
    blockNumber: 456n,
    blockHash,
    transactionHash,
    logIndex: 7
  } as any;
  const decoded = decodeUliqLog(log, completeConfig);
  assert.equal(decoded?.eventName, "UnsoldUliqReleased");

  let upsert: any = null;
  await projectUliqEvent({
    tx: {
      user: { findUnique: async () => null },
      uliqHoldingLot: { upsert: async (value: any) => { upsert = value; } }
    },
    config: completeConfig,
    log,
    decoded: decoded!,
    eventKey: "event-unsold",
    blockTimestamp: new Date("2026-08-23T18:00:00.000Z")
  });

  assert.equal(upsert.create.walletAddress, treasury.toLowerCase());
  assert.equal(upsert.create.amountRaw, releasedAmount.toString());
  assert.equal(upsert.create.provenance, "WALLET_TRANSFER");
  assert.equal(upsert.create.sourceEventKey, "event-unsold:unsold-release");
  assert.equal(upsert.create.monetaryEligibleAt.toISOString(), "2026-08-24T18:00:00.000Z");
});

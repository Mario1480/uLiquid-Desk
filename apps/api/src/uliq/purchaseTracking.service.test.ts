import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { uliqPresaleAbi } from "./abi.js";
import type { UliqRuntimeConfig } from "./config.js";
import { UliqPurchaseTrackingService } from "./purchaseTracking.service.js";

const PRESALE = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;
const OTHER_WALLET = "0x3333333333333333333333333333333333333333" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const REPLACEMENT_TX_HASH = `0x${"ef".repeat(32)}` as `0x${string}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;

const config: UliqRuntimeConfig = {
  chainId: 421_614,
  flags: { enabled: true, presaleEnabled: true, discountsEnabled: false, lockingEnabled: false, adminEnabled: true },
  primaryRpcUrl: "https://primary.example/rpc",
  secondaryRpcUrl: "https://secondary.example/rpc",
  startBlock: 1n,
  confirmations: 12,
  contracts: {
    token: PRESALE,
    presale: PRESALE,
    vesting: PRESALE,
    locker: PRESALE,
    paymentCustody: PRESALE,
    usdc: PRESALE
  }
};

function purchaseReceipt(buyer = WALLET) {
  return {
    status: "success",
    transactionHash: TX_HASH,
    blockNumber: 101n,
    blockHash: BLOCK_HASH,
    logs: [{
      address: PRESALE,
      topics: encodeEventTopics({
        abi: uliqPresaleAbi,
        eventName: "PurchaseCreated",
        args: { purchaseId: 7n, buyer }
      }),
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }],
        [10_000_000n, 10_000n * 10n ** 18n, 1_787_418_172n]
      ),
      logIndex: 4
    }]
  };
}

function createState(params: { receipt?: any; canonical?: any } = {}) {
  const rows: any[] = [];
  let safeHead = 100n;
  let finalizedHead = 99n;
  const db = {
    user: { findUnique: async () => ({ walletAddress: WALLET }) },
    uliqPresalePurchase: { findFirst: async () => params.canonical ?? null },
    uliqPurchaseTracking: {
      findUnique: async ({ where }: any) => rows.find((candidate) => (
        candidate.transactionHash === where.chainId_transactionHash?.transactionHash
      )) ?? null,
      findMany: async () => [...rows],
      create: async ({ data }: any) => {
        const row = {
          id: `tracking-${rows.length + 1}`,
          ...data,
          submittedAt: new Date("2026-08-24T12:00:00.000Z"),
          receiptObservedAt: null,
          lastCheckedAt: null,
          networkFinalizedAt: null,
          createdAt: new Date("2026-08-24T12:00:00.000Z"),
          updatedAt: new Date("2026-08-24T12:00:00.000Z")
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const index = rows.findIndex((candidate) => candidate.id === where.id);
        rows[index] = { ...rows[index], ...data, updatedAt: new Date("2026-08-24T12:01:00.000Z") };
        return rows[index];
      }
    }
  };
  db.$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(db);
  const client = {
    async getTransactionReceipt() {
      if (!params.receipt) {
        const error = new Error("Transaction receipt could not be found");
        error.name = "TransactionReceiptNotFoundError";
        throw error;
      }
      return params.receipt;
    },
    async getBlock(request: { blockTag?: "safe" | "finalized"; blockNumber?: bigint }) {
      const number = request.blockNumber ?? (request.blockTag === "safe" ? safeHead : finalizedHead);
      return { number, hash: request.blockNumber === 101n ? BLOCK_HASH : `0x${"01".repeat(32)}`, timestamp: 1_787_418_172n };
    }
  };
  return {
    db,
    rpc: { primary: client, secondary: client } as any,
    get row() { return rows[0] ?? null; },
    setHeads(safe: bigint, finalized: bigint) { safeHead = safe; finalizedHead = finalized; }
  };
}

async function submit(service: UliqPurchaseTrackingService) {
  return service.trackSubmitted({
    userId: "user-1",
    transactionHash: TX_HASH,
    maxUsdcAmountRaw: "10000000",
    minUliqAllocationRaw: (10_000n * 10n ** 18n).toString()
  });
}

test("receipt-first tracking persists SUBMITTED and validates PurchaseCreated into SOFT_CONFIRMED", async () => {
  const state = createState({ receipt: purchaseReceipt() });
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  const submitted = await submit(service);
  assert.equal(submitted.confirmationStatus, "SUBMITTED");

  const confirmed = await service.refreshForUser("user-1", TX_HASH, new Date("2026-08-24T12:02:00.000Z"));
  assert.equal(confirmed.confirmationStatus, "SOFT_CONFIRMED");
  assert.equal(confirmed.purchaseIdOnchain, "7");
  assert.equal(confirmed.usdcAmountRaw, "10000000");
  assert.equal(confirmed.uliqAllocationRaw, (10_000n * 10n ** 18n).toString());
  assert.equal(confirmed.receiptBlockNumber, "101");
});

test("receipt reconciliation accepts database decimals that stringify in scientific notation", async () => {
  const state = createState({ receipt: purchaseReceipt() });
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);
  state.row.maxUsdcAmountRaw = {
    toFixed: () => "10000000",
    toString: () => "1e+7"
  };
  state.row.minUliqAllocationRaw = {
    toFixed: () => (10_000n * 10n ** 18n).toString(),
    toString: () => "1e+22"
  };

  const confirmed = await service.refreshForUser("user-1", TX_HASH, new Date("2026-08-24T12:02:00.000Z"));

  assert.equal(confirmed.confirmationStatus, "SOFT_CONFIRMED");
  assert.equal(confirmed.usdcAmountRaw, "10000000");
  assert.equal(confirmed.uliqAllocationRaw, (10_000n * 10n ** 18n).toString());
});

test("tracking advances through SAFE to FINALIZED only after matching common block hashes", async () => {
  const state = createState({ receipt: purchaseReceipt() });
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);
  await service.refreshForUser("user-1", TX_HASH, new Date("2026-08-24T12:02:00.000Z"));

  state.setHeads(101n, 100n);
  await service.reconcilePending(new Date("2026-08-24T12:03:00.000Z"));
  assert.equal(state.row.status, "SAFE");

  state.setHeads(102n, 101n);
  await service.reconcilePending(new Date("2026-08-24T12:04:00.000Z"));
  assert.equal(state.row.status, "FINALIZED");
  assert.equal(state.row.statusReason, "network_finalized");
});

test("receipt-first tracking fails closed on a buyer mismatch", async () => {
  const state = createState({ receipt: purchaseReceipt(OTHER_WALLET) });
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);
  const result = await service.refreshForUser("user-1", TX_HASH, new Date("2026-08-24T12:02:00.000Z"));
  assert.equal(result.confirmationStatus, "REVIEW_REQUIRED");
  assert.equal(result.statusReason, "receipt_buyer_mismatch");
});

test("tracking becomes FINALIZED when the canonical indexer record matches", async () => {
  const canonical = {
    walletAddress: WALLET,
    usdcAmountRaw: "10000000",
    uliqAllocationRaw: (10_000n * 10n ** 18n).toString(),
    purchaseIdOnchain: "7",
    logIndex: 4,
    purchaseBlockNumber: 101n,
    purchaseBlockHash: BLOCK_HASH
  };
  const state = createState({ receipt: purchaseReceipt(), canonical });
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);
  const result = await service.refreshForUser("user-1", TX_HASH, new Date("2026-08-24T12:02:00.000Z"));
  assert.equal(result.confirmationStatus, "FINALIZED");
  assert.equal(result.statusReason, "canonical_indexer_matched");
});

test("a repriced transaction keeps the purchase intent on the replacement hash", async () => {
  const state = createState();
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);

  const replacement = await service.replaceSubmitted({
    userId: "user-1",
    transactionHash: TX_HASH,
    replacementTransactionHash: REPLACEMENT_TX_HASH,
    reason: "repriced"
  });

  assert.equal(replacement.transactionHash, REPLACEMENT_TX_HASH);
  assert.equal(replacement.confirmationStatus, "SUBMITTED");
  assert.equal(state.row.status, "FAILED");
  assert.match(state.row.statusReason, /transaction_repriced_by/);
});

test("a cancelled replacement closes the submitted tracking without creating a purchase", async () => {
  const state = createState();
  const service = new UliqPurchaseTrackingService(state.db, config, state.rpc);
  await submit(service);

  const cancelled = await service.replaceSubmitted({
    userId: "user-1",
    transactionHash: TX_HASH,
    replacementTransactionHash: REPLACEMENT_TX_HASH,
    reason: "cancelled"
  });

  assert.equal(cancelled.transactionHash, TX_HASH);
  assert.equal(cancelled.confirmationStatus, "FAILED");
  assert.match(cancelled.statusReason ?? "", /transaction_cancelled_by/);
});

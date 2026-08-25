import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { uliqPresaleAbi } from "./abi.js";
import type { UliqRuntimeConfig } from "./config.js";
import {
  getUliqAutoFinalizerSettings,
  UliqAutoFinalizerService,
  type UliqAutoFinalizerChain,
  type UliqAutoFinalizerSettings
} from "./autoFinalizer.service.js";

const PRESALE = "0x0000000000000000000000000000000000000012" as const;
const BUYER = "0x00000000000000000000000000000000000000b0" as const;
const FINALIZER = "0x00000000000000000000000000000000000000f1" as const;
const TX_HASH = `0x${"1".repeat(64)}` as const;
const BLOCK_HASH = `0x${"2".repeat(64)}` as const;

const config: UliqRuntimeConfig = {
  chainId: 421_614,
  flags: { enabled: true, presaleEnabled: true, discountsEnabled: true, lockingEnabled: true, adminEnabled: true },
  primaryRpcUrl: "https://primary.invalid/",
  secondaryRpcUrl: "https://secondary.invalid/",
  startBlock: 1n,
  confirmations: 12,
  contracts: {
    token: "0x0000000000000000000000000000000000000011",
    presale: PRESALE,
    vesting: "0x0000000000000000000000000000000000000013",
    locker: "0x0000000000000000000000000000000000000014",
    paymentCustody: "0x0000000000000000000000000000000000000015",
    usdc: "0x0000000000000000000000000000000000000016"
  }
};

const settings: UliqAutoFinalizerSettings = {
  enabled: true,
  batchSize: 5,
  retryBaseMs: 60_000,
  retryMaxMs: 1_800_000,
  submissionStaleMs: 1_800_000
};

function purchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase-db-1",
    chainId: config.chainId,
    presaleContractAddress: PRESALE.toLowerCase(),
    purchaseIdOnchain: "7",
    userId: "user-1",
    buyerAddress: BUYER.toLowerCase(),
    usdcAmountRaw: "10000000",
    uliqAllocationRaw: "10000000000000000000000",
    withdrawalDeadline: new Date(150_000),
    purchaseBlockNumber: 75n,
    logIndex: 3,
    status: "PENDING_WITHDRAWAL",
    ...overrides
  };
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  if (where.id != null && row.id !== where.id) return false;
  if (where.actionKey != null && row.actionKey !== where.actionKey) return false;
  if (where.actionType != null && row.actionType !== where.actionType) return false;
  if (where.chainId != null && row.chainId !== where.chainId) return false;
  if (where.toAddress != null && row.toAddress !== where.toAddress) return false;
  if (where.status != null) {
    if (typeof where.status === "object" && Array.isArray(where.status.in)) {
      if (!where.status.in.includes(row.status)) return false;
    } else if (row.status !== where.status) {
      return false;
    }
  }
  if (where.updatedAt instanceof Date && new Date(row.updatedAt).getTime() !== where.updatedAt.getTime()) return false;
  return true;
}

function createDb(rows = [purchaseRow()]) {
  const actions: any[] = [];
  let actionCounter = 0;
  return {
    actions,
    uliqPresalePurchase: {
      async findMany({ where, take }: any) {
        const cutoff = where.withdrawalDeadline?.lt instanceof Date
          ? where.withdrawalDeadline.lt.getTime()
          : Number.POSITIVE_INFINITY;
        return rows
          .filter((row: any) => row.chainId === where.chainId)
          .filter((row: any) => row.presaleContractAddress === where.presaleContractAddress)
          .filter((row: any) => row.status === where.status)
          .filter((row: any) => new Date(row.withdrawalDeadline).getTime() < cutoff)
          .slice(0, take);
      }
    },
    onchainAction: {
      async upsert({ where, create }: any) {
        const existing = actions.find((row) => row.actionKey === where.actionKey);
        if (existing) return { ...existing };
        const now = new Date();
        const row = { id: `action-${++actionCounter}`, txHash: null, createdAt: now, updatedAt: now, ...create };
        actions.push(row);
        return { ...row };
      },
      async findMany({ where, take }: any) {
        return actions.filter((row) => matchesWhere(row, where)).slice(0, take).map((row) => ({ ...row }));
      },
      async findUnique({ where }: any) {
        const row = actions.find((candidate) => candidate.id === where.id || candidate.actionKey === where.actionKey);
        return row ? { ...row } : null;
      },
      async update({ where, data }: any) {
        const row = actions.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("action_not_found");
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      async updateMany({ where, data }: any) {
        const matches = actions.filter((row) => matchesWhere(row, where));
        for (const row of matches) Object.assign(row, data, { updatedAt: new Date() });
        return { count: matches.length };
      }
    }
  };
}

function createChain(overrides: Partial<UliqAutoFinalizerChain> = {}) {
  let sendCount = 0;
  let state = 0;
  let receipt: Awaited<ReturnType<UliqAutoFinalizerChain["getReceipt"]>> = null;
  const chain: UliqAutoFinalizerChain & {
    sendCount(): number;
    setState(value: number): void;
    setReceipt(value: Awaited<ReturnType<UliqAutoFinalizerChain["getReceipt"]>>): void;
  } = {
    accountAddress: FINALIZER,
    async getFinalizedHead() {
      return { number: 100n, hash: BLOCK_HASH, timestamp: 200n };
    },
    async readPurchase() {
      return {
        buyer: BUYER,
        usdcAmountRaw: 10_000_000n,
        uliqAllocationRaw: 10_000_000_000_000_000_000_000n,
        purchasedAt: 100n,
        withdrawalDeadline: 150n,
        state
      };
    },
    async readLatestPurchase() {
      return {
        buyer: BUYER,
        usdcAmountRaw: 10_000_000n,
        uliqAllocationRaw: 10_000_000_000_000_000_000_000n,
        purchasedAt: 100n,
        withdrawalDeadline: 150n,
        state
      };
    },
    async simulateFinalize() {},
    async sendFinalize() {
      sendCount += 1;
      return TX_HASH;
    },
    async getReceipt() {
      return receipt;
    },
    async verifyBlock() {
      return true;
    },
    sendCount: () => sendCount,
    setState(value) {
      state = value;
    },
    setReceipt(value) {
      receipt = value;
    },
    ...overrides
  };
  return chain;
}

test("auto finalizer remains fail-closed when disabled", async () => {
  const db = createDb();
  const chain = createChain();
  const service = new UliqAutoFinalizerService(db, config, {
    settings: { ...settings, enabled: false },
    chain
  });

  assert.deepEqual(await service.runOnce(), { enabled: false });
  assert.equal(chain.sendCount(), 0);
  assert.equal(db.actions.length, 0);
});

test("auto finalizer uses the finalized head timestamp as the eligibility gate", async () => {
  const db = createDb();
  const chain = createChain({
    async getFinalizedHead() {
      return { number: 100n, hash: BLOCK_HASH, timestamp: 150n };
    }
  });
  const service = new UliqAutoFinalizerService(db, config, { settings, chain });

  const result = await service.runOnce();
  assert.equal(result.candidates, 0);
  assert.equal(chain.sendCount(), 0);
});

test("auto finalizer submits an eligible purchase once and persists the action", async () => {
  const db = createDb();
  const chain = createChain();
  const service = new UliqAutoFinalizerService(db, config, { settings, chain });

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.equal(first.submitted, 1);
  assert.equal(second.submitted, 0);
  assert.equal(chain.sendCount(), 1);
  assert.equal(db.actions.length, 1);
  assert.equal(db.actions[0].status, "submitted");
  assert.equal(db.actions[0].txHash, TX_HASH);
  assert.equal(db.actions[0].metadata.finalizerAddress, FINALIZER.toLowerCase());
});

test("auto finalizer claims a purchase only once across concurrent workers", async () => {
  const db = createDb();
  const chain = createChain();
  const workerA = new UliqAutoFinalizerService(db, config, { settings, chain });
  const workerB = new UliqAutoFinalizerService(db, config, { settings, chain });

  await Promise.all([workerA.runOnce(), workerB.runOnce()]);

  assert.equal(chain.sendCount(), 1);
  assert.equal(db.actions.length, 1);
  assert.equal(db.actions[0].status, "submitted");
});

test("auto finalizer confirms already-finalized state without sending", async () => {
  const db = createDb();
  const chain = createChain();
  chain.setState(2);
  const service = new UliqAutoFinalizerService(db, config, { settings, chain });

  const result = await service.runOnce();

  assert.equal(result.alreadyFinalized, 1);
  assert.equal(chain.sendCount(), 0);
  assert.equal(db.actions[0].status, "confirmed");
  assert.equal(db.actions[0].metadata.confirmedBy, "finalized_state");
});

test("auto finalizer stops on a finalized projection mismatch", async () => {
  const db = createDb([purchaseRow({ usdcAmountRaw: "999" })]);
  const chain = createChain();
  const service = new UliqAutoFinalizerService(db, config, { settings, chain });

  const result = await service.runOnce();

  assert.equal(result.skipped, 1);
  assert.equal(chain.sendCount(), 0);
  assert.equal(db.actions[0].status, "review_required");
  assert.equal(db.actions[0].metadata.lastError, "purchase_projection_mismatch");
});

test("auto finalizer reconciles a submitted transaction only after finalized inclusion", async () => {
  const db = createDb();
  const chain = createChain();
  const service = new UliqAutoFinalizerService(db, config, { settings, chain });
  await service.runOnce();

  chain.setReceipt({ status: "success", blockNumber: 90n, blockHash: BLOCK_HASH });
  chain.setState(2);
  const result = await service.runOnce();

  assert.equal(result.reconciledConfirmed, 1);
  assert.equal(db.actions[0].status, "confirmed");
  assert.equal(chain.sendCount(), 1);
});

test("auto finalizer uses latest state only to suppress a stale duplicate submission", async () => {
  const db = createDb();
  db.actions.push({
    id: "action-stale",
    actionKey: `uliq:finalize:${config.chainId}:${PRESALE.toLowerCase()}:7`,
    actionType: "uliq_finalize_purchase",
    status: "submitting",
    chainId: config.chainId,
    toAddress: PRESALE.toLowerCase(),
    dataHex: encodeFunctionData({
      abi: uliqPresaleAbi,
      functionName: "finalizePurchase",
      args: [7n]
    }),
    valueWei: "0",
    txHash: null,
    metadata: { purchaseId: "7", attemptCount: 0 },
    createdAt: new Date("2026-08-25T10:00:00.000Z"),
    updatedAt: new Date("2026-08-25T10:00:00.000Z")
  });
  const chain = createChain({
    async readLatestPurchase() {
      return {
        buyer: BUYER,
        usdcAmountRaw: 10_000_000n,
        uliqAllocationRaw: 10_000_000_000_000_000_000_000n,
        purchasedAt: 100n,
        withdrawalDeadline: 150n,
        state: 2
      };
    }
  });
  const now = new Date("2026-08-25T12:00:00.000Z");
  const service = new UliqAutoFinalizerService(db, config, { settings, chain, now: () => now });

  await service.runOnce();

  assert.equal(chain.sendCount(), 0);
  assert.equal(db.actions[0].status, "submitting");
});

test("auto finalizer backs off after a send failure", async () => {
  let attempts = 0;
  const db = createDb();
  const chain = createChain({
    async sendFinalize() {
      attempts += 1;
      throw new Error("rpc_temporarily_unavailable");
    }
  });
  const now = new Date("2026-08-25T12:00:00.000Z");
  const service = new UliqAutoFinalizerService(db, config, { settings, chain, now: () => now });

  await service.runOnce();
  await service.runOnce();

  assert.equal(attempts, 1);
  assert.equal(db.actions[0].status, "retryable");
  assert.equal(db.actions[0].metadata.attemptCount, 1);
  assert.equal(db.actions[0].metadata.nextRetryAt, "2026-08-25T12:01:00.000Z");
});

test("auto finalizer settings reject unsafe bounds", () => {
  assert.throws(
    () => getUliqAutoFinalizerSettings({ ULIQ_AUTO_FINALIZER_BATCH_SIZE: "0" }),
    /uliq_auto_finalizer_invalid_batch_size/
  );
  assert.throws(
    () => getUliqAutoFinalizerSettings({ ULIQ_AUTO_FINALIZER_SUBMISSION_STALE_SECONDS: "20" }),
    /uliq_auto_finalizer_invalid_submission_stale_seconds/
  );
});

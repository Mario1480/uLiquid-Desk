import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics } from "viem";
import { uliqGlobalListingAbi } from "./abi.js";
import { UliqPublicPresaleIndexerService } from "./publicPresaleIndexer.service.js";

const address = `0x${"1".repeat(40)}`;
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

function fixture(options: { logs?: any[]; secondaryLogs?: any[]; badBlock?: bigint; failBlock?: bigint; casLost?: boolean } = {}) {
  let cursor: any = { lastProcessedBlock: 99n, lastProcessedBlockHash: null };
  const rows: any[] = [];
  const calls: bigint[][] = [[], []];
  const ranges: any[] = [];
  let transactions = 0;
  const tx: any = {
    onchainIndexedEvent: { upsert: async (args: any) => { rows.push(args.create); } },
    onchainSyncCursor: { updateMany: async (args: any) => {
      if (options.casLost) return { count: 0 };
      cursor = { ...cursor, ...args.data }; return { count: 1 };
    } }
  };
  const db: any = {
    onchainSyncCursor: { upsert: async () => {}, updateMany: async () => ({ count: 1 }), findUnique: async () => cursor },
    $transaction: async (fn: any) => {
      transactions++;
      const savedRows = rows.length; const savedCursor = { ...cursor };
      try { return await fn(tx); } catch (error) { rows.length = savedRows; cursor = savedCursor; throw error; }
    }
  };
  const clients = [0, 1].map((source) => ({
    getBlock: async ({ blockNumber }: any) => {
      const n = blockNumber ?? 599n;
      if (blockNumber !== undefined) calls[source].push(n);
      if (source === 1 && options.failBlock === n) throw new Error("RPC unavailable");
      return { number: n, hash: hash(source === 1 && options.badBlock === n ? n + 1n : n), parentHash: hash(n - 1n), timestamp: 1_700_000_000n };
    },
    getLogs: async (range: any) => { ranges.push(range); return source === 1 ? options.secondaryLogs ?? options.logs ?? [] : options.logs ?? []; }
  }));
  const service = new UliqPublicPresaleIndexerService(db, {
    chainId: 42161, startBlock: 100n, globalListingAddress: address, rounds: []
  } as any, { primary: clients[0], secondary: clients[1] } as any);
  return { service, calls, ranges, rows, cursor: () => cursor, transactions: () => transactions };
}

function log(blockNumber = 123n) {
  return { blockNumber, blockHash: hash(blockNumber), transactionHash: hash(900n), logIndex: 0, address, data: "0x", topics: [], removed: false };
}

test("empty finalized range advances all 500 blocks with one checkpoint per provider", async () => {
  const f = fixture();
  assert.equal((await f.service.runOnce()).processedBlocks, 500);
  assert.deepEqual(f.calls, [[599n], [599n]]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.cursor().lastProcessedBlock, 599n);
  assert.ok(f.ranges.every((r) => r.fromBlock === 100n && r.toBlock === 599n));
  await f.service.runOnce();
  assert.equal(f.ranges.length, 2, "caught-up polling does not fetch logs again");
});

test("event blocks are fetched once alongside the range checkpoint", async () => {
  const f = fixture({ logs: [log(), { ...log(), logIndex: 1 }] });
  await f.service.runOnce();
  assert.deepEqual(f.calls, [[123n, 599n], [123n, 599n]]);
  assert.deepEqual(f.rows.map((r) => r.blockNumber), [123n, 599n]);
});

test("decoded events retain their canonical block timestamp and are persisted", async () => {
  const event = { ...log(), topics: encodeEventTopics({ abi: uliqGlobalListingAbi,
    eventName: "ListingScheduled", args: { listingTimestamp: 1_800_000_000n } }) };
  const f = fixture({ logs: [event] });
  assert.equal((await f.service.runOnce()).processedEvents, 1);
  const stored = f.rows.find((row) => row.eventName === "ListingScheduled");
  assert.equal(stored.blockHash, event.blockHash);
  assert.equal(stored.blockTimestamp.getTime(), 1_700_000_000_000);
  assert.equal(stored.payload.listingTimestamp, "1800000000");
});

test("provider log disagreement prevents cursor progress", async () => {
  const f = fixture({ logs: [log()], secondaryLogs: [] });
  await assert.rejects(f.service.runOnce(), /rpc_log_mismatch/);
  assert.equal(f.transactions(), 0);
  assert.equal(f.cursor().lastProcessedBlock, 99n);
});

test("checkpoint mismatch and RPC interruption prevent partial persistence", async () => {
  for (const options of [{ badBlock: 599n }, { failBlock: 599n }]) {
    const f = fixture(options);
    await assert.rejects(f.service.runOnce());
    assert.equal(f.transactions(), 0);
    assert.equal(f.rows.length, 0);
  }
});

test("matching provider logs must still match their canonical block", async () => {
  const f = fixture({ logs: [{ ...log(), blockHash: hash(777n) }] });
  await assert.rejects(f.service.runOnce(), /log_block_mismatch/);
  assert.equal(f.transactions(), 0);
});

test("out-of-range logs cannot advance the cursor", async () => {
  const f = fixture({ logs: [log(600n)] });
  await assert.rejects(f.service.runOnce(), /invalid_log/);
  assert.equal(f.transactions(), 0);
});

test("lost cursor ownership rolls back checkpoint writes", async () => {
  const f = fixture({ casLost: true });
  await assert.rejects(f.service.runOnce(), /cursor_cas_lost/);
  assert.equal(f.rows.length, 0);
  assert.equal(f.cursor().lastProcessedBlock, 99n);
});

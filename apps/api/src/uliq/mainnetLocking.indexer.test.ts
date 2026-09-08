import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { uliqLockerAbi } from "./abi.js";
import { readMainnetLockingLogs, UliqMainnetLockingIndexer } from "./mainnetLocking.indexer.js";

const locker = "0x2222222222222222222222222222222222222222";
const wallet = "0x1111111111111111111111111111111111111111";
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
function log(kind: "TokensLocked" | "LockExtended" | "TokensUnlocked", block: bigint) {
  const data = kind === "TokensLocked" ? encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "uint64" }], [50n, 32n * 86400n, 3000000n])
    : kind === "LockExtended" ? encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }], [3000000n, 4000000n])
    : encodeAbiParameters([{ type: "uint256" }], [50n]);
  return { address: locker, blockNumber: block, blockHash: hash(block), transactionHash: hash(block + 1000n), logIndex: 0, removed: false, data,
    topics: encodeEventTopics({ abi: uliqLockerAbi, eventName: kind, args: { lockId: 1n, owner: wallet } }) };
}

function fixture(options: { logs?: any[]; secondaryLogs?: any[]; casLost?: boolean; busy?: boolean; reorg?: boolean; rpcFailure?: boolean; failFrom?: bigint; head?: bigint } = {}) {
  let state: any = { cursor: { lastProcessedBlock: options.reorg ? 110n : 99n, lastProcessedBlockHash: options.reorg ? hash(999n) : null }, events: [], positions: [] };
  const scopes: any[] = [];
  let ranges = 0;
  let commits = 0;
  const tx: any = {
    onchainSyncCursor: {
      updateMany: async ({ data, where }: any) => {
        if (options.casLost) return { count: 0 };
        assert.equal(where.leaseOwner, state.cursor.leaseOwner);
        assert.equal(where.lastProcessedBlock, state.cursor.lastProcessedBlock);
        Object.assign(state.cursor, data); return { count: 1 };
      }
    },
    onchainIndexedEvent: {
      upsert: async ({ where, create, update }: any) => { const existing = state.events.find((e: any) => e.eventKey === where.eventKey); existing ? Object.assign(existing, update) : state.events.push(create); },
      updateMany: async ({ where }: any) => { scopes.push(where); state.events.forEach((e: any) => e.canonicalStatus = "ORPHANED"); }
    },
    uliqLockPosition: {
      upsert: async ({ create }: any) => { state.positions.push(create); },
      updateMany: async ({ where, data }: any) => {
        const row = state.positions.find((p: any) => p.lockIdOnchain === where.lockIdOnchain && p.walletAddress === where.walletAddress);
        if (!row) return { count: 0 };
        const count = row.extensionCount;
        Object.assign(row, data);
        if (data.extensionCount) row.extensionCount = count + data.extensionCount.increment;
        return { count: 1 };
      },
      deleteMany: async ({ where }: any) => { scopes.push(where); state.positions = []; }
    }
  };
  const db: any = {
    onchainSyncCursor: {
      upsert: async ({ where }: any) => assert.equal(where.id, `uliq-mainnet-locking:42161:${locker}`),
      findUnique: async () => ({ ...state.cursor }),
      updateMany: async ({ data }: any) => {
        if (options.busy && data.leaseOwner) return { count: 0 };
        Object.assign(state.cursor, data); return { count: 1 };
      }
    },
    $transaction: async (fn: any) => {
      const saved = structuredClone(state);
      try { const result = await fn(tx); commits++; return result; } catch (e) { state = saved; throw e; }
    }
  };
  const clients = [0,1].map(source => ({
    getBlock: async ({ blockNumber }: any) => ({ number: blockNumber ?? options.head ?? 110n, hash: hash(blockNumber ?? options.head ?? 110n), timestamp: 1000n }),
    getLogs: async ({ address, fromBlock, toBlock }: any) => {
      ranges++; assert.equal(address, locker); assert.ok(toBlock - fromBlock + 1n <= 10n);
      if (options.rpcFailure || (source === 1 && fromBlock === options.failFrom)) throw new Error("https://rpc.invalid/private-provider-key");
      return (source ? options.secondaryLogs ?? options.logs ?? [] : options.logs ?? []).filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    }
  }));
  const service = new UliqMainnetLockingIndexer(db, { chainId: 42161, lockerAddress: locker, startBlock: 100n } as any,
    { primary: clients[0], secondary: clients[1] } as any, async () => {});
  return { service, state: () => state, scopes, ranges: () => ranges, commits: () => commits };
}

test("locker indexer projects lock, extension and withdrawal atomically and does not replay on retry", async () => {
  const f = fixture({ logs: [log("TokensUnlocked", 102n), log("TokensLocked", 100n), log("LockExtended", 101n)] });
  assert.equal((await f.service.runOnce()).processedEvents, 3);
  assert.equal(f.state().positions[0].status, "WITHDRAWN");
  assert.equal(f.state().positions[0].extensionCount, 1);
  assert.equal(f.state().positions[0].amountRaw, "50");
  assert.equal(f.state().cursor.lastProcessedBlock, 110n);
  assert.equal(f.state().cursor.leaseOwner, null);
  await f.service.runOnce();
  assert.equal(f.ranges(), 4); assert.equal(f.state().events.length, 3); assert.equal(f.state().positions[0].extensionCount, 1);
});

test("empty finalized ranges advance and independent workers respect the lease", async () => {
  const empty = fixture(); await empty.service.runOnce(); assert.equal(empty.state().cursor.lastProcessedBlock, 110n);
  const busy = fixture({ busy: true }); assert.equal((await busy.service.runOnce()).busy, true); assert.equal(busy.ranges(), 0);
});

test("log disagreement, invalid block identity, duplicates and RPC failure prevent progress", async () => {
  const event = log("TokensLocked", 100n);
  for (const options of [
    { logs: [event], secondaryLogs: [] }, { logs: [{ ...event, blockHash: hash(999n) }] },
    { logs: [event, event] }, { logs: [{ ...event, address: wallet }] }, { rpcFailure: true }
  ]) {
    const f = fixture(options); await assert.rejects(f.service.runOnce(), /^Error: uliq_mainnet_locking_indexer_failed$/);
    assert.equal(f.state().cursor.lastProcessedBlock, 99n); assert.equal(f.state().events.length, 0); assert.equal(f.state().cursor.leaseOwner, null);
  }
});

test("lost cursor compare-and-set rolls back all event and position writes", async () => {
  const f = fixture({ logs: [log("TokensLocked", 100n)], casLost: true });
  await assert.rejects(f.service.runOnce());
  assert.equal(f.state().events.length, 0); assert.equal(f.state().positions.length, 0); assert.equal(f.commits(), 0);
});

test("finalized checkpoint change resets only this chain and locker for a bounded replay", async () => {
  const f = fixture({ reorg: true });
  assert.equal((await f.service.runOnce()).replayRequired, true);
  assert.equal(f.state().cursor.lastProcessedBlock, 99n);
  assert.deepEqual(f.scopes, [{ chainId: 42161, contractAddress: locker }, { chainId: 42161, contractAddress: locker }]);
  await f.service.runOnce(); assert.equal(f.state().cursor.lastProcessedBlock, 110n);
});

test("ten-block chunks cover boundaries and the short tail without gaps or overlaps", async () => {
  const ranges: bigint[][] = [];
  const events = [log("TokensLocked", 109n), log("LockExtended", 110n), log("TokensUnlocked", 120n)];
  const client = { getLogs: async ({ fromBlock, toBlock }: any) => {
    ranges.push([fromBlock, toBlock]);
    return events.filter(event => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
  } } as any;
  assert.deepEqual(await readMainnetLockingLogs(client, locker, 100n, 120n), events);
  assert.deepEqual(ranges, [[100n,109n], [110n,119n], [120n,120n]]);
  await assert.rejects(readMainnetLockingLogs({ getLogs: async () => [events[1]] } as any, locker, 100n, 109n), /invalid_log/);
});

test("later chunk failures do not commit earlier events and retry covers the complete range", async () => {
  const options = { logs: [log("TokensLocked", 100n), log("LockExtended", 110n)], failFrom: 110n as bigint | undefined };
  const f = fixture(options);
  await assert.rejects(f.service.runOnce());
  assert.equal(f.state().cursor.lastProcessedBlock, 99n);
  assert.equal(f.state().events.length, 0);
  options.failFrom = undefined;
  await f.service.runOnce();
  assert.equal(f.state().cursor.lastProcessedBlock, 110n);
  assert.equal(f.state().events.length, 2);
});

test("catch-up processes 500 blocks per poll and continues from the persisted boundary", async () => {
  const f = fixture({ head: 1120n });
  assert.equal((await f.service.runOnce()).processedBlocks, 500);
  assert.equal(f.state().cursor.lastProcessedBlock, 599n);
  assert.equal((await f.service.runOnce()).processedBlocks, 500);
  assert.equal(f.state().cursor.lastProcessedBlock, 1099n);
  assert.equal((await f.service.runOnce()).processedBlocks, 21);
  assert.equal(f.state().cursor.lastProcessedBlock, 1120n);
  assert.equal(f.ranges(), 206);
});

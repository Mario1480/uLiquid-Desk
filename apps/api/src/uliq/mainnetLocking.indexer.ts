import { randomUUID } from "node:crypto";
import { decodeEventLog, type Address, type Hex, type Log, type PublicClient } from "viem";
import { uliqLockerAbi } from "./abi.js";
import { getUliqMainnetLockingConfig, mainnetLockingCursorId, type UliqMainnetLockingConfig } from "./mainnetLocking.config.js";
import { createMainnetLockingReadiness } from "./mainnetLocking.runtime.js";
import { createUliqRpcPair, getConsistentBlockAt, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";

type FinalLog = Log & { blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number };
const SPAN = 500n;
const LOG_CHUNK = 10n;
const date = (seconds: bigint) => new Date(Number(seconds) * 1000);

// Keep provider requests within free-tier limits without reducing catch-up to ten blocks per poll.
export async function readMainnetLockingLogs(client: PublicClient, address: Address, fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  const logs: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n < toBlock ? start + LOG_CHUNK - 1n : toBlock;
    const chunk = await client.getLogs({ address, fromBlock: start, toBlock: end });
    if (chunk.some(log => log.blockNumber == null || log.blockNumber < start || log.blockNumber > end)) {
      throw new Error("uliq_mainnet_locking_rpc_invalid_log");
    }
    logs.push(...chunk);
  }
  return logs;
}

export class UliqMainnetLockingIndexer {
  private readonly ready: () => Promise<void>;
  constructor(private readonly db: any,
    private readonly config: UliqMainnetLockingConfig = getUliqMainnetLockingConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config), ready?: () => Promise<void>
  ) { this.ready = ready ?? createMainnetLockingReadiness(config, rpc); }

  async runOnce() {
    await this.ready();
    const id = mainnetLockingCursorId(this.config);
    const owner = randomUUID();
    const initial = this.config.startBlock - 1n;
    const scope = { chainId: this.config.chainId, contractAddress: this.config.lockerAddress.toLowerCase() };
    await this.db.onchainSyncCursor.upsert({ where: { id }, create: { id, ...scope, startBlock: this.config.startBlock, lastProcessedBlock: initial, lastFinalizedBlock: initial }, update: {} });
    const now = new Date();
    const lease = await this.db.onchainSyncCursor.updateMany({
      where: { id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      data: { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + 120_000), heartbeatAt: now }
    });
    if (lease.count !== 1) return { busy: true, processedEvents: 0 };
    try {
      const cursor = await this.db.onchainSyncCursor.findUnique({ where: { id } });
      const last = BigInt(cursor.lastProcessedBlock);
      const cas = { id, leaseOwner: owner, lastProcessedBlock: last, leaseExpiresAt: { gt: new Date() } };
      if (last >= this.config.startBlock && cursor.lastProcessedBlockHash) {
        const checkpoint = await getConsistentBlockAt(this.rpc, last);
        if (checkpoint.hash.toLowerCase() !== cursor.lastProcessedBlockHash.toLowerCase()) {
          await this.db.$transaction(async (tx: any) => {
            await tx.onchainIndexedEvent.updateMany({ where: scope, data: { canonicalStatus: "ORPHANED", orphanedAt: now } });
            await tx.uliqLockPosition.deleteMany({ where: scope });
            const reset = await tx.onchainSyncCursor.updateMany({ where: { ...cas, leaseExpiresAt: { gt: new Date() } }, data: { lastProcessedBlock: initial, lastFinalizedBlock: initial, lastProcessedBlockHash: null } });
            if (reset.count !== 1) throw new Error("uliq_mainnet_locking_cursor_lost");
          }, { isolationLevel: "Serializable" });
          return { replayRequired: true, processedEvents: 0 };
        }
      }
      const head = await getConsistentFinalizedBlock(this.rpc);
      const fromBlock = last + 1n;
      if (fromBlock > head.number) return { processedEvents: 0, processedBlocks: 0 };
      const toBlock = fromBlock + SPAN - 1n < head.number ? fromBlock + SPAN - 1n : head.number;
      const reads = await Promise.all([this.rpc.primary, this.rpc.secondary].map(client => readMainnetLockingLogs(client, this.config.lockerAddress, fromBlock, toBlock)));
      const identity = (log: Log) => JSON.stringify([log.blockNumber?.toString(), log.blockHash?.toLowerCase(), log.transactionHash?.toLowerCase(), log.logIndex, log.address.toLowerCase(), log.data.toLowerCase(), log.topics.map(t => t.toLowerCase())]);
      if (JSON.stringify(reads[0].map(identity).sort()) !== JSON.stringify(reads[1].map(identity).sort())) throw new Error("uliq_mainnet_locking_rpc_log_mismatch");
      const logs = reads[0] as FinalLog[];
      const seen = new Set<string>();
      for (const log of logs) {
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (log.removed || log.blockNumber == null || !log.blockHash || !log.transactionHash || log.logIndex == null
          || log.blockNumber < fromBlock || log.blockNumber > toBlock || log.address.toLowerCase() !== scope.contractAddress || seen.has(key)) {
          throw new Error("uliq_mainnet_locking_rpc_invalid_log");
        }
        seen.add(key);
      }
      const blocks = new Map<bigint, Awaited<ReturnType<typeof getConsistentBlockAt>>>();
      for (const blockNumber of new Set([toBlock, ...logs.map(l => l.blockNumber)])) blocks.set(blockNumber, await getConsistentBlockAt(this.rpc, blockNumber));
      for (const log of logs) if (log.blockHash.toLowerCase() !== blocks.get(log.blockNumber)!.hash.toLowerCase()) throw new Error("uliq_mainnet_locking_rpc_log_block_mismatch");
      logs.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
      await this.db.$transaction(async (tx: any) => {
        for (const log of logs) {
          const decoded = decodeEventLog({ abi: uliqLockerAbi, data: log.data, topics: log.topics, strict: true });
          const args = decoded.args;
          const eventKey = `${scope.chainId}:${log.transactionHash.toLowerCase()}:${log.logIndex}`;
          const block = blocks.get(log.blockNumber)!;
          const payload = JSON.parse(JSON.stringify(args, (_key, value) => typeof value === "bigint" ? value.toString() : value));
          const record = { ...scope, blockNumber: log.blockNumber, blockHash: block.hash, transactionHash: log.transactionHash.toLowerCase(), logIndex: log.logIndex,
            eventName: decoded.eventName, payload, canonicalStatus: "FINALIZED", confirmations: 0, blockTimestamp: date(block.timestamp), finalizedAt: now, orphanedAt: null };
          await tx.onchainIndexedEvent.upsert({ where: { eventKey }, create: { eventKey, ...record }, update: record });
          const key = { ...scope, lockIdOnchain: args.lockId.toString() };
          if (decoded.eventName === "TokensLocked") {
            const expiry = date(BigInt(decoded.args.unlockAt));
            const value = { ...key, walletAddress: decoded.args.owner.toLowerCase(), amountRaw: decoded.args.amount.toString(),
              durationDays: Number(decoded.args.durationSeconds) / 86400, startAt: date(block.timestamp), originalUnlockAt: expiry, unlockAt: expiry,
              extensionCount: 0, lastExtendedAt: null, withdrawnAt: null, status: "ACTIVE", asOfBlock: log.blockNumber, blockHash: block.hash };
            await tx.uliqLockPosition.upsert({ where: { chainId_contractAddress_lockIdOnchain: key }, create: value, update: value });
          } else {
            const updated = await tx.uliqLockPosition.updateMany({ where: { ...key, walletAddress: args.owner.toLowerCase() }, data: decoded.eventName === "LockExtended"
              ? { unlockAt: date(BigInt(decoded.args.newUnlockAt)), lastExtendedAt: date(block.timestamp), extensionCount: { increment: 1 }, asOfBlock: log.blockNumber, blockHash: block.hash }
              : { status: "WITHDRAWN", withdrawnAt: date(block.timestamp), asOfBlock: log.blockNumber, blockHash: block.hash } });
            if (updated.count !== 1) throw new Error("uliq_mainnet_locking_projection_missing");
          }
        }
        const advanced = await tx.onchainSyncCursor.updateMany({ where: { ...cas, leaseExpiresAt: { gt: new Date() } }, data: {
          lastProcessedBlock: toBlock, lastProcessedBlockHash: blocks.get(toBlock)!.hash, lastFinalizedBlock: head.number,
          heartbeatAt: new Date(), lastSuccessfulAt: new Date(), failureCount: 0, lastError: null
        } });
        if (advanced.count !== 1) throw new Error("uliq_mainnet_locking_cursor_lost");
      }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 60000 });
      return { processedEvents: logs.length, processedBlocks: Number(toBlock - fromBlock + 1n) };
    } catch (error) {
      await this.db.onchainSyncCursor.updateMany({ where: { id, leaseOwner: owner }, data: { failureCount: { increment: 1 }, lastError: "uliq_mainnet_locking_indexer_failed" } });
      // Polling-job logs must not expose authenticated RPC URLs from provider errors.
      throw new Error("uliq_mainnet_locking_indexer_failed", { cause: undefined });
    } finally {
      await this.db.onchainSyncCursor.updateMany({ where: { id, leaseOwner: owner }, data: { leaseOwner: null, leaseExpiresAt: null } });
    }
  }
}

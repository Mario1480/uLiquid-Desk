import crypto from "node:crypto";
import { decodeEventLog, zeroAddress, type Hex, type Log } from "viem";
import { uliqGlobalListingAbi, uliqPresaleRoundAbi, uliqPresaleRoundVestingAbi } from "./abi.js";
import {
  getUliqPublicPresaleConfig,
  type UliqPublicPresaleConfig,
  type UliqPublicPresaleRoundConfig
} from "./publicPresale.config.js";
import { createUliqRpcPair, getConsistentBlockAt, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";

const CURSOR_PREFIX = "uliq-public-presale";
const LEASE_MS = 30_000;
const MAX_BLOCK_SPAN = 500n;

type IndexerLog = Log & {
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  address: `0x${string}`;
};

function cursorId(config: UliqPublicPresaleConfig): string {
  return `${CURSOR_PREFIX}:${config.chainId}:all`;
}

function sameAddress(left: unknown, right: unknown): boolean {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function jsonValue(value: unknown): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, jsonValue(nested)]));
  }
  return value;
}

function findRound(config: UliqPublicPresaleConfig, address: unknown): UliqPublicPresaleRoundConfig | null {
  return config.rounds.find((round) => sameAddress(round.contractAddress, address) || sameAddress(round.vestingAddress, address)) ?? null;
}

function decodeLog(config: UliqPublicPresaleConfig, log: IndexerLog): { eventName: string; args: any } | null {
  const round = findRound(config, log.address);
  const abi = round
    ? sameAddress(round.contractAddress, log.address) ? uliqPresaleRoundAbi : uliqPresaleRoundVestingAbi
    : sameAddress(config.globalListingAddress, log.address) ? uliqGlobalListingAbi : null;
  if (!abi) return null;
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
    return { eventName: decoded.eventName, args: jsonValue(decoded.args) };
  } catch {
    return null;
  }
}

async function resolveUserId(tx: any, walletAddress: string): Promise<string | null> {
  const user = await tx.user.findFirst({
    where: { walletAddress: { equals: walletAddress, mode: "insensitive" } },
    select: { id: true }
  });
  return user?.id ?? null;
}

async function termsEvidence(tx: any, config: UliqPublicPresaleConfig, walletAddress: string): Promise<string> {
  if (!config.terms.version || !config.terms.textHash) return "DIRECT_ONCHAIN_UNVERIFIED";
  const acknowledgement = await tx.uliqPresaleLegalAcknowledgement.findUnique({
    where: {
      walletAddress_chainId_version_textHash: {
        walletAddress,
        chainId: config.chainId,
        version: config.terms.version,
        textHash: config.terms.textHash
      }
    },
    select: { id: true }
  });
  return acknowledgement ? config.terms.version : "DIRECT_ONCHAIN_UNVERIFIED";
}

async function projectLog(params: {
  tx: any;
  config: UliqPublicPresaleConfig;
  log: IndexerLog;
  decoded: { eventName: string; args: any };
  blockTimestamp: Date;
}) {
  const { tx, config, log, decoded, blockTimestamp } = params;
  const round = findRound(config, log.address);
  if (!round) return;
  const contractAddress = log.address.toLowerCase();

  if (sameAddress(log.address, round.contractAddress)) {
    if (decoded.eventName === "PurchaseCreated") {
      if (Number(decoded.args.roundId) !== round.number) throw new Error("uliq_public_presale_indexer_round_mismatch");
      const walletAddress = String(decoded.args.buyer).toLowerCase();
      const allocationRaw = BigInt(String(decoded.args.uliqAllocationRaw));
      const initialUnlockRaw = allocationRaw * round.expected.initialUnlockBps / 10_000n;
      const linearVestingRaw = allocationRaw - initialUnlockRaw;
      const userId = await resolveUserId(tx, walletAddress);
      await tx.uliqPresalePurchase.upsert({
        where: {
          chainId_presaleContractAddress_purchaseIdOnchain: {
            chainId: config.chainId,
            presaleContractAddress: contractAddress,
            purchaseIdOnchain: String(decoded.args.purchaseId)
          }
        },
        create: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: String(decoded.args.purchaseId),
          userId,
          walletAddress,
          buyerAddress: walletAddress,
          purchaseTimestamp: blockTimestamp,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.logIndex,
          usdcAmountRaw: String(decoded.args.usdcAmountRaw),
          uliqAllocationRaw: allocationRaw.toString(),
          finalizationWalletRaw: initialUnlockRaw.toString(),
          finalizationVestingRaw: linearVestingRaw.toString(),
          status: "PENDING_WITHDRAWAL",
          withdrawalDeadline: new Date(Number(decoded.args.withdrawalDeadline) * 1_000),
          purchaseBlockNumber: log.blockNumber,
          purchaseBlockHash: log.blockHash.toLowerCase(),
          legalTermsVersion: await termsEvidence(tx, config, walletAddress)
        },
        update: {
          userId,
          walletAddress,
          buyerAddress: walletAddress,
          purchaseTimestamp: blockTimestamp,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.logIndex,
          usdcAmountRaw: String(decoded.args.usdcAmountRaw),
          uliqAllocationRaw: allocationRaw.toString(),
          finalizationWalletRaw: initialUnlockRaw.toString(),
          finalizationVestingRaw: linearVestingRaw.toString(),
          status: "PENDING_WITHDRAWAL",
          withdrawalDeadline: new Date(Number(decoded.args.withdrawalDeadline) * 1_000),
          purchaseBlockNumber: log.blockNumber,
          purchaseBlockHash: log.blockHash.toLowerCase()
        }
      });
    } else if (decoded.eventName === "PurchaseWithdrawn") {
      await tx.uliqPresalePurchase.updateMany({
        where: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: String(decoded.args.purchaseId)
        },
        data: {
          status: "WITHDRAWN",
          withdrawTxHash: log.transactionHash.toLowerCase(),
          refundTxHash: log.transactionHash.toLowerCase(),
          withdrawnAt: blockTimestamp,
          refundedAt: blockTimestamp
        }
      });
    } else if (decoded.eventName === "PurchaseFinalized") {
      await tx.uliqPresalePurchase.updateMany({
        where: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: String(decoded.args.purchaseId)
        },
        data: {
          status: "FINALIZED",
          finalizationWalletRaw: String(decoded.args.initialUnlockUliqRaw),
          finalizationVestingRaw: String(decoded.args.linearVestingUliqRaw),
          finalizeTxHash: log.transactionHash.toLowerCase(),
          finalizedAt: blockTimestamp
        }
      });
    }
    return;
  }

  if (sameAddress(log.address, round.vestingAddress)) {
    const walletAddress = String(decoded.args.beneficiary ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) return;
    if (decoded.eventName === "AllocationCreated") {
      await tx.uliqVestingPosition.upsert({
        where: {
          chainId_contractAddress_walletAddress: {
            chainId: config.chainId,
            contractAddress,
            walletAddress
          }
        },
        create: {
          chainId: config.chainId,
          contractAddress,
          walletAddress,
          allocatedRaw: String(decoded.args.allocatedTotal),
          releasedRaw: "0",
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash.toLowerCase()
        },
        update: {
          allocatedRaw: String(decoded.args.allocatedTotal),
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash.toLowerCase()
        }
      });
    } else if (decoded.eventName === "TokensReleased") {
      await tx.uliqVestingPosition.updateMany({
        where: { chainId: config.chainId, contractAddress, walletAddress },
        data: {
          releasedRaw: String(decoded.args.releasedTotal),
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash.toLowerCase()
        }
      });
    }
  }
}

export class UliqPublicPresaleIndexerService {
  readonly owner = `${CURSOR_PREFIX}:${process.pid}:${crypto.randomUUID()}`;

  constructor(
    private readonly db: any,
    private readonly config: UliqPublicPresaleConfig = getUliqPublicPresaleConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async runOnce(now = new Date()): Promise<{ processedBlocks: number; processedEvents: number; reorgDepth: number }> {
    const cursorKey = cursorId(this.config);
    const initialBlock = this.config.startBlock - 1n;
    await this.db.onchainSyncCursor.upsert({
      where: { id: cursorKey },
      create: {
        id: cursorKey,
        chainId: this.config.chainId,
        startBlock: this.config.startBlock,
        lastProcessedBlock: initialBlock,
        lastFinalizedBlock: initialBlock
      },
      update: {}
    });
    const claimed = await this.db.onchainSyncCursor.updateMany({
      where: {
        id: cursorKey,
        AND: [
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          { OR: [{ leaseOwner: null }, { leaseOwner: this.owner }, { leaseExpiresAt: { lte: now } }] }
        ]
      },
      data: {
        leaseOwner: this.owner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        heartbeatAt: now
      }
    });
    if (claimed.count !== 1) return { processedBlocks: 0, processedEvents: 0, reorgDepth: 0 };

    let cursor = await this.db.onchainSyncCursor.findUnique({ where: { id: cursorKey } });
    let reorgDepth = 0;
    const addresses = [
      this.config.globalListingAddress,
      ...this.config.rounds.flatMap((round) => [round.contractAddress, round.vestingAddress])
    ].map((address) => address.toLowerCase());

    if (BigInt(cursor.lastProcessedBlock) >= this.config.startBlock && cursor.lastProcessedBlockHash) {
      const current = await getConsistentBlockAt(this.rpc, BigInt(cursor.lastProcessedBlock));
      if (!current.hash || !sameAddress(current.hash, cursor.lastProcessedBlockHash)) {
        reorgDepth = Number(BigInt(cursor.lastProcessedBlock) - initialBlock);
        await this.db.$transaction(async (tx: any) => {
          await tx.onchainIndexedEvent.updateMany({
            where: {
              chainId: this.config.chainId,
              OR: [
                { eventKey: { startsWith: `${cursorKey}:` } },
                { contractAddress: { in: addresses } }
              ]
            },
            data: { canonicalStatus: "ORPHANED", orphanedAt: now }
          });
          await tx.uliqPresalePurchase.deleteMany({
            where: { chainId: this.config.chainId, presaleContractAddress: { in: this.config.rounds.map((round) => round.contractAddress.toLowerCase()) } }
          });
          await tx.uliqVestingPosition.deleteMany({
            where: { chainId: this.config.chainId, contractAddress: { in: this.config.rounds.map((round) => round.vestingAddress.toLowerCase()) } }
          });
          await tx.onchainSyncCursor.update({
            where: { id: cursorKey },
            data: {
              lastProcessedBlock: initialBlock,
              lastFinalizedBlock: initialBlock,
              lastProcessedBlockHash: null,
              heartbeatAt: now
            }
          });
        });
        cursor = await this.db.onchainSyncCursor.findUnique({ where: { id: cursorKey } });
      }
    }

    const finalized = await getConsistentFinalizedBlock(this.rpc);
    const fromBlock = BigInt(cursor.lastProcessedBlock) + 1n;
    if (fromBlock > finalized.number) return { processedBlocks: 0, processedEvents: 0, reorgDepth };
    const toBlock = fromBlock + MAX_BLOCK_SPAN - 1n < finalized.number
      ? fromBlock + MAX_BLOCK_SPAN - 1n
      : finalized.number;
    const [primaryLogs, secondaryLogs] = await Promise.all([
      this.rpc.primary.getLogs({ address: addresses as `0x${string}`[], fromBlock, toBlock }),
      this.rpc.secondary.getLogs({ address: addresses as `0x${string}`[], fromBlock, toBlock })
    ]) as [IndexerLog[], IndexerLog[]];
    const logIdentity = (log: IndexerLog) => [
      log.blockNumber.toString(),
      log.blockHash.toLowerCase(),
      log.transactionHash.toLowerCase(),
      log.logIndex,
      log.address.toLowerCase(),
      log.data.toLowerCase(),
      ...log.topics.map((topic) => topic.toLowerCase())
    ].join(":");
    const primaryLogIdentity = primaryLogs.map(logIdentity).sort();
    const secondaryLogIdentity = secondaryLogs.map(logIdentity).sort();
    if (JSON.stringify(primaryLogIdentity) !== JSON.stringify(secondaryLogIdentity)) {
      throw new Error("uliq_public_presale_rpc_log_mismatch");
    }
    const logs = primaryLogs;
    const blocks = new Map<bigint, { hash: Hex; parentHash: Hex; timestamp: Date }>();
    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1n) {
      const [primary, secondary] = await Promise.all([
        this.rpc.primary.getBlock({ blockNumber }),
        this.rpc.secondary.getBlock({ blockNumber })
      ]);
      if (!primary.hash || primary.hash !== secondary.hash) throw new Error("uliq_public_presale_rpc_block_mismatch");
      blocks.set(blockNumber, {
        hash: primary.hash,
        parentHash: primary.parentHash,
        timestamp: new Date(Number(primary.timestamp) * 1_000)
      });
    }

    let processedEvents = 0;
    await this.db.$transaction(async (tx: any) => {
      for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1n) {
        const block = blocks.get(blockNumber)!;
        await tx.onchainIndexedEvent.upsert({
          where: { eventKey: `${cursorKey}:block:${blockNumber}` },
          create: {
            eventKey: `${cursorKey}:block:${blockNumber}`,
            chainId: this.config.chainId,
            blockNumber,
            blockHash: block.hash,
            parentBlockHash: block.parentHash,
            transactionHash: block.hash,
            logIndex: -1,
            contractAddress: zeroAddress,
            eventName: "__BLOCK__",
            payload: {},
            canonicalStatus: "FINALIZED",
            confirmations: 0,
            blockTimestamp: block.timestamp,
            confirmedAt: now,
            finalizedAt: now
          },
          update: {
            blockHash: block.hash,
            parentBlockHash: block.parentHash,
            canonicalStatus: "FINALIZED",
            blockTimestamp: block.timestamp,
            orphanedAt: null,
            finalizedAt: now
          }
        });
      }

      for (const log of [...logs].sort((left, right) => (
        left.blockNumber === right.blockNumber ? left.logIndex - right.logIndex : left.blockNumber < right.blockNumber ? -1 : 1
      ))) {
        const decoded = decodeLog(this.config, log);
        if (!decoded) continue;
        const eventKey = `${this.config.chainId}:${log.transactionHash.toLowerCase()}:${log.logIndex}`;
        const block = blocks.get(log.blockNumber)!;
        await tx.onchainIndexedEvent.upsert({
          where: { eventKey },
          create: {
            eventKey,
            chainId: this.config.chainId,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            parentBlockHash: block.parentHash,
            transactionHash: log.transactionHash.toLowerCase(),
            logIndex: log.logIndex,
            contractAddress: log.address.toLowerCase(),
            eventName: decoded.eventName,
            payload: decoded.args,
            canonicalStatus: "FINALIZED",
            confirmations: 0,
            blockTimestamp: block.timestamp,
            confirmedAt: now,
            finalizedAt: now
          },
          update: {
            blockHash: log.blockHash,
            parentBlockHash: block.parentHash,
            payload: decoded.args,
            canonicalStatus: "FINALIZED",
            blockTimestamp: block.timestamp,
            orphanedAt: null,
            finalizedAt: now
          }
        });
        await projectLog({ tx, config: this.config, log, decoded, blockTimestamp: block.timestamp });
        processedEvents += 1;
      }

      const finalBlock = blocks.get(toBlock)!;
      const advanced = await tx.onchainSyncCursor.updateMany({
        where: { id: cursorKey, leaseOwner: this.owner, lastProcessedBlock: cursor.lastProcessedBlock },
        data: {
          lastProcessedBlock: toBlock,
          lastFinalizedBlock: finalized.number,
          lastProcessedBlockHash: finalBlock.hash,
          heartbeatAt: now,
          lastSuccessfulAt: now,
          failureCount: 0,
          nextRetryAt: null,
          lastError: null,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS)
        }
      });
      if (advanced.count !== 1) throw new Error("uliq_public_presale_indexer_cursor_cas_lost");
    }, { maxWait: 5_000, timeout: 60_000, isolationLevel: "Serializable" });

    return { processedBlocks: Number(toBlock - fromBlock + 1n), processedEvents, reorgDepth };
  }
}

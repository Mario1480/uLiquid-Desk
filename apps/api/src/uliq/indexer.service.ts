import crypto from "node:crypto";
import { decodeEventLog, zeroAddress, type Log, type PublicClient } from "viem";
import { uliqLockerAbi, uliqPaymentCustodyAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import {
  getUliqLockerAddresses,
  getUliqRuntimeConfig,
  isUliqLockerAddress,
  type UliqRuntimeConfig
} from "./config.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";
import { parseDatabaseUint256Decimal } from "./uint256.js";

const CURSOR_PREFIX = "uliq";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_BLOCK_SPAN = 500n;
const DEFAULT_REORG_WINDOW = 128n;

type DecodedUliqEvent = {
  eventName: string;
  args: Record<string, unknown>;
};

type IndexerLog = Log & {
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
  address: `0x${string}`;
};

function cursorId(config: UliqRuntimeConfig): string {
  return `${CURSOR_PREFIX}:${config.chainId}:all`;
}

function normalizeJson(value: unknown): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeJson(nested)]));
  }
  return value;
}

function normalizedAddress(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function splitFinalizedAllocation(allocationRaw: bigint): { walletRaw: bigint; vestingRaw: bigint } {
  const walletRaw = allocationRaw * 2_500n / 10_000n;
  return { walletRaw, vestingRaw: allocationRaw - walletRaw };
}

export function shouldConsumeHoldingTransfer(params: {
  from: string;
  to: string;
  config: UliqRuntimeConfig;
}): boolean {
  const from = params.from.toLowerCase();
  const to = params.to.toLowerCase();
  const sourcesWithoutIndependentLots = new Set([
    params.config.contracts.presale.toLowerCase(),
    params.config.contracts.vesting.toLowerCase(),
    ...getUliqLockerAddresses(params.config).map((address) => address.toLowerCase())
  ]);
  return from !== zeroAddress
    && !sourcesWithoutIndependentLots.has(from)
    && !getUliqLockerAddresses(params.config).some((address) => address.toLowerCase() === to);
}

export function decodeUliqLog(log: IndexerLog, config: UliqRuntimeConfig): DecodedUliqEvent | null {
  const address = log.address.toLowerCase();
  const abi = address === config.contracts.token.toLowerCase()
    ? uliqTokenAbi
    : address === config.contracts.presale.toLowerCase()
      ? uliqPresaleAbi
      : address === config.contracts.vesting.toLowerCase()
        ? uliqVestingAbi
        : isUliqLockerAddress(config, address)
          ? uliqLockerAbi
          : address === config.contracts.paymentCustody.toLowerCase()
            ? uliqPaymentCustodyAbi
            : null;
  if (!abi) return null;
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
    return { eventName: decoded.eventName, args: normalizeJson(decoded.args) };
  } catch {
    return null;
  }
}

async function resolveUserIdByWallet(tx: any, walletAddress: string): Promise<string | null> {
  const user = await tx.user.findUnique({ where: { walletAddress }, select: { id: true } });
  return user?.id ?? null;
}

async function consumeHoldingLots(tx: any, config: UliqRuntimeConfig, walletAddress: string, amountRaw: bigint): Promise<void> {
  let remaining = amountRaw;
  const lots = await tx.uliqHoldingLot.findMany({
    where: { chainId: config.chainId, walletAddress, canonical: true, remainingRaw: { gt: 0 } },
    orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }]
  });
  for (const lot of lots) {
    if (remaining === 0n) break;
    const available = parseDatabaseUint256Decimal(lot.remainingRaw, "holding_lot_remaining_raw");
    const consumed = available < remaining ? available : remaining;
    await tx.uliqHoldingLot.update({
      where: { id: lot.id },
      data: { remainingRaw: (available - consumed).toString() }
    });
    remaining -= consumed;
  }
}

async function createHoldingLot(params: {
  tx: any;
  config: UliqRuntimeConfig;
  walletAddress: string;
  amountRaw: bigint;
  eventKey: string;
  provenance: "PRESALE_FINALIZED" | "WALLET_TRANSFER";
  acquiredAt: Date;
  blockNumber: bigint;
  blockHash: string;
}) {
  if (params.amountRaw === 0n || params.walletAddress === zeroAddress) return;
  const userId = await resolveUserIdByWallet(params.tx, params.walletAddress);
  await params.tx.uliqHoldingLot.upsert({
    where: {
      chainId_sourceEventKey: {
        chainId: params.config.chainId,
        sourceEventKey: params.eventKey
      }
    },
    create: {
      userId,
      chainId: params.config.chainId,
      walletAddress: params.walletAddress,
      provenance: params.provenance,
      sourceEventKey: params.eventKey,
      lineageRoot: params.eventKey,
      amountRaw: params.amountRaw.toString(),
      remainingRaw: params.amountRaw.toString(),
      acquiredAt: params.acquiredAt,
      monetaryEligibleAt: params.acquiredAt,
      asOfBlock: params.blockNumber,
      blockHash: params.blockHash,
      canonical: true
    },
    update: {
      userId,
      walletAddress: params.walletAddress,
      amountRaw: params.amountRaw.toString(),
      remainingRaw: params.amountRaw.toString(),
      acquiredAt: params.acquiredAt,
      monetaryEligibleAt: params.acquiredAt,
      asOfBlock: params.blockNumber,
      blockHash: params.blockHash,
      canonical: true
    }
  });
}

export async function projectUliqEvent(params: {
  tx: any;
  config: UliqRuntimeConfig;
  log: IndexerLog;
  decoded: DecodedUliqEvent;
  eventKey: string;
  blockTimestamp: Date;
}) {
  const { tx, config, log, decoded, eventKey, blockTimestamp } = params;
  const args = decoded.args;
  const contractAddress = log.address.toLowerCase();

  if (contractAddress === config.contracts.paymentCustody.toLowerCase()) {
    if (decoded.eventName === "PaymentReleased") {
      await tx.uliqPresalePurchase.updateMany({
        where: {
          chainId: config.chainId,
          presaleContractAddress: config.contracts.presale.toLowerCase(),
          purchaseIdOnchain: String(args.purchaseId)
        },
        data: {
          treasuryRecipient: normalizedAddress(args.treasury),
          treasuryReleasedUsdcRaw: String(args.amount),
          treasuryReleaseTxHash: log.transactionHash.toLowerCase(),
          treasuryReleasedAt: blockTimestamp
        }
      });
    }
  }

  if (contractAddress === config.contracts.presale.toLowerCase()) {
    if (decoded.eventName === "PurchaseCreated") {
      const purchaseId = String(args.purchaseId);
      const walletAddress = normalizedAddress(args.buyer);
      const allocation = BigInt(String(args.uliqAllocationRaw));
      const split = splitFinalizedAllocation(allocation);
      await tx.uliqPresalePurchase.upsert({
        where: {
          chainId_presaleContractAddress_purchaseIdOnchain: {
            chainId: config.chainId,
            presaleContractAddress: contractAddress,
            purchaseIdOnchain: purchaseId
          }
        },
        create: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: purchaseId,
          userId: await resolveUserIdByWallet(tx, walletAddress),
          walletAddress,
          buyerAddress: walletAddress,
          purchaseTimestamp: blockTimestamp,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.logIndex,
          usdcAmountRaw: String(args.usdcAmountRaw),
          uliqAllocationRaw: allocation.toString(),
          finalizationWalletRaw: split.walletRaw.toString(),
          finalizationVestingRaw: split.vestingRaw.toString(),
          status: "PENDING_WITHDRAWAL",
          withdrawalDeadline: new Date(Number(args.withdrawalDeadline) * 1_000),
          purchaseBlockNumber: log.blockNumber,
          purchaseBlockHash: log.blockHash,
          legalTermsVersion: "TESTNET_PROVISIONAL_ADR_001_BLOCKED"
        },
        update: {
          purchaseBlockHash: log.blockHash,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.logIndex,
          status: "PENDING_WITHDRAWAL"
        }
      });
    } else if (decoded.eventName === "PurchaseWithdrawn") {
      await tx.uliqPresalePurchase.updateMany({
        where: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: String(args.purchaseId),
          status: "PENDING_WITHDRAWAL"
        },
        data: { status: "WITHDRAWN", refundTxHash: log.transactionHash.toLowerCase(), withdrawnAt: blockTimestamp, refundedAt: blockTimestamp }
      });
    } else if (decoded.eventName === "PurchaseFinalized") {
      const allocation = BigInt(String(args.walletUliqRaw)) + BigInt(String(args.vestingUliqRaw));
      const walletAddress = normalizedAddress(args.buyer);
      await tx.uliqPresalePurchase.updateMany({
        where: {
          chainId: config.chainId,
          presaleContractAddress: contractAddress,
          purchaseIdOnchain: String(args.purchaseId),
          status: "PENDING_WITHDRAWAL"
        },
        data: {
          status: "FINALIZED",
          finalizationWalletRaw: String(args.walletUliqRaw),
          finalizationVestingRaw: String(args.vestingUliqRaw),
          finalizeTxHash: log.transactionHash.toLowerCase(),
          finalizedAt: blockTimestamp
        }
      });
      await createHoldingLot({
        tx,
        config,
        walletAddress,
        amountRaw: allocation,
        eventKey: `${eventKey}:presale-finalized`,
        provenance: "PRESALE_FINALIZED",
        acquiredAt: blockTimestamp,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash
      });
    } else if (decoded.eventName === "UnsoldUliqReleased") {
      await createHoldingLot({
        tx,
        config,
        walletAddress: normalizedAddress(args.treasury),
        amountRaw: BigInt(String(args.amount)),
        eventKey: `${eventKey}:unsold-release`,
        provenance: "WALLET_TRANSFER",
        acquiredAt: blockTimestamp,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash
      });
    } else if (decoded.eventName === "DexLaunchTimestampSet") {
      const start = new Date(Number(args.dexLaunchTimestamp) * 1_000);
      const durationMs = 270 * 24 * 60 * 60 * 1_000;
      await tx.uliqVestingPosition.updateMany({
        where: { chainId: config.chainId, contractAddress: config.contracts.vesting.toLowerCase() },
        data: { vestingStart: start, vestingEnd: new Date(start.getTime() + durationMs), asOfBlock: log.blockNumber, blockHash: log.blockHash }
      });
    }
  }

  if (contractAddress === config.contracts.vesting.toLowerCase()) {
    const walletAddress = normalizedAddress(args.beneficiary);
    if (decoded.eventName === "AllocationCreated") {
      await tx.uliqVestingPosition.upsert({
        where: { chainId_contractAddress_walletAddress: { chainId: config.chainId, contractAddress, walletAddress } },
        create: {
          chainId: config.chainId,
          contractAddress,
          walletAddress,
          allocatedRaw: String(args.allocatedTotal),
          releasedRaw: "0",
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash
        },
        update: { allocatedRaw: String(args.allocatedTotal), asOfBlock: log.blockNumber, blockHash: log.blockHash }
      });
    } else if (decoded.eventName === "TokensReleased") {
      await tx.uliqVestingPosition.updateMany({
        where: { chainId: config.chainId, contractAddress, walletAddress },
        data: { releasedRaw: String(args.releasedTotal), asOfBlock: log.blockNumber, blockHash: log.blockHash }
      });
    } else if (decoded.eventName === "VestingStartSet") {
      const start = new Date(Number(args.vestingStart) * 1_000);
      const end = new Date(Number(args.vestingEnd) * 1_000);
      await tx.uliqVestingPosition.updateMany({
        where: { chainId: config.chainId, contractAddress },
        data: { vestingStart: start, vestingEnd: end, asOfBlock: log.blockNumber, blockHash: log.blockHash }
      });
    }
  }

  if (isUliqLockerAddress(config, contractAddress)) {
    const walletAddress = normalizedAddress(args.owner);
    if (decoded.eventName === "TokensLocked") {
      const durationSeconds = Number(args.durationSeconds);
      const unlockAt = new Date(Number(args.unlockAt) * 1_000);
      await tx.uliqLockPosition.upsert({
        where: { chainId_contractAddress_lockIdOnchain: { chainId: config.chainId, contractAddress, lockIdOnchain: String(args.lockId) } },
        create: {
          chainId: config.chainId,
          contractAddress,
          lockIdOnchain: String(args.lockId),
          walletAddress,
          amountRaw: String(args.amount),
          durationDays: Math.floor(durationSeconds / 86_400),
          startAt: new Date(unlockAt.getTime() - durationSeconds * 1_000),
          originalUnlockAt: unlockAt,
          unlockAt,
          extensionCount: 0,
          status: unlockAt <= blockTimestamp ? "MATURED" : "ACTIVE",
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash
        },
        update: {
          amountRaw: String(args.amount),
          originalUnlockAt: unlockAt,
          unlockAt,
          lastExtendedAt: null,
          extensionCount: 0,
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash,
          status: unlockAt <= blockTimestamp ? "MATURED" : "ACTIVE"
        }
      });
    } else if (decoded.eventName === "LockExtended") {
      const newUnlockAt = new Date(Number(args.newUnlockAt) * 1_000);
      await tx.uliqLockPosition.updateMany({
        where: {
          chainId: config.chainId,
          contractAddress,
          lockIdOnchain: String(args.lockId),
          walletAddress,
          status: { in: ["ACTIVE", "MATURED"] }
        },
        data: {
          unlockAt: newUnlockAt,
          lastExtendedAt: blockTimestamp,
          extensionCount: { increment: 1 },
          status: newUnlockAt <= blockTimestamp ? "MATURED" : "ACTIVE",
          asOfBlock: log.blockNumber,
          blockHash: log.blockHash
        }
      });
    } else if (decoded.eventName === "TokensUnlocked") {
      await tx.uliqLockPosition.updateMany({
        where: { chainId: config.chainId, contractAddress, lockIdOnchain: String(args.lockId) },
        data: { status: "WITHDRAWN", withdrawnAt: blockTimestamp, asOfBlock: log.blockNumber, blockHash: log.blockHash }
      });
    }
  }

  if (contractAddress === config.contracts.token.toLowerCase() && decoded.eventName === "Transfer") {
    const from = normalizedAddress(args.from);
    const to = normalizedAddress(args.to);
    const amount = BigInt(String(args.value));
    const internalContracts = new Set([
      config.contracts.presale.toLowerCase(),
      config.contracts.vesting.toLowerCase(),
      ...getUliqLockerAddresses(config).map((address) => address.toLowerCase())
    ]);
    if (shouldConsumeHoldingTransfer({ from, to, config })) {
      await consumeHoldingLots(tx, config, from, amount);
    }
    if (to !== zeroAddress && !internalContracts.has(from) && !internalContracts.has(to)) {
      await createHoldingLot({
        tx,
        config,
        walletAddress: to,
        amountRaw: amount,
        eventKey: `${eventKey}:transfer-in`,
        provenance: "WALLET_TRANSFER",
        acquiredAt: blockTimestamp,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash
      });
    }
  }
}

export async function acquireUliqIndexerLease(params: {
  db: any;
  config: UliqRuntimeConfig;
  owner: string;
  now?: Date;
  leaseMs?: number;
}): Promise<any | null> {
  const now = params.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (params.leaseMs ?? DEFAULT_LEASE_MS));
  return params.db.$transaction(async (tx: any) => {
    await tx.onchainSyncCursor.upsert({
      where: { id: cursorId(params.config) },
      create: {
        id: cursorId(params.config),
        chainId: params.config.chainId,
        startBlock: params.config.startBlock,
        lastProcessedBlock: params.config.startBlock > 0n ? params.config.startBlock - 1n : 0n,
        lastFinalizedBlock: 0n
      },
      update: {}
    });
    const claimed = await tx.onchainSyncCursor.updateMany({
      where: {
        id: cursorId(params.config),
        AND: [
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          { OR: [
            { leaseOwner: null },
            { leaseOwner: params.owner },
            { leaseExpiresAt: { lte: now } }
          ] }
        ]
      },
      data: { leaseOwner: params.owner, leaseExpiresAt, heartbeatAt: now }
    });
    if (claimed.count !== 1) return null;
    return tx.onchainSyncCursor.findUnique({ where: { id: cursorId(params.config) } });
  }, { isolationLevel: "Serializable" });
}

async function findCommonAncestor(params: {
  db: any;
  client: PublicClient;
  config: UliqRuntimeConfig;
  lastProcessedBlock: bigint;
}): Promise<bigint> {
  const minimum = params.lastProcessedBlock > DEFAULT_REORG_WINDOW
    ? params.lastProcessedBlock - DEFAULT_REORG_WINDOW
    : params.config.startBlock;
  for (let blockNumber = params.lastProcessedBlock; blockNumber >= minimum; blockNumber -= 1n) {
    const marker = await params.db.onchainIndexedEvent.findUnique({
      where: { eventKey: `${cursorId(params.config)}:block:${blockNumber}` },
      select: { blockHash: true }
    });
    if (marker?.blockHash) {
      const block = await params.client.getBlock({ blockNumber });
      if (block.hash?.toLowerCase() === String(marker.blockHash).toLowerCase()) return blockNumber;
    }
    if (blockNumber === 0n) break;
  }
  return params.config.startBlock > 0n ? params.config.startBlock - 1n : 0n;
}

export async function rollbackUliqAfterReorg(params: {
  db: any;
  config: UliqRuntimeConfig;
  ancestor: bigint;
  owner: string;
  now: Date;
}) {
  await params.db.$transaction(async (tx: any) => {
    await tx.onchainIndexedEvent.updateMany({
      where: {
        chainId: params.config.chainId,
        blockNumber: { gte: params.config.startBlock },
        OR: [
          { eventKey: { startsWith: `${cursorId(params.config)}:` } },
          { contractAddress: { in: Object.values(params.config.contracts).map((address) => address.toLowerCase()) } }
        ]
      },
      data: { canonicalStatus: "ORPHANED", orphanedAt: params.now }
    });
    // Rebuild all ULIQ projections from the deployment block. Replaying only
    // post-ancestor events would lose aggregate vesting/locking state whose
    // creation event predates the reorg but whose latest update does not.
    await tx.uliqPresalePurchase.deleteMany({ where: { chainId: params.config.chainId } });
    await tx.uliqVestingPosition.deleteMany({ where: { chainId: params.config.chainId } });
    await tx.uliqLockPosition.deleteMany({ where: { chainId: params.config.chainId } });
    await tx.uliqHoldingLot.deleteMany({ where: { chainId: params.config.chainId } });
    const staleSnapshots = await tx.uliqEntitlementSnapshot.findMany({
      where: { chainId: params.config.chainId, asOfBlock: { gt: params.ancestor } },
      select: { id: true }
    });
    const ids = staleSnapshots.map((row: any) => row.id);
    if (ids.length > 0) {
      const consumedReservations = await tx.uliqBenefitReservation.findMany({
        where: { entitlementSnapshotId: { in: ids }, status: "CONSUMED" }
      });
      await tx.uliqBenefitReservation.updateMany({
        where: { entitlementSnapshotId: { in: ids }, status: "RESERVED" },
        data: { status: "RELEASED", releasedAt: params.now, metadata: { releaseReason: "onchain_reorg" } }
      });
      await tx.uliqEntitlementSnapshot.updateMany({
        where: { id: { in: ids } },
        data: { validUntil: params.now, priceQualityStatus: "DEGRADED", degradationReason: "onchain_reorg" }
      });
      for (const reservation of consumedReservations) {
        const reversed = await tx.uliqBenefitReservation.updateMany({
          where: { id: reservation.id, status: "CONSUMED" },
          data: { status: "REVERSED", reversedAt: params.now, metadata: { reversalReason: "onchain_reorg" } }
        });
        if (reversed.count !== 1) continue;
        const metadata = reservation.metadata && typeof reservation.metadata === "object"
          ? reservation.metadata as Record<string, unknown>
          : {};
        await tx.uliqBenefitLedger.upsert({
          where: { idempotencyKey: `reservation:${reservation.id}:reversed:onchain-reorg` },
          create: {
            userId: reservation.userId,
            walletAddress: reservation.walletAddress,
            benefitType: reservation.benefitType,
            referenceType: reservation.referenceType,
            referenceId: reservation.referenceId,
            reservationId: reservation.id,
            tierSnapshot: String(metadata.tierSnapshot ?? "BASIC"),
            configVersion: reservation.configVersion,
            priceSnapshotId: reservation.priceSnapshotId,
            entitlementSnapshotId: reservation.entitlementSnapshotId,
            currency: reservation.currency,
            baseAmount: reservation.baseAmount,
            discountAmount: reservation.discountAmount,
            finalAmount: reservation.finalAmount,
            entryType: "REVERSED",
            idempotencyKey: `reservation:${reservation.id}:reversed:onchain-reorg`,
            metadata: { reversedAt: params.now.toISOString(), reason: "onchain_reorg", ancestor: params.ancestor.toString() }
          },
          update: {}
        });
        await tx.platformAlert.create({
          data: {
            severity: "critical",
            status: "open",
            type: "uliq_consumed_benefit_reorg_reversal",
            source: "uliq_indexer",
            title: "ULIQ consumed benefit invalidated by reorg",
            message: `Reservation ${reservation.id} requires operator review after a chain reorg.`,
            userId: reservation.userId,
            metadata: { reservationId: reservation.id, ancestor: params.ancestor.toString() }
          }
        });
      }
    }
    const rewindBlock = params.config.startBlock > 0n ? params.config.startBlock - 1n : 0n;
    await tx.onchainSyncCursor.updateMany({
      where: { id: cursorId(params.config), leaseOwner: params.owner },
      data: {
        lastProcessedBlock: rewindBlock,
        lastFinalizedBlock: rewindBlock,
        lastProcessedBlockHash: null,
        heartbeatAt: params.now
      }
    });
  }, { maxWait: 5_000, timeout: 60_000, isolationLevel: "Serializable" });
}

export class UliqIndexerService {
  readonly owner = `uliq-indexer:${process.pid}:${crypto.randomUUID()}`;

  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async runOnce(now = new Date()): Promise<{ processedBlocks: number; processedEvents: number; reorgDepth: number }> {
    let cursor = await acquireUliqIndexerLease({ db: this.db, config: this.config, owner: this.owner, now });
    if (!cursor) return { processedBlocks: 0, processedEvents: 0, reorgDepth: 0 };
    let reorgDepth = 0;
    if (BigInt(cursor.lastProcessedBlock) >= this.config.startBlock && cursor.lastProcessedBlockHash) {
      const current = await this.rpc.primary.getBlock({ blockNumber: BigInt(cursor.lastProcessedBlock) });
      if (current.hash?.toLowerCase() !== String(cursor.lastProcessedBlockHash).toLowerCase()) {
        const ancestor = await findCommonAncestor({
          db: this.db,
          client: this.rpc.primary,
          config: this.config,
          lastProcessedBlock: BigInt(cursor.lastProcessedBlock)
        });
        reorgDepth = Number(BigInt(cursor.lastProcessedBlock) - ancestor);
        await rollbackUliqAfterReorg({ db: this.db, config: this.config, ancestor, owner: this.owner, now });
        cursor = await this.db.onchainSyncCursor.findUnique({ where: { id: cursorId(this.config) } });
      }
    }

    const finalized = await getConsistentFinalizedBlock(this.rpc);
    const fromBlock = BigInt(cursor.lastProcessedBlock) + 1n < this.config.startBlock
      ? this.config.startBlock
      : BigInt(cursor.lastProcessedBlock) + 1n;
    if (fromBlock > finalized.number) return { processedBlocks: 0, processedEvents: 0, reorgDepth };
    const toBlock = fromBlock + DEFAULT_MAX_BLOCK_SPAN - 1n < finalized.number
      ? fromBlock + DEFAULT_MAX_BLOCK_SPAN - 1n
      : finalized.number;
    const addresses = [
      ...Object.values(this.config.contracts),
      ...getUliqLockerAddresses(this.config)
    ].filter((address, index, all) => (
      index === all.findIndex((candidate) => candidate.toLowerCase() === address.toLowerCase())
      && address !== this.config.contracts.usdc
    ));
    const logs = await this.rpc.primary.getLogs({ address: addresses, fromBlock, toBlock }) as IndexerLog[];
    const blockCache = new Map<bigint, { hash: `0x${string}`; parentHash: `0x${string}`; timestamp: Date }>();
    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1n) {
      const [primary, secondary] = await Promise.all([
        this.rpc.primary.getBlock({ blockNumber }),
        this.rpc.secondary.getBlock({ blockNumber })
      ]);
      if (!primary.hash || primary.hash !== secondary.hash) throw new Error("uliq_rpc_block_mismatch");
      blockCache.set(blockNumber, {
        hash: primary.hash,
        parentHash: primary.parentHash,
        timestamp: new Date(Number(primary.timestamp) * 1_000)
      });
    }

    let processedEvents = 0;
    await this.db.$transaction(async (tx: any) => {
      for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1n) {
        const block = blockCache.get(blockNumber)!;
        await tx.onchainIndexedEvent.upsert({
          where: { eventKey: `${cursorId(this.config)}:block:${blockNumber}` },
          create: {
            eventKey: `${cursorId(this.config)}:block:${blockNumber}`,
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
            confirmations: this.config.confirmations,
            confirmedAt: now,
            finalizedAt: now
          },
          update: {
            blockHash: block.hash,
            parentBlockHash: block.parentHash,
            canonicalStatus: "FINALIZED",
            orphanedAt: null,
            finalizedAt: now
          }
        });
      }

      for (const log of [...logs].sort((a, b) => (
        a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
      ))) {
        const decoded = decodeUliqLog(log, this.config);
        if (!decoded) continue;
        const eventKey = `${this.config.chainId}:${log.transactionHash.toLowerCase()}:${log.logIndex}`;
        const duplicate = await tx.onchainIndexedEvent.findUnique({ where: { eventKey }, select: { canonicalStatus: true, blockHash: true } });
        if (duplicate?.canonicalStatus === "FINALIZED" && String(duplicate.blockHash).toLowerCase() === log.blockHash.toLowerCase()) continue;
        const block = blockCache.get(log.blockNumber)!;
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
            confirmations: this.config.confirmations,
            confirmedAt: now,
            finalizedAt: now
          },
          update: {
            blockHash: log.blockHash,
            parentBlockHash: block.parentHash,
            payload: decoded.args,
            canonicalStatus: "FINALIZED",
            orphanedAt: null,
            finalizedAt: now
          }
        });
        await projectUliqEvent({ tx, config: this.config, log, decoded, eventKey, blockTimestamp: block.timestamp });
        processedEvents += 1;
      }

      const finalBlock = blockCache.get(toBlock)!;
      const advanced = await tx.onchainSyncCursor.updateMany({
        where: { id: cursorId(this.config), leaseOwner: this.owner, lastProcessedBlock: cursor.lastProcessedBlock },
        data: {
          lastProcessedBlock: toBlock,
          lastFinalizedBlock: finalized.number,
          lastProcessedBlockHash: finalBlock.hash,
          heartbeatAt: now,
          lastSuccessfulAt: now,
          failureCount: 0,
          nextRetryAt: null,
          lastError: null,
          leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS)
        }
      });
      if (advanced.count !== 1) throw new Error("uliq_indexer_cursor_cas_lost");
    }, { maxWait: 5_000, timeout: 60_000, isolationLevel: "Serializable" });
    return { processedBlocks: Number(toBlock - fromBlock + 1n), processedEvents, reorgDepth };
  }
}

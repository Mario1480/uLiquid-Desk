import { decodeEventLog, type Hex } from "viem";
import { logger } from "../logger.js";
import { uliqPresaleAbi } from "./abi.js";
import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import {
  createUliqRpcPair,
  getConsistentBlockAt,
  getConsistentFinalizedBlock,
  getConsistentSafeBlock,
  withUliqRpcFailover,
  type UliqRpcPair
} from "./rpc.js";
import {
  databaseUint256Decimal,
  normalizeUliqAddress,
  parseDatabaseUint256Decimal,
  parseUint256Decimal
} from "./uint256.js";

const ACTIVE_TRACKING_STATUSES = ["SUBMITTED", "SOFT_CONFIRMED", "SAFE"] as const;
const RECEIPT_REVIEW_AFTER_MS = 30 * 60 * 1_000;

type TrackingRow = {
  id: string;
  chainId: number;
  presaleContractAddress: string;
  transactionHash: string;
  userId: string;
  walletAddress: string;
  status: string;
  maxUsdcAmountRaw: unknown;
  minUliqAllocationRaw: unknown;
  actualUsdcAmountRaw?: unknown;
  actualUliqAllocationRaw?: unknown;
  purchaseIdOnchain?: unknown;
  logIndex?: number | null;
  receiptBlockNumber?: bigint | number | string | null;
  receiptBlockHash?: string | null;
  statusReason?: string | null;
  submittedAt: Date;
  receiptObservedAt?: Date | null;
  lastCheckedAt?: Date | null;
  networkFinalizedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

function normalizeTransactionHash(value: unknown): Hex {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error("invalid_transaction_hash");
  return normalized as Hex;
}

function optionalDatabaseUint256(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : databaseUint256Decimal(value, field);
}

export function mapUliqPurchaseTrackingForApi(row: TrackingRow) {
  return {
    id: String(row.id),
    chainId: Number(row.chainId),
    presaleContractAddress: String(row.presaleContractAddress),
    transactionHash: String(row.transactionHash),
    walletAddress: String(row.walletAddress),
    confirmationStatus: String(row.status),
    maxUsdcAmountRaw: databaseUint256Decimal(row.maxUsdcAmountRaw, "tracking_max_usdc_amount_raw"),
    minUliqAllocationRaw: databaseUint256Decimal(row.minUliqAllocationRaw, "tracking_min_uliq_allocation_raw"),
    usdcAmountRaw: optionalDatabaseUint256(row.actualUsdcAmountRaw, "tracking_actual_usdc_amount_raw"),
    uliqAllocationRaw: optionalDatabaseUint256(row.actualUliqAllocationRaw, "tracking_actual_uliq_allocation_raw"),
    purchaseIdOnchain: optionalDatabaseUint256(row.purchaseIdOnchain, "tracking_purchase_id_onchain"),
    logIndex: row.logIndex ?? null,
    receiptBlockNumber: row.receiptBlockNumber === null || row.receiptBlockNumber === undefined
      ? null
      : BigInt(row.receiptBlockNumber).toString(),
    receiptBlockHash: row.receiptBlockHash ?? null,
    statusReason: row.statusReason ?? null,
    submittedAt: row.submittedAt.toISOString(),
    receiptObservedAt: row.receiptObservedAt?.toISOString() ?? null,
    networkFinalizedAt: row.networkFinalizedAt?.toISOString() ?? null
  };
}

function isReceiptNotFound(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isReceiptNotFound);
  const reason = `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : String(error)}`;
  return /TransactionReceiptNotFound|transaction receipt.*not found|receipt.*could not be found/i.test(reason);
}

function decodedPurchaseCreated(receipt: any, presaleAddress: string) {
  const matches: Array<{ args: any; logIndex: number }> = [];
  for (const log of receipt.logs ?? []) {
    if (String(log.address ?? "").toLowerCase() !== presaleAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: uliqPresaleAbi,
        data: log.data,
        topics: log.topics,
        strict: true
      });
      if (decoded.eventName !== "PurchaseCreated" || typeof log.logIndex !== "number") continue;
      matches.push({ args: decoded.args, logIndex: log.logIndex });
    } catch {
      // Non-PurchaseCreated logs from the same contract are ignored.
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export class UliqPurchaseTrackingService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async trackSubmitted(params: {
    userId: string;
    transactionHash: unknown;
    maxUsdcAmountRaw: unknown;
    minUliqAllocationRaw: unknown;
  }) {
    const transactionHash = normalizeTransactionHash(params.transactionHash);
    const walletAddress = await this.requireWallet(params.userId);
    const maxUsdcAmountRaw = parseUint256Decimal(params.maxUsdcAmountRaw, "max_usdc_amount_raw");
    const minUliqAllocationRaw = parseUint256Decimal(params.minUliqAllocationRaw, "min_uliq_allocation_raw");
    if (maxUsdcAmountRaw === 0n || minUliqAllocationRaw === 0n) throw new Error("invalid_purchase_tracking_amount");

    const existing = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (existing) {
      if (existing.userId !== params.userId || String(existing.walletAddress).toLowerCase() !== walletAddress) {
        throw new Error("purchase_tracking_owner_mismatch");
      }
      return mapUliqPurchaseTrackingForApi(existing);
    }

    const created = await this.db.uliqPurchaseTracking.create({
      data: {
        chainId: this.config.chainId,
        presaleContractAddress: this.config.contracts.presale.toLowerCase(),
        transactionHash,
        userId: params.userId,
        walletAddress,
        status: "SUBMITTED",
        maxUsdcAmountRaw: maxUsdcAmountRaw.toString(),
        minUliqAllocationRaw: minUliqAllocationRaw.toString()
      }
    });
    return mapUliqPurchaseTrackingForApi(created);
  }

  async refreshForUser(userId: string, transactionHashInput: unknown, now = new Date()) {
    const transactionHash = normalizeTransactionHash(transactionHashInput);
    const row = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (!row || row.userId !== userId) throw new Error("purchase_tracking_not_found");
    return mapUliqPurchaseTrackingForApi(await this.reconcileRow(row, now));
  }

  async replaceSubmitted(params: {
    userId: string;
    transactionHash: unknown;
    replacementTransactionHash: unknown;
    reason?: "cancelled" | "replaced" | "repriced";
  }) {
    const transactionHash = normalizeTransactionHash(params.transactionHash);
    const replacementTransactionHash = normalizeTransactionHash(params.replacementTransactionHash);
    if (transactionHash === replacementTransactionHash) {
      return this.refreshForUser(params.userId, transactionHash);
    }
    const existing = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (!existing || existing.userId !== params.userId) throw new Error("purchase_tracking_not_found");

    const replacement = await this.db.$transaction(async (tx: any) => {
      if (params.reason === "cancelled") {
        return tx.uliqPurchaseTracking.update({
          where: { id: existing.id },
          data: {
            status: "FAILED",
            statusReason: `transaction_cancelled_by:${replacementTransactionHash}`,
            lastCheckedAt: new Date()
          }
        });
      }
      const duplicate = await tx.uliqPurchaseTracking.findUnique({
        where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash: replacementTransactionHash } }
      });
      if (duplicate && duplicate.userId !== params.userId) throw new Error("purchase_tracking_owner_mismatch");
      const next = duplicate ?? await tx.uliqPurchaseTracking.create({
        data: {
          chainId: existing.chainId,
          presaleContractAddress: existing.presaleContractAddress,
          transactionHash: replacementTransactionHash,
          userId: existing.userId,
          walletAddress: existing.walletAddress,
          status: "SUBMITTED",
          maxUsdcAmountRaw: existing.maxUsdcAmountRaw,
          minUliqAllocationRaw: existing.minUliqAllocationRaw
        }
      });
      await tx.uliqPurchaseTracking.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          statusReason: `transaction_${params.reason ?? "replaced"}_by:${replacementTransactionHash}`,
          lastCheckedAt: new Date()
        }
      });
      return next;
    });
    return mapUliqPurchaseTrackingForApi(replacement);
  }

  async reconcilePending(now = new Date(), limit = 100) {
    const rows = await this.db.uliqPurchaseTracking.findMany({
      where: {
        chainId: this.config.chainId,
        presaleContractAddress: this.config.contracts.presale.toLowerCase(),
        OR: [
          { status: { in: [...ACTIVE_TRACKING_STATUSES] } },
          { status: "FINALIZED", statusReason: "network_finalized" }
        ]
      },
      orderBy: [{ lastCheckedAt: "asc" }, { submittedAt: "asc" }],
      take: Math.max(1, Math.min(500, limit))
    });
    const result = { checked: 0, submitted: 0, softConfirmed: 0, safe: 0, finalized: 0, failed: 0, reorged: 0, reviewRequired: 0 };
    let transientErrors = 0;
    for (const row of rows) {
      try {
        const reconciled = await this.reconcileRow(row, now);
        result.checked += 1;
        if (reconciled.status === "SUBMITTED") result.submitted += 1;
        else if (reconciled.status === "SOFT_CONFIRMED") result.softConfirmed += 1;
        else if (reconciled.status === "SAFE") result.safe += 1;
        else if (reconciled.status === "FINALIZED") result.finalized += 1;
        else if (reconciled.status === "FAILED") result.failed += 1;
        else if (reconciled.status === "REORGED") result.reorged += 1;
        else if (reconciled.status === "REVIEW_REQUIRED") result.reviewRequired += 1;
      } catch (error) {
        transientErrors += 1;
        logger.warn("uliq_purchase_tracking_reconcile_failed", {
          trackingId: row.id,
          transactionHash: row.transactionHash,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { ...result, transientErrors };
  }

  private async reconcileRow(input: TrackingRow, now: Date): Promise<TrackingRow> {
    let row = input;
    const canonical = await this.db.uliqPresalePurchase.findFirst({
      where: {
        chainId: this.config.chainId,
        presaleContractAddress: this.config.contracts.presale.toLowerCase(),
        transactionHash: row.transactionHash
      }
    });
    if (canonical) {
      if (String(canonical.walletAddress).toLowerCase() !== row.walletAddress.toLowerCase()) {
        return this.updateStatus(row, "REVIEW_REQUIRED", "canonical_wallet_mismatch", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: {
          status: "FINALIZED",
          actualUsdcAmountRaw: canonical.usdcAmountRaw,
          actualUliqAllocationRaw: canonical.uliqAllocationRaw,
          purchaseIdOnchain: canonical.purchaseIdOnchain,
          logIndex: canonical.logIndex,
          receiptBlockNumber: canonical.purchaseBlockNumber,
          receiptBlockHash: canonical.purchaseBlockHash,
          statusReason: "canonical_indexer_matched",
          lastCheckedAt: now,
          networkFinalizedAt: row.networkFinalizedAt ?? now
        }
      });
    }

    if (row.status === "SUBMITTED") {
      let receipt: any;
      try {
        receipt = (await withUliqRpcFailover(this.rpc, (client) => client.getTransactionReceipt({
          hash: row.transactionHash as Hex
        }))).value;
      } catch (error) {
        if (!isReceiptNotFound(error)) throw error;
        if (now.getTime() - row.submittedAt.getTime() >= RECEIPT_REVIEW_AFTER_MS) {
          return this.updateStatus(row, "REVIEW_REQUIRED", "receipt_not_found_after_30m", now);
        }
        return this.db.uliqPurchaseTracking.update({ where: { id: row.id }, data: { lastCheckedAt: now } });
      }

      if (receipt.status !== "success") return this.updateStatus(row, "FAILED", "transaction_reverted", now);
      if (
        typeof receipt.blockNumber !== "bigint"
        || !/^0x[0-9a-fA-F]{64}$/.test(String(receipt.blockHash ?? ""))
      ) {
        return this.updateStatus(row, "REVIEW_REQUIRED", "receipt_block_identity_invalid", now);
      }
      const purchaseEvent = decodedPurchaseCreated(receipt, this.config.contracts.presale);
      if (!purchaseEvent) return this.updateStatus(row, "REVIEW_REQUIRED", "purchase_event_missing_or_ambiguous", now);
      const buyer = normalizeUliqAddress(purchaseEvent.args.buyer, "purchase_buyer").toLowerCase();
      const usdcAmountRaw = BigInt(String(purchaseEvent.args.usdcAmountRaw));
      const uliqAllocationRaw = BigInt(String(purchaseEvent.args.uliqAllocationRaw));
      const maxUsdcAmountRaw = parseDatabaseUint256Decimal(
        row.maxUsdcAmountRaw,
        "tracking_max_usdc_amount_raw"
      );
      const minUliqAllocationRaw = parseDatabaseUint256Decimal(
        row.minUliqAllocationRaw,
        "tracking_min_uliq_allocation_raw"
      );
      if (buyer !== row.walletAddress.toLowerCase()) {
        return this.updateStatus(row, "REVIEW_REQUIRED", "receipt_buyer_mismatch", now);
      }
      if (usdcAmountRaw === 0n || usdcAmountRaw > maxUsdcAmountRaw || uliqAllocationRaw < minUliqAllocationRaw) {
        return this.updateStatus(row, "REVIEW_REQUIRED", "receipt_amount_mismatch", now);
      }
      row = await this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: {
          status: "SOFT_CONFIRMED",
          actualUsdcAmountRaw: usdcAmountRaw.toString(),
          actualUliqAllocationRaw: uliqAllocationRaw.toString(),
          purchaseIdOnchain: String(purchaseEvent.args.purchaseId),
          logIndex: purchaseEvent.logIndex,
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: String(receipt.blockHash).toLowerCase(),
          receiptObservedAt: now,
          lastCheckedAt: now,
          statusReason: null
        }
      });
    }

    if (!row.receiptBlockNumber || !row.receiptBlockHash || !["SOFT_CONFIRMED", "SAFE"].includes(row.status)) {
      return row;
    }

    const receiptBlockNumber = BigInt(row.receiptBlockNumber);
    const finalizedHead = await getConsistentFinalizedBlock(this.rpc);
    if (finalizedHead.number >= receiptBlockNumber) {
      const canonicalBlock = await getConsistentBlockAt(this.rpc, receiptBlockNumber);
      if (canonicalBlock.hash.toLowerCase() !== row.receiptBlockHash.toLowerCase()) {
        return this.updateStatus(row, "REORGED", "receipt_block_reorged", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: { status: "FINALIZED", statusReason: "network_finalized", lastCheckedAt: now, networkFinalizedAt: now }
      });
    }

    const safeHead = await getConsistentSafeBlock(this.rpc);
    if (safeHead.number >= receiptBlockNumber) {
      const canonicalBlock = await getConsistentBlockAt(this.rpc, receiptBlockNumber);
      if (canonicalBlock.hash.toLowerCase() !== row.receiptBlockHash.toLowerCase()) {
        return this.updateStatus(row, "REORGED", "receipt_block_reorged", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: { status: "SAFE", statusReason: null, lastCheckedAt: now }
      });
    }

    return this.db.uliqPurchaseTracking.update({ where: { id: row.id }, data: { lastCheckedAt: now } });
  }

  private async updateStatus(row: TrackingRow, status: string, statusReason: string, now: Date) {
    return this.db.uliqPurchaseTracking.update({
      where: { id: row.id },
      data: { status, statusReason: statusReason.slice(0, 191), lastCheckedAt: now }
    });
  }

  private async requireWallet(userId: string): Promise<string> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    return normalizeUliqAddress(user.walletAddress, "wallet_address").toLowerCase();
  }
}

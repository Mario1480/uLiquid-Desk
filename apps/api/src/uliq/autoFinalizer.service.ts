import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../logger.js";
import { sendSerializedControllerTransaction } from "../vaults/controllerTransaction.js";
import { uliqPresaleAbi } from "./abi.js";
import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import {
  assertUliqRpcPair,
  createUliqRpcPair,
  getConsistentBlockAt,
  getConsistentFinalizedBlock,
  withUliqRpcFailover,
  type UliqRpcPair
} from "./rpc.js";

const ACTION_TYPE = "uliq_finalize_purchase";
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_RETRY_SECONDS = 60;
const DEFAULT_MAX_RETRY_SECONDS = 30 * 60;
const DEFAULT_SUBMISSION_STALE_SECONDS = 30 * 60;

type FinalizedHead = {
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
};

type OnchainPurchase = {
  buyer: `0x${string}`;
  usdcAmountRaw: bigint;
  uliqAllocationRaw: bigint;
  purchasedAt: bigint;
  withdrawalDeadline: bigint;
  state: number;
};

type FinalizationReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: `0x${string}`;
};

export type UliqAutoFinalizerSettings = {
  enabled: boolean;
  batchSize: number;
  retryBaseMs: number;
  retryMaxMs: number;
  submissionStaleMs: number;
};

export type UliqAutoFinalizerChain = {
  accountAddress: `0x${string}`;
  getFinalizedHead(): Promise<FinalizedHead>;
  readPurchase(blockNumber: bigint, purchaseId: bigint): Promise<OnchainPurchase>;
  readLatestPurchase(purchaseId: bigint): Promise<OnchainPurchase>;
  simulateFinalize(blockNumber: bigint, purchaseId: bigint): Promise<void>;
  sendFinalize(purchaseId: bigint): Promise<`0x${string}`>;
  getReceipt(txHash: `0x${string}`): Promise<FinalizationReceipt | null>;
  verifyBlock(blockNumber: bigint, blockHash: `0x${string}`): Promise<boolean>;
};

type UliqAutoFinalizerDeps = {
  settings?: UliqAutoFinalizerSettings;
  chain?: UliqAutoFinalizerChain;
  now?: () => Date;
};

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`uliq_auto_finalizer_invalid_${name}`);
  }
  return parsed;
}

export function getUliqAutoFinalizerSettings(env: NodeJS.ProcessEnv = process.env): UliqAutoFinalizerSettings {
  return {
    enabled: enabled(env.ULIQ_AUTO_FINALIZER_ENABLED),
    batchSize: boundedInteger(env.ULIQ_AUTO_FINALIZER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 50, "batch_size"),
    retryBaseMs: boundedInteger(
      env.ULIQ_AUTO_FINALIZER_RETRY_SECONDS,
      DEFAULT_RETRY_SECONDS,
      5,
      3_600,
      "retry_seconds"
    ) * 1_000,
    retryMaxMs: boundedInteger(
      env.ULIQ_AUTO_FINALIZER_MAX_RETRY_SECONDS,
      DEFAULT_MAX_RETRY_SECONDS,
      30,
      86_400,
      "max_retry_seconds"
    ) * 1_000,
    submissionStaleMs: boundedInteger(
      env.ULIQ_AUTO_FINALIZER_SUBMISSION_STALE_SECONDS,
      DEFAULT_SUBMISSION_STALE_SECONDS,
      60,
      86_400,
      "submission_stale_seconds"
    ) * 1_000
  };
}

function normalizePrivateKey(value: string | undefined): `0x${string}` {
  const raw = String(value ?? "").trim();
  if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(raw)) throw new Error("uliq_auto_finalizer_private_key_invalid");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function actionKey(config: UliqRuntimeConfig, purchaseId: bigint): string {
  return `uliq:finalize:${config.chainId}:${config.contracts.presale.toLowerCase()}:${purchaseId}`;
}

function retryDelayMs(attemptCount: number, settings: UliqAutoFinalizerSettings): number {
  const exponent = Math.max(0, Math.min(16, attemptCount - 1));
  return Math.min(settings.retryMaxMs, settings.retryBaseMs * (2 ** exponent));
}

function parseMetadataDate(metadata: Record<string, unknown>, key: string): Date | null {
  const value = String(metadata[key] ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function isReceiptNotFound(error: unknown): boolean {
  return /transaction receipt.*not found|could not be found|receipt.*not found/i.test(String(error ?? ""));
}

export function createDefaultUliqAutoFinalizerChain(
  config: UliqRuntimeConfig,
  rpc: UliqRpcPair = createUliqRpcPair(config),
  privateKey: `0x${string}` = normalizePrivateKey(process.env.ULIQ_FINALIZER_PRIVATE_KEY)
): UliqAutoFinalizerChain {
  const account = privateKeyToAccount(privateKey);
  const chain = defineChain({
    id: config.chainId,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.primaryRpcUrl] } }
  });
  const publicClient = createPublicClient({ chain, transport: http(config.primaryRpcUrl, { timeout: 15_000 }) });
  const walletClient = createWalletClient({ account, chain, transport: http(config.primaryRpcUrl, { timeout: 15_000 }) });
  let rpcPairVerified = false;

  async function ensureRpcPair(): Promise<void> {
    if (rpcPairVerified) return;
    await assertUliqRpcPair(config, rpc);
    rpcPairVerified = true;
  }

  async function readPurchaseAt(purchaseId: bigint, blockNumber?: bigint): Promise<OnchainPurchase> {
    const read = await withUliqRpcFailover(rpc, (client) => client.readContract({
      address: config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "purchases",
      args: [purchaseId],
      ...(blockNumber == null ? {} : { blockNumber })
    }));
    const [buyer, usdcAmountRaw, uliqAllocationRaw, purchasedAt, withdrawalDeadline, state] = read.value;
    return {
      buyer,
      usdcAmountRaw,
      uliqAllocationRaw,
      purchasedAt: BigInt(purchasedAt),
      withdrawalDeadline: BigInt(withdrawalDeadline),
      state: Number(state)
    };
  }

  return {
    accountAddress: account.address,
    async getFinalizedHead() {
      await ensureRpcPair();
      return getConsistentFinalizedBlock(rpc);
    },
    async readPurchase(blockNumber, purchaseId) {
      return readPurchaseAt(purchaseId, blockNumber);
    },
    async readLatestPurchase(purchaseId) {
      return readPurchaseAt(purchaseId);
    },
    async simulateFinalize(blockNumber, purchaseId) {
      await publicClient.simulateContract({
        account,
        address: config.contracts.presale,
        abi: uliqPresaleAbi,
        functionName: "finalizePurchase",
        args: [purchaseId],
        blockNumber
      });
    },
    async sendFinalize(purchaseId) {
      return sendSerializedControllerTransaction({ account, chain, publicClient, walletClient }, {
        to: config.contracts.presale,
        data: encodeFunctionData({
          abi: uliqPresaleAbi,
          functionName: "finalizePurchase",
          args: [purchaseId]
        })
      });
    },
    async getReceipt(txHash) {
      const readReceipt = async (client: typeof rpc.primary): Promise<FinalizationReceipt | null> => {
        try {
          const receipt = await client.getTransactionReceipt({ hash: txHash });
          return {
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash
          };
        } catch (error) {
          if (isReceiptNotFound(error)) return null;
          throw error;
        }
      };
      const primary = await readReceipt(rpc.primary);
      if (primary) return primary;
      return readReceipt(rpc.secondary);
    },
    async verifyBlock(blockNumber, blockHash) {
      const block = await getConsistentBlockAt(rpc, blockNumber);
      return block.hash.toLowerCase() === blockHash.toLowerCase();
    }
  };
}

export class UliqAutoFinalizerService {
  private readonly settings: UliqAutoFinalizerSettings;
  private readonly now: () => Date;
  private chain: UliqAutoFinalizerChain | null;

  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    deps: UliqAutoFinalizerDeps = {}
  ) {
    this.settings = deps.settings ?? getUliqAutoFinalizerSettings();
    this.chain = deps.chain ?? null;
    this.now = deps.now ?? (() => new Date());
  }

  private getChain(): UliqAutoFinalizerChain {
    return this.chain ??= createDefaultUliqAutoFinalizerChain(this.config);
  }

  private async ensureAction(purchase: any): Promise<any> {
    const purchaseId = BigInt(String(purchase.purchaseIdOnchain));
    const key = actionKey(this.config, purchaseId);
    const dataHex = encodeFunctionData({
      abi: uliqPresaleAbi,
      functionName: "finalizePurchase",
      args: [purchaseId]
    });
    return this.db.onchainAction.upsert({
      where: { actionKey: key },
      create: {
        actionKey: key,
        actionType: ACTION_TYPE,
        status: "prepared",
        userId: purchase.userId ?? null,
        chainId: this.config.chainId,
        toAddress: this.config.contracts.presale.toLowerCase(),
        dataHex,
        valueWei: "0",
        metadata: {
          purchaseId: purchaseId.toString(),
          buyerAddress: String(purchase.buyerAddress).toLowerCase(),
          withdrawalDeadline: purchase.withdrawalDeadline instanceof Date
            ? purchase.withdrawalDeadline.toISOString()
            : new Date(purchase.withdrawalDeadline).toISOString(),
          attemptCount: 0
        }
      },
      update: {}
    });
  }

  private actionMatches(action: any, purchaseId: bigint): boolean {
    const expectedData = encodeFunctionData({
      abi: uliqPresaleAbi,
      functionName: "finalizePurchase",
      args: [purchaseId]
    }).toLowerCase();
    return String(action.actionType) === ACTION_TYPE
      && Number(action.chainId) === this.config.chainId
      && String(action.toAddress).toLowerCase() === this.config.contracts.presale.toLowerCase()
      && String(action.dataHex).toLowerCase() === expectedData
      && String(action.valueWei) === "0";
  }

  private purchaseMatches(row: any, purchase: OnchainPurchase): boolean {
    const deadlineSeconds = BigInt(Math.floor(new Date(row.withdrawalDeadline).getTime() / 1_000));
    return purchase.buyer.toLowerCase() === String(row.buyerAddress).toLowerCase()
      && purchase.usdcAmountRaw === BigInt(String(row.usdcAmountRaw))
      && purchase.uliqAllocationRaw === BigInt(String(row.uliqAllocationRaw))
      && purchase.withdrawalDeadline === deadlineSeconds;
  }

  private async markRetryable(action: any, error: unknown): Promise<void> {
    const now = this.now();
    const metadata = asRecord(action.metadata);
    const attemptCount = Number(metadata.attemptCount ?? 0) + 1;
    const reason = errorMessage(error);
    const nextRetryAt = new Date(now.getTime() + retryDelayMs(attemptCount, this.settings));
    await this.db.onchainAction.update({
      where: { id: action.id },
      data: {
        status: "retryable",
        txHash: null,
        metadata: {
          ...metadata,
          attemptCount,
          lastError: reason,
          lastErrorAt: now.toISOString(),
          nextRetryAt: nextRetryAt.toISOString()
        }
      }
    });
    logger.warn("uliq_auto_finalizer_retry_scheduled", {
      actionId: String(action.id),
      purchaseId: String(metadata.purchaseId ?? ""),
      attemptCount,
      nextRetryAt: nextRetryAt.toISOString(),
      reason
    });
  }

  private async markObservedState(action: any, state: number, head: FinalizedHead): Promise<boolean> {
    const metadata = asRecord(action.metadata);
    if (state === 2) {
      await this.db.onchainAction.update({
        where: { id: action.id },
        data: {
          status: "confirmed",
          metadata: {
            ...metadata,
            confirmedAt: this.now().toISOString(),
            confirmedBy: "finalized_state",
            confirmedBlockNumber: head.number.toString(),
            confirmedBlockHash: head.hash
          }
        }
      });
      return true;
    }
    if (state === 1) {
      await this.db.onchainAction.update({
        where: { id: action.id },
        data: {
          status: "cancelled",
          metadata: {
            ...metadata,
            cancelledAt: this.now().toISOString(),
            cancelledReason: "purchase_withdrawn"
          }
        }
      });
      return true;
    }
    return false;
  }

  private async reconcileOutstanding(head: FinalizedHead): Promise<{ confirmed: number; retryable: number }> {
    const chain = this.getChain();
    const now = this.now();
    const actions = await this.db.onchainAction.findMany({
      where: {
        actionType: ACTION_TYPE,
        chainId: this.config.chainId,
        toAddress: this.config.contracts.presale.toLowerCase(),
        status: { in: ["submitting", "submitted"] }
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(this.settings.batchSize * 4, 20)
    });
    let confirmed = 0;
    let retryable = 0;

    for (const action of actions) {
      const metadata = asRecord(action.metadata);
      const purchaseIdRaw = String(metadata.purchaseId ?? "");
      if (!/^\d+$/.test(purchaseIdRaw)) {
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: { status: "review_required", metadata: { ...metadata, lastError: "purchase_id_missing" } }
        });
        continue;
      }
      const purchaseId = BigInt(purchaseIdRaw);
      const onchain = await chain.readPurchase(head.number, purchaseId);
      if (await this.markObservedState(action, onchain.state, head)) {
        confirmed += onchain.state === 2 ? 1 : 0;
        continue;
      }

      if (String(action.status) === "submitting" && !action.txHash) {
        const stale = now.getTime() - new Date(action.updatedAt).getTime() >= this.settings.submissionStaleMs;
        if (stale) {
          const latestPurchase = await chain.readLatestPurchase(purchaseId);
          if (latestPurchase.state !== 0) continue;
          await this.markRetryable(action, new Error("submission_result_unknown"));
          retryable += 1;
        }
        continue;
      }

      const txHash = String(action.txHash ?? "") as `0x${string}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: { status: "review_required", metadata: { ...metadata, lastError: "transaction_hash_invalid" } }
        });
        continue;
      }
      const receipt = await chain.getReceipt(txHash);
      if (!receipt) {
        const submittedAt = parseMetadataDate(metadata, "submittedAt") ?? new Date(action.updatedAt);
        if (now.getTime() - submittedAt.getTime() >= this.settings.submissionStaleMs) {
          const latestPurchase = await chain.readLatestPurchase(purchaseId);
          if (latestPurchase.state !== 0) continue;
          await this.markRetryable(action, new Error("submitted_transaction_not_found"));
          retryable += 1;
        }
        continue;
      }
      if (receipt.status === "reverted") {
        await this.markRetryable(action, new Error("finalize_transaction_reverted"));
        retryable += 1;
        continue;
      }
      if (receipt.blockNumber > head.number) continue;
      if (!await chain.verifyBlock(receipt.blockNumber, receipt.blockHash)) {
        await this.markRetryable(action, new Error("finalize_receipt_block_mismatch"));
        retryable += 1;
        continue;
      }
      const finalizedPurchase = await chain.readPurchase(head.number, purchaseId);
      if (finalizedPurchase.state !== 2) {
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: {
            status: "review_required",
            metadata: { ...metadata, lastError: "receipt_success_without_finalized_purchase_state" }
          }
        });
        continue;
      }
      await this.markObservedState(action, finalizedPurchase.state, head);
      confirmed += 1;
    }
    return { confirmed, retryable };
  }

  async runOnce(): Promise<Record<string, unknown>> {
    if (!this.settings.enabled) return { enabled: false };
    const chain = this.getChain();
    const head = await chain.getFinalizedHead();
    const reconciliation = await this.reconcileOutstanding(head);
    const cutoff = new Date(Number(head.timestamp) * 1_000);
    const candidates = await this.db.uliqPresalePurchase.findMany({
      where: {
        chainId: this.config.chainId,
        presaleContractAddress: this.config.contracts.presale.toLowerCase(),
        status: "PENDING_WITHDRAWAL",
        withdrawalDeadline: { lt: cutoff }
      },
      orderBy: [{ withdrawalDeadline: "asc" }, { purchaseBlockNumber: "asc" }, { logIndex: "asc" }],
      take: this.settings.batchSize
    });
    let submitted = 0;
    let alreadyFinalized = 0;
    let skipped = 0;

    for (const row of candidates) {
      const purchaseId = BigInt(String(row.purchaseIdOnchain));
      let action = await this.ensureAction(row);
      if (!this.actionMatches(action, purchaseId)) {
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: {
            status: "review_required",
            metadata: { ...asRecord(action.metadata), lastError: "action_payload_mismatch" }
          }
        });
        skipped += 1;
        continue;
      }
      const metadata = asRecord(action.metadata);
      if (["confirmed", "cancelled", "review_required", "submitting", "submitted"].includes(String(action.status))) {
        skipped += 1;
        continue;
      }
      if (String(action.status) === "retryable") {
        const nextRetryAt = parseMetadataDate(metadata, "nextRetryAt");
        if (nextRetryAt && nextRetryAt > this.now()) {
          skipped += 1;
          continue;
        }
      }

      const onchain = await chain.readPurchase(head.number, purchaseId);
      if (!this.purchaseMatches(row, onchain)) {
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: {
            status: "review_required",
            metadata: { ...metadata, lastError: "purchase_projection_mismatch" }
          }
        });
        logger.error("uliq_auto_finalizer_purchase_projection_mismatch", {
          actionId: String(action.id),
          purchaseId: purchaseId.toString(),
          finalizedBlockNumber: head.number.toString()
        });
        skipped += 1;
        continue;
      }
      if (await this.markObservedState(action, onchain.state, head)) {
        alreadyFinalized += onchain.state === 2 ? 1 : 0;
        continue;
      }
      if (onchain.state !== 0 || head.timestamp <= onchain.withdrawalDeadline) {
        skipped += 1;
        continue;
      }

      const claim = await this.db.onchainAction.updateMany({
        where: { id: action.id, status: action.status },
        data: {
          status: "submitting",
          metadata: {
            ...metadata,
            finalizerAddress: chain.accountAddress.toLowerCase(),
            finalizedEligibilityBlockNumber: head.number.toString(),
            finalizedEligibilityBlockHash: head.hash,
            finalizedEligibilityTimestamp: head.timestamp.toString(),
            submissionStartedAt: this.now().toISOString()
          }
        }
      });
      if (Number(claim.count) !== 1) {
        skipped += 1;
        continue;
      }
      action = await this.db.onchainAction.findUnique({ where: { id: action.id } });
      let submittedTxHash: `0x${string}` | null = null;
      try {
        await chain.simulateFinalize(head.number, purchaseId);
        const txHash = await chain.sendFinalize(purchaseId);
        submittedTxHash = txHash;
        const submittedAt = this.now();
        await this.db.onchainAction.update({
          where: { id: action.id },
          data: {
            status: "submitted",
            txHash: txHash.toLowerCase(),
            metadata: {
              ...asRecord(action.metadata),
              finalizerAddress: chain.accountAddress.toLowerCase(),
              submittedAt: submittedAt.toISOString(),
              transactionHash: txHash.toLowerCase()
            }
          }
        });
        logger.info("uliq_auto_finalizer_submitted", {
          actionId: String(action.id),
          purchaseId: purchaseId.toString(),
          transactionHash: txHash.toLowerCase(),
          finalizedEligibilityBlockNumber: head.number.toString()
        });
        submitted += 1;
      } catch (error) {
        if (submittedTxHash) {
          logger.error("uliq_auto_finalizer_submission_persistence_failed", {
            actionId: String(action.id),
            purchaseId: purchaseId.toString(),
            transactionHash: submittedTxHash.toLowerCase(),
            reason: errorMessage(error)
          });
          // Keep the action in `submitting`. Reconciliation observes the finalized
          // purchase state even if persisting the returned transaction hash failed.
          continue;
        }
        await this.markRetryable(action, error);
      }
    }

    return {
      enabled: true,
      finalizerAddress: chain.accountAddress,
      finalizedBlockNumber: head.number.toString(),
      finalizedBlockHash: head.hash,
      finalizedTimestamp: head.timestamp.toString(),
      candidates: candidates.length,
      submitted,
      alreadyFinalized,
      skipped,
      reconciledConfirmed: reconciliation.confirmed,
      reconciledRetryable: reconciliation.retryable
    };
  }
}

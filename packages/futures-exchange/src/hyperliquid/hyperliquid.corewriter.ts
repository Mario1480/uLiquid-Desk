import crypto from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  CancelOrderResult,
  FundsTransferResult,
  PlaceOrderResult
} from "../futures-exchange.interface.js";

const botVaultCoreWriterAbi = parseAbi([
  "function depositUsdcToHyperCore(uint256 amount)",
  "function sendHyperCoreSpot(address destination, uint64 token, uint64 weiAmount)",
  "function placeHyperCoreLimitOrder(uint32 asset, bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint8 encodedTif, uint128 cloid)",
  "function cancelHyperCoreOrderByOid(uint32 asset, uint64 oid)",
  "function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid)",
  "function sendUsdClassTransfer(uint64 ntl, bool toPerp)"
]);

const UINT64_MAX = (1n << 64n) - 1n;

function toScaledUint64(value: number, label: string): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`hyperliquid_corewriter_invalid_${label}`);
  }
  const scaled = Math.round(value * 1e8);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error(`hyperliquid_corewriter_invalid_${label}`);
  }
  return BigInt(scaled);
}

function toUsdClassAmount(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("hyperliquid_corewriter_invalid_usd_class_amount");
  }
  const scaled = Math.round(value * 1e6);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error("hyperliquid_corewriter_invalid_usd_class_amount");
  }
  return BigInt(scaled);
}

function toUsdcAtomicAmount(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("hyperliquid_corewriter_invalid_usdc_amount");
  }
  const scaled = Math.round(value * 1e6);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error("hyperliquid_corewriter_invalid_usdc_amount");
  }
  return BigInt(scaled);
}

function toUint64(value: bigint, label: string, options?: { allowZero?: boolean }): bigint {
  const min = options?.allowZero ? 0n : 1n;
  if (value < min || value > UINT64_MAX) {
    throw new Error(`hyperliquid_corewriter_invalid_${label}`);
  }
  return value;
}

function encodeCloidFromClientOrderId(value: string): bigint {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error("hyperliquid_corewriter_client_oid_required");
  const hex = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return BigInt(`0x${hex}`);
}

function normalizeHexQuantity(value: bigint): string {
  return value.toString(10);
}

export function buildCoreWriterOrderId(asset: number, cloid: bigint): string {
  return `cloid:${Math.max(0, Math.trunc(asset))}:${normalizeHexQuantity(cloid)}`;
}

export function parseCoreWriterOrderId(orderId: string): { asset: number; cloid: bigint } | null {
  const raw = String(orderId ?? "").trim();
  const match = /^(?:cloid|corewriter):(\d+):(\d+)$/.exec(raw);
  if (!match) return null;
  const asset = Number(match[1]);
  if (!Number.isFinite(asset) || asset < 0) return null;
  try {
    return {
      asset,
      cloid: BigInt(match[2]!)
    };
  } catch {
    return null;
  }
}

export type HyperliquidCoreWriterClientInput = {
  privateKey: `0x${string}`;
  botVaultAddress: `0x${string}`;
  rpcUrl: string;
  chainId: number;
  sendTransaction?: (input: { to: `0x${string}`; data: Hex; gas?: bigint; nonce?: number }) => Promise<`0x${string}`>;
  getTransactionCount?: (input?: { blockTag?: "latest" | "pending" }) => Promise<number>;
  estimateGas?: (input: { to: `0x${string}`; data: Hex }) => Promise<bigint>;
  gasLimit?: bigint;
  waitForTransactionReceipt?: (input: { hash: `0x${string}` }) => Promise<{ status?: "success" | "reverted" | string }>;
};

type SubmittedTransactionResult =
  | {
      ok: true;
      txHash: `0x${string}`;
    }
  | {
      ok: false;
      error: string;
    };

function isReceiptTimeoutLikeError(error: unknown): boolean {
  return /timeout|timed out|abort|aborted|receipt|confirm/i.test(String(error ?? ""));
}

function buildFailedActionResult(params: {
  txHash?: `0x${string}`;
  confirmationSource?: "receipt" | "none";
  receiptStatus?: "unknown" | "reverted";
  errorCode: string;
  errorMessage: string;
}): {
  status: "failed";
  submitted: boolean;
  confirmationSource: "receipt" | "none";
  receiptStatus: "unknown" | "reverted";
  txHash?: `0x${string}`;
  errorCode: string;
  errorMessage: string;
} {
  return {
    status: "failed",
    submitted: typeof params.txHash === "string" && params.txHash.length > 0,
    confirmationSource: params.confirmationSource ?? "none",
    receiptStatus: params.receiptStatus ?? (params.errorCode === "tx_reverted" ? "reverted" : "unknown"),
    txHash: params.txHash,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage
  };
}

function buildPendingTimeoutResult(params: {
  txHash: `0x${string}`;
  errorCode: string;
  errorMessage: string;
}): {
  status: "pending_timeout";
  submitted: true;
  confirmationSource: "none";
  receiptStatus: "unknown";
  txHash: `0x${string}`;
  errorCode: string;
  errorMessage: string;
} {
  return {
    status: "pending_timeout",
    submitted: true,
    confirmationSource: "none",
    receiptStatus: "unknown",
    txHash: params.txHash,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage
  };
}

export type HyperliquidCoreWriterPlaceOrderResult = PlaceOrderResult;
export type HyperliquidCoreWriterCancelResult = CancelOrderResult;
export type HyperliquidCoreWriterTransferResult = FundsTransferResult;

type NonceState = {
  tail: Promise<void>;
  nextNonce: number | null;
};

// Nonces are scoped to the signer account on a chain, not to a specific bot vault.
// Multiple vaults can share the same controller wallet and therefore must serialize
// through a shared nonce lane.
const nonceStateByKey = new Map<string, NonceState>();

function getNonceState(key: string): NonceState {
  let state = nonceStateByKey.get(key);
  if (state) return state;
  state = {
    tail: Promise.resolve(),
    nextNonce: null
  };
  nonceStateByKey.set(key, state);
  return state;
}

async function withNonceLock<T>(key: string, fn: (state: NonceState) => Promise<T>): Promise<T> {
  const state = getNonceState(key);
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await fn(state);
  } finally {
    release();
  }
}

function isNonceTooLowError(error: unknown): boolean {
  return /nonce too low|nonce provided for the transaction is lower than the current nonce of the account/i.test(
    String(error ?? "")
  );
}

function isNonceSyncError(error: unknown): boolean {
  const message = String(error ?? "");
  return (
    isNonceTooLowError(error)
    || /nonce too high|already known|known transaction|replacement transaction underpriced|transaction underpriced/i.test(message)
  );
}

function isRateLimitedError(error: unknown): boolean {
  return /rate limited|limitexceededrpcerror|request exceeds defined limit|429|too many requests/i.test(String(error ?? ""));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnRateLimit<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitedError(error) || attempt >= attempts - 1) {
        throw error;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "hyperliquid_corewriter_retry_failed"));
}

export class HyperliquidCoreWriterClient {
  private readonly sendTransactionImpl: (input: { to: `0x${string}`; data: Hex; gas?: bigint }) => Promise<`0x${string}`>;
  private readonly waitForTransactionReceiptImpl: ((input: { hash: `0x${string}` }) => Promise<{ status?: "success" | "reverted" | string }>) | null;

  constructor(private readonly input: HyperliquidCoreWriterClientInput) {
    if (typeof input.sendTransaction === "function" && typeof input.getTransactionCount !== "function") {
      this.sendTransactionImpl = input.sendTransaction;
      this.waitForTransactionReceiptImpl = typeof input.waitForTransactionReceipt === "function"
        ? input.waitForTransactionReceipt
        : null;
      return;
    }
    const account = privateKeyToAccount(input.privateKey);
    const chain = defineChain({
      id: input.chainId,
      name: input.chainId === 999 ? "HyperEVM" : `HyperEVM-${input.chainId}`,
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      rpcUrls: {
        default: {
          http: [input.rpcUrl]
        }
      }
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(input.rpcUrl)
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(input.rpcUrl)
    });
    this.waitForTransactionReceiptImpl = typeof input.waitForTransactionReceipt === "function"
      ? input.waitForTransactionReceipt
      : async ({ hash }) => publicClient.waitForTransactionReceipt({ hash });
    const nonceKey = `${chain.id}:${account.address.toLowerCase()}`;
    const getTransactionCount = typeof input.getTransactionCount === "function"
      ? (blockTag: "latest" | "pending" = "pending") => input.getTransactionCount?.({ blockTag }) as Promise<number>
      : (blockTag: "latest" | "pending" = "pending") => publicClient.getTransactionCount({
          address: account.address,
          blockTag
        });
    const sendTransaction = typeof input.sendTransaction === "function"
      ? input.sendTransaction
      : (request: { to: `0x${string}`; data: Hex; gas?: bigint; nonce?: number }) => walletClient.sendTransaction({
          account,
          to: request.to,
          data: request.data,
          gas: request.gas,
          nonce: request.nonce,
          chain
        });
    const estimateGas = typeof input.estimateGas === "function"
      ? input.estimateGas
      : (request: { to: `0x${string}`; data: Hex }) => publicClient.estimateGas({
          account,
          to: request.to,
          data: request.data
        });
    const shouldUseDeterministicInjectedGas =
      typeof input.sendTransaction === "function"
      && typeof input.estimateGas !== "function";
    this.sendTransactionImpl = async (request) => {
      const estimatedGas = request.gas
        ?? input.gasLimit
        ?? (shouldUseDeterministicInjectedGas
          ? 750_000n
          : await retryOnRateLimit(
              () => estimateGas({
                to: request.to,
                data: request.data
              }),
              3,
              500
            ).catch(() => 750_000n));
      const gas = estimatedGas + (estimatedGas / 5n) + 50_000n;
      return withNonceLock(nonceKey, async (state) => {
        if (state.nextNonce === null) {
          state.nextNonce = await retryOnRateLimit(() => getTransactionCount("pending"), 4, 600);
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const nonce = state.nextNonce;
          if (nonce === null) {
            throw new Error("hyperliquid_corewriter_nonce_unavailable");
          }
          try {
            const txHash = await retryOnRateLimit(
              () => sendTransaction({
                to: request.to,
                data: request.data,
                gas,
                nonce
              }),
              4,
              750
            );
            state.nextNonce = nonce + 1;
            return txHash;
          } catch (error) {
            // Any ambiguous submission or nonce-sync failure invalidates the local cache so
            // the next sender re-anchors against the chain's pending nonce.
            state.nextNonce = null;
            if (isNonceSyncError(error) && attempt === 0) {
              state.nextNonce = await retryOnRateLimit(() => getTransactionCount("pending"), 4, 600);
              continue;
            }
            throw error;
          }
        }
        throw new Error("hyperliquid_corewriter_send_failed");
      });
    };
  }

  private async submitTransaction(input: {
    data: Hex;
  }): Promise<SubmittedTransactionResult> {
    try {
      const txHash = await this.sendTransactionImpl({
        to: this.input.botVaultAddress,
        data: input.data
      });
      return {
        ok: true,
        txHash
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error)
      };
    }
  }

  private async validateSubmittedTransaction(txHash: `0x${string}`): Promise<{
    status: "confirmed" | "failed" | "pending_timeout";
    submitted: boolean;
    confirmationSource: "receipt" | "none";
    receiptStatus: "success" | "reverted" | "unknown";
    txHash?: `0x${string}`;
    errorCode?: string;
    errorMessage?: string;
  }> {
    if (!this.waitForTransactionReceiptImpl) {
      return buildPendingTimeoutResult({
        txHash,
        errorCode: "receipt_validation_unavailable",
        errorMessage: "hyperliquid_corewriter_receipt_validation_unavailable"
      });
    }
    try {
      const receipt = await retryOnRateLimit(() => this.waitForTransactionReceiptImpl!({ hash: txHash }), 4, 750);
      const status = String(receipt?.status ?? "").trim().toLowerCase();
      if (status === "success") {
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash
        };
      }
      if (status === "reverted") {
        return buildFailedActionResult({
          txHash,
          confirmationSource: "receipt",
          receiptStatus: "reverted",
          errorCode: "tx_reverted",
          errorMessage: `hyperliquid_corewriter_tx_reverted:${txHash}`
        });
      }
      return buildPendingTimeoutResult({
        txHash,
        errorCode: "receipt_unconfirmed",
        errorMessage: `hyperliquid_corewriter_receipt_unconfirmed:${txHash}`
      });
    } catch (error) {
      const message = String(error);
      if (isReceiptTimeoutLikeError(error)) {
        return buildPendingTimeoutResult({
          txHash,
          errorCode: "receipt_timeout",
          errorMessage: message
        });
      }
      return buildPendingTimeoutResult({
        txHash,
        errorCode: "receipt_pending_unknown",
        errorMessage: message
      });
    }
  }

  async placeLimitOrder(input: {
    asset: number;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    encodedTif: 1 | 2;
    clientOrderId: string;
  }): Promise<HyperliquidCoreWriterPlaceOrderResult> {
    const cloid = encodeCloidFromClientOrderId(input.clientOrderId);
    const candidateOrderId = buildCoreWriterOrderId(input.asset, cloid);
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "placeHyperCoreLimitOrder",
      args: [
        Math.max(0, Math.trunc(input.asset)),
        input.isBuy,
        toScaledUint64(input.limitPx, "price"),
        toScaledUint64(input.sz, "size"),
        input.reduceOnly === true,
        input.encodedTif,
        cloid
      ]
    });
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return {
        candidateOrderId,
        clientOrderId: input.clientOrderId,
        ...buildFailedActionResult({
          errorCode: "submission_failed",
          errorMessage: submitted.error
        })
      };
    }
    const receiptResult = await this.validateSubmittedTransaction(submitted.txHash);
    if (receiptResult.status !== "confirmed") {
      return {
        candidateOrderId,
        clientOrderId: input.clientOrderId,
        ...receiptResult
      };
    }
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "receipt",
      receiptStatus: "success",
      orderId: candidateOrderId,
      candidateOrderId,
      clientOrderId: input.clientOrderId,
      txHash: submitted.txHash
    };
  }

  async cancelByCloid(input: {
    asset: number;
    cloid: bigint;
  }): Promise<HyperliquidCoreWriterCancelResult> {
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "cancelHyperCoreOrderByCloid",
      args: [Math.max(0, Math.trunc(input.asset)), input.cloid]
    });
    const orderId = buildCoreWriterOrderId(input.asset, input.cloid);
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return {
        orderId,
        clientOrderId: normalizeHexQuantity(input.cloid),
        ...buildFailedActionResult({
          errorCode: "submission_failed",
          errorMessage: submitted.error
        })
      };
    }
    return {
      orderId,
      clientOrderId: normalizeHexQuantity(input.cloid),
      ...(await this.validateSubmittedTransaction(submitted.txHash))
    };
  }

  async cancelByOid(input: {
    asset: number;
    oid: number;
  }): Promise<HyperliquidCoreWriterCancelResult> {
    const normalizedOid = Math.max(0, Math.trunc(Number(input.oid)));
    if (!Number.isFinite(normalizedOid) || normalizedOid <= 0) {
      throw new Error("hyperliquid_corewriter_invalid_oid");
    }
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "cancelHyperCoreOrderByOid",
      args: [Math.max(0, Math.trunc(input.asset)), BigInt(normalizedOid)]
    });
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return {
        orderId: String(normalizedOid),
        ...buildFailedActionResult({
          errorCode: "submission_failed",
          errorMessage: submitted.error
        })
      };
    }
    return {
      orderId: String(normalizedOid),
      ...(await this.validateSubmittedTransaction(submitted.txHash))
    };
  }

  async sendUsdClassTransfer(input: {
    amountUsd: number;
    toPerp: boolean;
  }): Promise<HyperliquidCoreWriterTransferResult> {
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "sendUsdClassTransfer",
      args: [toUsdClassAmount(input.amountUsd), input.toPerp === true]
    });
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return {
        amountUsd: input.amountUsd,
        ...buildFailedActionResult({
          errorCode: "submission_failed",
          errorMessage: submitted.error
        })
      };
    }
    return {
      amountUsd: input.amountUsd,
      ...(await this.validateSubmittedTransaction(submitted.txHash))
    };
  }

  async depositUsdcToHyperCore(input: {
    amountUsd: number;
  }): Promise<HyperliquidCoreWriterTransferResult> {
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "depositUsdcToHyperCore",
      args: [toUsdcAtomicAmount(input.amountUsd)]
    });
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return {
        amountUsd: input.amountUsd,
        ...buildFailedActionResult({
          errorCode: "submission_failed",
          errorMessage: submitted.error
        })
      };
    }
    return {
      amountUsd: input.amountUsd,
      ...(await this.validateSubmittedTransaction(submitted.txHash))
    };
  }

  async sendSpotAsset(input: {
    destination: `0x${string}`;
    token: number;
    weiAmount: bigint;
  }): Promise<HyperliquidCoreWriterTransferResult> {
    const normalizedToken = Math.max(0, Math.trunc(Number(input.token)));
    if (!Number.isFinite(normalizedToken)) {
      throw new Error("hyperliquid_corewriter_invalid_spot_token");
    }
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "sendHyperCoreSpot",
      args: [
        input.destination,
        toUint64(BigInt(normalizedToken), "spot_token", { allowZero: true }),
        toUint64(input.weiAmount, "spot_amount")
      ]
    });
    const submitted = await this.submitTransaction({ data });
    if (!submitted.ok) {
      return buildFailedActionResult({
        errorCode: "submission_failed",
        errorMessage: submitted.error
      });
    }
    return this.validateSubmittedTransaction(submitted.txHash);
  }
}

import crypto from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const botVaultCoreWriterAbi = parseAbi([
  "function placeHyperCoreLimitOrder(uint32 asset, bool isBuy, uint64 limitPx, uint64 sz, bool reduceOnly, uint8 encodedTif, uint128 cloid)",
  "function cancelHyperCoreOrderByOid(uint32 asset, uint64 oid)",
  "function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid)",
  "function sendUsdClassTransfer(uint64 ntl, bool toPerp)"
]);

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
  const match = /^cloid:(\d+):(\d+)$/.exec(raw);
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
  waitForTransactionReceipt?: (input: { hash: `0x${string}` }) => Promise<{ status?: "success" | "reverted" | string }>;
};

type NonceState = {
  tail: Promise<void>;
  nextNonce: number | null;
};

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
    this.sendTransactionImpl = async (request) => {
      const estimatedGas = request.gas ?? await publicClient.estimateGas({
        account,
        to: request.to,
        data: request.data
      }).catch(() => 750_000n);
      const gas = estimatedGas + (estimatedGas / 5n) + 50_000n;
      return withNonceLock(nonceKey, async (state) => {
        if (state.nextNonce === null) {
          state.nextNonce = await getTransactionCount("pending");
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const nonce = state.nextNonce;
          if (nonce === null) {
            throw new Error("hyperliquid_corewriter_nonce_unavailable");
          }
          try {
            const txHash = await sendTransaction({
              to: request.to,
              data: request.data,
              gas,
              nonce
            });
            state.nextNonce = nonce + 1;
            return txHash;
          } catch (error) {
            if (isNonceTooLowError(error) && attempt === 0) {
              state.nextNonce = await getTransactionCount("pending");
              continue;
            }
            throw error;
          }
        }
        throw new Error("hyperliquid_corewriter_send_failed");
      });
    };
  }

  async placeLimitOrder(input: {
    asset: number;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    encodedTif: 1 | 2 | 3;
    clientOrderId: string;
  }): Promise<{ orderId: string; txHash: `0x${string}` }> {
    const cloid = encodeCloidFromClientOrderId(input.clientOrderId);
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
    const txHash = await this.sendTransactionImpl({
      to: this.input.botVaultAddress,
      data
    });
    if (this.waitForTransactionReceiptImpl) {
      const receipt = await this.waitForTransactionReceiptImpl({ hash: txHash });
      const status = String(receipt?.status ?? "").trim().toLowerCase();
      if (status && status !== "success") {
        throw new Error(`hyperliquid_corewriter_tx_reverted:${txHash}`);
      }
    }
    return {
      orderId: buildCoreWriterOrderId(input.asset, cloid),
      txHash
    };
  }

  async cancelByCloid(input: {
    asset: number;
    cloid: bigint;
  }): Promise<{ txHash: `0x${string}` }> {
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "cancelHyperCoreOrderByCloid",
      args: [Math.max(0, Math.trunc(input.asset)), input.cloid]
    });
    const txHash = await this.sendTransactionImpl({
      to: this.input.botVaultAddress,
      data
    });
    return { txHash };
  }

  async sendUsdClassTransfer(input: {
    amountUsd: number;
    toPerp: boolean;
  }): Promise<{ txHash: `0x${string}` }> {
    const data = encodeFunctionData({
      abi: botVaultCoreWriterAbi,
      functionName: "sendUsdClassTransfer",
      args: [toUsdClassAmount(input.amountUsd), input.toPerp === true]
    });
    const txHash = await this.sendTransactionImpl({
      to: this.input.botVaultAddress,
      data
    });
    if (this.waitForTransactionReceiptImpl) {
      const receipt = await this.waitForTransactionReceiptImpl({ hash: txHash });
      const status = String(receipt?.status ?? "").trim().toLowerCase();
      if (status && status !== "success") {
        throw new Error(`hyperliquid_corewriter_tx_reverted:${txHash}`);
      }
    }
    return { txHash };
  }
}

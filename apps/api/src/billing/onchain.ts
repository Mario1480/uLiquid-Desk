import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
  isAddress,
  parseAbiItem,
  type Hex
} from "viem";

export const ARBITRUM_ONE_CHAIN_ID = 42_161;
export const ARBITRUM_USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
export const ARBITRUM_USDC_DECIMALS = 6;
export const BILLING_PAYMENT_CONFIRMATIONS = 12;
export const ARBITRUM_EXPLORER_URL = "https://arbiscan.io";

export const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
export const ERC20_DECIMALS_FUNCTION = parseAbiItem(
  "function decimals() view returns (uint8)"
);

export type BillingOnchainClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBytecode(params: { address: Hex }): Promise<Hex | undefined>;
  readContract(params: Record<string, unknown>): Promise<unknown>;
  getTransaction(params: { hash: Hex }): Promise<{
    from: string;
    to: string | null;
    value?: bigint;
  }>;
  getTransactionReceipt(params: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    blockHash: string;
    logs: Array<{
      address: string;
      data: Hex;
      topics: readonly Hex[];
      transactionHash?: string | null;
      blockNumber?: bigint | null;
      blockHash?: string | null;
    }>;
  }>;
  getLogs(params: Record<string, unknown>): Promise<any[]>;
};

export type BillingPaymentVerification =
  | {
      kind: "confirmed" | "confirming";
      confirmations: number;
      blockNumber: bigint;
      blockHash: string;
    }
  | {
      kind: "review_required";
      reason:
        | "wrong_chain"
        | "transaction_reverted"
        | "missing_checkout_block"
        | "transaction_before_checkout"
        | "sender_treasury_conflict"
        | "sender_mismatch"
        | "wrong_token"
        | "unexpected_native_value"
        | "transfer_not_found"
        | "amount_mismatch"
        | "ambiguous_transfers";
      confirmations: number;
      blockNumber: bigint | null;
      blockHash: string | null;
    }
  | {
      kind: "retry";
      reason: string;
    };

function normalizeAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return isAddress(raw) ? raw.toLowerCase() : null;
}

function clampConfirmations(value: bigint): number {
  if (value <= 0n) return 0;
  return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
}

function isTransactionNotFoundError(error: unknown): boolean {
  const name = String((error as any)?.name ?? "").toLowerCase();
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    name.includes("notfound")
    || message.includes("not found")
    || message.includes("could not be found")
  );
}

export function normalizeBillingAddress(value: unknown, errorCode = "invalid_wallet_address"): string {
  const normalized = normalizeAddress(value);
  if (!normalized || normalized === "0x0000000000000000000000000000000000000000") {
    throw new Error(errorCode);
  }
  return normalized;
}

export function normalizeBillingTreasuryAddress(value: unknown): string {
  const normalized = normalizeBillingAddress(value, "invalid_treasury_address");
  if (normalized === ARBITRUM_USDC_ADDRESS.toLowerCase()) {
    throw new Error("invalid_treasury_address");
  }
  return normalized;
}

export function normalizeBillingTxHash(value: unknown): Hex {
  const raw = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error("invalid_transaction_hash");
  return raw.toLowerCase() as Hex;
}

export function getBillingArbitrumRpcUrl(): string {
  return String(
    process.env.BILLING_ARBITRUM_RPC_URL
    ?? process.env.ARBITRUM_RPC_URL
    ?? ""
  ).trim();
}

export function createBillingOnchainClient(rpcUrl = getBillingArbitrumRpcUrl()): BillingOnchainClient {
  if (!rpcUrl) throw new Error("billing_arbitrum_rpc_not_configured");
  const chain = defineChain({
    id: ARBITRUM_ONE_CHAIN_ID,
    name: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arbiscan", url: ARBITRUM_EXPLORER_URL } }
  });
  return createPublicClient({ chain, transport: http(rpcUrl) }) as unknown as BillingOnchainClient;
}

export async function verifyArbitrumUsdcTransaction(params: {
  client: BillingOnchainClient;
  txHash: string;
  expectedSenderAddress: string;
  recipientAddress: string;
  expectedAmountRaw: bigint;
  minimumBlockNumber: bigint | null | undefined;
  tokenAddress?: string;
  confirmationsRequired?: number;
}): Promise<BillingPaymentVerification> {
  const hash = normalizeBillingTxHash(params.txHash);
  const expectedSender = normalizeBillingAddress(params.expectedSenderAddress);
  const recipient = normalizeBillingTreasuryAddress(params.recipientAddress);
  const tokenAddress = normalizeBillingAddress(
    params.tokenAddress ?? ARBITRUM_USDC_ADDRESS,
    "invalid_usdc_address"
  );
  const confirmationsRequired = Math.max(
    1,
    Math.trunc(params.confirmationsRequired ?? BILLING_PAYMENT_CONFIRMATIONS)
  );

  if (typeof params.minimumBlockNumber !== "bigint" || params.minimumBlockNumber < 0n) {
    return {
      kind: "review_required",
      reason: "missing_checkout_block",
      confirmations: 0,
      blockNumber: null,
      blockHash: null
    };
  }

  if (expectedSender === recipient) {
    return {
      kind: "review_required",
      reason: "sender_treasury_conflict",
      confirmations: 0,
      blockNumber: null,
      blockHash: null
    };
  }

  let chainId: number;
  let transaction: Awaited<ReturnType<BillingOnchainClient["getTransaction"]>>;
  let receipt: Awaited<ReturnType<BillingOnchainClient["getTransactionReceipt"]>>;
  let latestBlock: bigint;
  try {
    [chainId, transaction, receipt, latestBlock] = await Promise.all([
      params.client.getChainId(),
      params.client.getTransaction({ hash }),
      params.client.getTransactionReceipt({ hash }),
      params.client.getBlockNumber()
    ]);
  } catch (error) {
    const reason = isTransactionNotFoundError(error)
      ? "transaction_or_receipt_not_available"
      : `rpc_unavailable:${String((error as any)?.message ?? error).slice(0, 180)}`;
    return { kind: "retry", reason };
  }

  const blockNumber = receipt.blockNumber ?? null;
  const blockHash = receipt.blockHash ?? null;
  const confirmations = blockNumber == null
    ? 0
    : clampConfirmations(latestBlock >= blockNumber ? latestBlock - blockNumber + 1n : 0n);
  const review = (reason: Extract<BillingPaymentVerification, { kind: "review_required" }>["reason"])
  : BillingPaymentVerification => ({
    kind: "review_required",
    reason,
    confirmations,
    blockNumber,
    blockHash
  });

  if (chainId !== ARBITRUM_ONE_CHAIN_ID) return review("wrong_chain");
  if (receipt.status !== "success") return review("transaction_reverted");
  if (receipt.blockNumber < params.minimumBlockNumber) return review("transaction_before_checkout");
  if (normalizeAddress(transaction.from) !== expectedSender) return review("sender_mismatch");
  if (normalizeAddress(transaction.to) !== tokenAddress) return review("wrong_token");
  if ((transaction.value ?? 0n) !== 0n) return review("unexpected_native_value");

  const transfers: Array<{ from: string; to: string; value: bigint }> = [];
  for (const log of receipt.logs ?? []) {
    if (normalizeAddress(log.address) !== tokenAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: [ERC20_TRANSFER_EVENT],
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
        strict: true
      });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from?: string; to?: string; value?: bigint };
      const from = normalizeAddress(args.from);
      const to = normalizeAddress(args.to);
      if (!from || !to || typeof args.value !== "bigint") continue;
      transfers.push({ from, to, value: args.value });
    } catch {
      // Non-Transfer USDC logs are irrelevant to this direct-transfer payment.
    }
  }

  const recipientTransfers = transfers.filter(
    (transfer) => transfer.from === expectedSender && transfer.to === recipient
  );
  if (recipientTransfers.length === 0) return review("transfer_not_found");
  if (recipientTransfers.length > 1) return review("ambiguous_transfers");
  if (recipientTransfers[0]!.value !== params.expectedAmountRaw) return review("amount_mismatch");

  return {
    kind: confirmations >= confirmationsRequired ? "confirmed" : "confirming",
    confirmations,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash
  };
}

export function formatArbitrumUsdcAmount(amountRaw: bigint): string {
  const raw = amountRaw.toString().padStart(ARBITRUM_USDC_DECIMALS + 1, "0");
  const whole = raw.slice(0, -ARBITRUM_USDC_DECIMALS) || "0";
  const fraction = raw.slice(-ARBITRUM_USDC_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function getArbitrumTransactionExplorerUrl(txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  try {
    return `${ARBITRUM_EXPLORER_URL}/tx/${normalizeBillingTxHash(txHash)}`;
  } catch {
    return null;
  }
}

import crypto from "node:crypto";
import { HyperliquidCoreWriterClient } from "@mm/futures-exchange";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger as defaultLogger } from "../logger.js";
import { decryptSecret } from "../secret-crypto.js";
import { cancelAllOrders, closePositionsMarket, createPerpExecutionAdapter, type TradingAccount } from "../trading.js";
import { HyperliquidSpotClient, isHyperliquidSpotTestnet } from "../spot/hyperliquid-spot.client.js";
import { resolveWalletReadConfig } from "../wallet/config.js";
import { createApiAgentSecretProvider, type AgentSecretProvider as ApiAgentSecretProvider } from "./agentSecretProvider.js";
import { encryptSecret } from "../secret-crypto.js";
import { resolveHyperEvmWriteRpcUrl } from "./onchainAddressBook.js";
import { sendSerializedControllerTransaction } from "./controllerTransaction.js";
import { botVaultFactoryV3Abi, botVaultV3Abi } from "./onchainAbi.js";
import {
  ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";

export type AgentWalletSummary = {
  address: string | null;
  version: number;
  secretRef: string | null;
  hypeBalance: string | null;
  hypeBalanceWei: string | null;
  lowHypeThreshold: number;
  lowHypeState: "ok" | "low" | "unavailable";
  updatedAt: string | null;
  stale: boolean;
};

export type BotVaultV3Summary = {
  id: string;
  botId: string;
  userId: string;
  vaultModel: string;
  beneficiaryAddress: string | null;
  // Controller contract/operator address used to manage the BotVaultV3 lifecycle.
  controllerAddress: string | null;
  // Legacy alias for the BotVaultV3 contract address onchain.
  vaultAddress: string | null;
  // Canonical BotVaultV3 contract address onchain.
  onchainBotVaultAddress: string | null;
  // Address the strategy/execution agent signs with for Hyperliquid actions.
  agentWallet: string | null;
  // Explicit alias for the strategy/execution agent wallet address.
  agentWalletAddress: string | null;
  agentWalletVersion: number;
  agentSecretRef: string | null;
  allocatedUsd: number;
  availableUsd: number;
  withdrawnUsd: number;
  claimedProfitUsd: number;
  feePaidTotal: number;
  // EVM-side funding lifecycle.
  // `hyper_evm_funding_requested` means DB/onchain action intent only.
  // `hyper_evm_confirmed_onchain` means the BotVaultV3 `Funded` event or onchain snapshot confirmed vault funding.
  fundingStatus: string;
  // HyperCore-side lifecycle derived by backend orchestration, not by a dedicated CoreWriter confirmation event.
  // Today `pending` means EVM funding is confirmed and Core-side transfer/execution may still be outstanding.
  // `funded` is reserved for a future explicit confirmed-Core read path and is kept as a compatibility value.
  hypercoreFundingStatus: string;
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
  healthSummary: BotVaultV3HealthSummary;
  executionStatus: string | null;
  status: string;
  claimableProfitUsd: number;
  endedAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BotVaultV3ControllerCloseResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  closeOnlyTxHash: string | null;
  closeTxHash: string | null;
  onchainStatusBefore: string;
  onchainStatusAfterCloseOnly: string | null;
  principalToReturnAtomic: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
};

export type BotVaultV3ControllerRecoverClosedResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  recoverTxHash: string;
  principalToReturnAtomic: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
};

export type BotVaultV3ClaimProfitResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  claimTxHash: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
  principalPortionAtomic: string;
};

type BotVaultV3OnchainSnapshot = {
  status: string;
  principalAllocated: number;
  principalReturned: number;
  availableUsd: number;
  feePaidTotal: number;
};

export type BotVaultV3ActionFlags = {
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
};

export type BotVaultV3HealthSummary = {
  lifecycleStatus: string;
  fundingHealth: string;
  onchainStateKnown: boolean;
  actionState: string;
};

function readBotVaultV3AddressSemantics(row: any): {
  controllerAddress: string | null;
  vaultAddress: string | null;
  onchainBotVaultAddress: string | null;
  agentWallet: string | null;
  agentWalletAddress: string | null;
} {
  const controllerAddress = toNullableString(row?.controllerAddress);
  const onchainBotVaultAddress = toNullableString(row?.onchainBotVaultAddress ?? row?.vaultAddress);
  const agentWalletAddress = toNullableString(row?.agentWalletAddress ?? row?.agentWallet);
  return {
    controllerAddress,
    vaultAddress: onchainBotVaultAddress,
    onchainBotVaultAddress,
    agentWallet: agentWalletAddress,
    agentWalletAddress
  };
}

type CreateBotVaultV3ServiceDeps = {
  agentSecretProvider?: ApiAgentSecretProvider | null;
  buildControllerWalletClient?: ((expectedControllerAddress?: string | null) => {
    account: any;
    chain: any;
    publicClient: any;
    walletClient: any;
  }) | null;
  readHyperliquidClearinghouseState?: ((address: `0x${string}`) => Promise<HyperliquidClearinghouseState>) | null;
  readHyperliquidSpotAssetBalance?: ((address: `0x${string}`, asset: string) => Promise<string>) | null;
  readHyperliquidSpotUsdcBalance?: ((address: `0x${string}`) => Promise<string>) | null;
  createPerpExecutionAdapter?: ((account: TradingAccount) => any) | null;
  createVaultCoreWriter?: ((account: TradingAccount) => BotVaultV3ExitCoreWriter | null) | null;
  createVaultSpotClient?: ((account: TradingAccount) => BotVaultV3ExitSpotClient | null) | null;
  cancelAllOrders?: ((adapter: any, symbol?: string) => Promise<{ requested: number; cancelled: number; failed: number }>) | null;
  closePositionsMarket?: ((adapter: any, symbol: string, side?: "long" | "short") => Promise<string[]>) | null;
  decryptSecret?: ((value: string) => string) | null;
  sleep?: ((ms: number) => Promise<void>) | null;
  logger?: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  } | null;
};

type FundBotVaultParams = {
  userId: string;
  botId: string;
  amountUsd: number;
  moveToHyperCore?: boolean;
};

type ClaimProfitParams = {
  userId: string;
  botId: string;
  amountUsd?: number | null;
};

type PreviewClaimProfitParams = {
  userId: string;
  botId: string;
  amountUsd?: number | null;
};

type LoadClaimProfitQuoteParams = PreviewClaimProfitParams & {
  allowEmptyClaim?: boolean;
};

type ClaimProfitQuote = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  status: string;
  claimableProfitRaw: bigint;
  requestedAmountRaw: bigint;
  feeRatePctRaw: bigint;
  feeAmountRaw: bigint;
  treasuryRecipientRaw: `0x${string}` | null;
  excludedPrincipalUsd: number;
  usdcAddress: `0x${string}`;
  controllerClient: {
    account: any;
    chain: any;
    publicClient: any;
    walletClient: any;
  };
  evmUsdcBalanceRaw: bigint;
};

export type BotVaultV3ClaimProfitPreview = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  status: string;
  maxClaimableUsd: number;
  requestedAmountUsd: number;
  feeRatePct: number;
  feeAmountUsd: number;
  netAmountUsd: number;
  excludedPrincipalUsd: number;
  treasuryRecipient: string | null;
};

type FinalizeMarginAddParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
};

export type BotVaultV3FinalizeMarginAddResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  requestedAmountUsd: number;
  depositedAmountUsd: number;
  transferToPerpAmountUsd: number;
  coreSpotBalanceBeforeUsd: number;
  coreSpotBalanceAfterUsd: number | null;
  activateTxHash: string | null;
  depositTxHash: string | null;
  pauseTxHash: string | null;
  restoredPaused: boolean;
};

type ReduceMarginParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
};

export type BotVaultV3ReduceMarginResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  releasedAmountUsd: number;
  coreSpotBalanceBeforeUsd: number;
  coreSpotBalanceAfterUsd: number | null;
};

type EndBotVaultParams = {
  userId: string;
  botId: string;
};

type ControllerCloseBotVaultParams = {
  userId: string;
  botVaultId: string;
};

type ControllerRecoverClosedBotVaultParams = {
  userId: string;
  botVaultId: string;
};

type HyperliquidClearinghouseState = {
  withdrawable: string;
  accountValue: string;
  totalMarginUsed: string;
  assetPositions: unknown[];
};

type BotVaultV3ExitSpotSymbol = {
  symbol: string;
  exchangeSymbol?: string;
  assetIndex?: number | null;
  status?: string;
  tradable?: boolean;
  tickSize?: number | null;
  stepSize?: number | null;
  minQty?: number | null;
  maxQty?: number | null;
  quoteAsset?: string | null;
  baseAsset?: string | null;
};

type BotVaultV3ExitSpotClient = {
  listSymbols(): Promise<BotVaultV3ExitSpotSymbol[]>;
  getLastPrice(symbol: string): Promise<number | null>;
};

type BotVaultV3ExitCoreWriter = {
  placeLimitOrder(input: {
    asset: number;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    encodedTif: 1 | 2 | 3;
    clientOrderId: string;
  }): Promise<{
    status: "confirmed" | "failed" | "pending_timeout";
    submitted: boolean;
    confirmationSource: "receipt" | "none" | "venue_ack";
    receiptStatus: "success" | "reverted" | "unknown";
    orderId?: string;
    candidateOrderId?: string;
    clientOrderId?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
};

type SetUserAgentWalletParams = {
  userId: string;
  agentWallet: string;
  agentWalletVersion?: number | null;
  agentSecretRef?: string | null;
};

type SetUserAgentThresholdParams = {
  userId: string;
  thresholdHype: number;
};

type WithdrawUserAgentHypeParams = {
  userId: string;
  amountHype?: number | null;
  reserveHype?: number | null;
};

type CreateUserAgentWalletParams = {
  userId: string;
};

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatUsdAtomicToNumber(value: bigint): number {
  return roundUsd(Number(formatUnits(value, 6)), 6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAtomicUsd(value: number): bigint {
  const rounded = roundUsd(toNonNegativeNumber(value), 6);
  return parseUnits(rounded.toFixed(6), 6);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function derivePrincipalOutstandingRaw(principalDepositedRaw: bigint, principalReturnedRaw: bigint): bigint {
  return principalDepositedRaw > principalReturnedRaw
    ? principalDepositedRaw - principalReturnedRaw
    : 0n;
}

function deriveEffectivePrincipalOutstandingRaw(params: {
  principalDepositedRaw: bigint;
  principalReturnedRaw: bigint;
  excludedPrincipalRaw?: bigint;
}): bigint {
  const principalOutstandingRaw = derivePrincipalOutstandingRaw(
    params.principalDepositedRaw,
    params.principalReturnedRaw
  );
  const excludedPrincipalRaw = params.excludedPrincipalRaw ?? 0n;
  return principalOutstandingRaw > excludedPrincipalRaw
    ? principalOutstandingRaw - excludedPrincipalRaw
    : 0n;
}

function roundStep(value: number, step: number | null | undefined, mode: "up" | "down"): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || !Number.isFinite(step) || step <= 0) {
    return Number(value.toFixed(12));
  }
  const ratio = value / step;
  const epsilon = Math.max(1e-9, Math.abs(ratio) * Number.EPSILON * 16);
  const steps = mode === "up"
    ? Math.ceil(ratio - epsilon)
    : Math.floor(ratio + epsilon);
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return Number((steps * step).toFixed(12));
}

function statusIndexToLabel(statusIndex: bigint | number): string {
  const normalized = typeof statusIndex === "bigint" ? Number(statusIndex) : statusIndex;
  if (normalized === 0) return "DEPLOYED";
  if (normalized === 1) return "FUNDED";
  if (normalized === 2) return "ACTIVE";
  if (normalized === 3) return "PAUSED";
  if (normalized === 4) return "CLOSE_ONLY";
  if (normalized === 5) return "CLOSED";
  return `UNKNOWN_${String(statusIndex)}`;
}

function findSpotSymbol(
  rows: BotVaultV3ExitSpotSymbol[],
  baseAsset: string,
  quoteAsset: string
): BotVaultV3ExitSpotSymbol | null {
  const normalizedBase = String(baseAsset ?? "").trim().toUpperCase();
  const normalizedQuote = String(quoteAsset ?? "").trim().toUpperCase();
  for (const row of Array.isArray(rows) ? rows : []) {
    const base = String(row?.baseAsset ?? "").trim().toUpperCase();
    const quote = String(row?.quoteAsset ?? "").trim().toUpperCase();
    if (base !== normalizedBase || quote !== normalizedQuote) continue;
    if (row?.tradable === false) continue;
    return row;
  }
  return null;
}

function createDefaultVaultSpotClient(account: TradingAccount): BotVaultV3ExitSpotClient | null {
  if (String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") return null;
  if (!account.passphrase || !isAddress(account.passphrase)) return null;
  return new HyperliquidSpotClient({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    vaultAddress: account.passphrase,
    testnet: isHyperliquidSpotTestnet()
  });
}

function normalizePrivateKey(value: unknown): `0x${string}` | null {
  const normalized = String(value ?? "").trim();
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(normalized)) return null;
  return (normalized.startsWith("0x") ? normalized : `0x${normalized}`) as `0x${string}`;
}

function sameAddress(left: unknown, right: unknown): boolean {
  if (!isAddress(String(left ?? "")) || !isAddress(String(right ?? ""))) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function deriveAddressFromPrivateKey(value: unknown): `0x${string}` | null {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return null;
  return privateKeyToAccount(privateKey).address;
}

function createDefaultVaultCoreWriter(account: TradingAccount): BotVaultV3ExitCoreWriter | null {
  if (String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") return null;
  const botVaultAddress = toNullableString(account.botVaultAddress);
  const privateKey = normalizePrivateKey(account.apiSecret);
  if (!botVaultAddress || !isAddress(botVaultAddress) || !privateKey) return null;
  const { walletConfig } = buildHyperEvmClient();
  return new HyperliquidCoreWriterClient({
    privateKey,
    botVaultAddress: botVaultAddress as `0x${string}`,
    rpcUrl: resolveHyperEvmWriteRpcUrl(walletConfig.hyperEvmRpcUrl),
    chainId: walletConfig.hyperEvmChainId
  });
}

function computeClaimableProfitUsd(row: {
  availableUsd?: unknown;
  principalAllocated?: unknown;
  principalReturned?: unknown;
  executionMetadata?: unknown;
}): number {
  const executionMetadata = toRecord(row.executionMetadata);
  const excludedPrincipalUsd = roundUsd(
    toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
    6
  );
  const availableUsd = toNonNegativeNumber(row.availableUsd);
  const principalOutstanding = Math.max(
    0,
    toNonNegativeNumber(row.principalAllocated) - toNonNegativeNumber(row.principalReturned)
  );
  const effectivePrincipalOutstandingUsd = Math.max(0, principalOutstanding - excludedPrincipalUsd);
  return roundUsd(Math.max(0, availableUsd - effectivePrincipalOutstandingUsd));
}

function toNormalizedDecimalString(value: unknown, fallback = "0"): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeFinite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sumHyperliquidUnrealizedPnlUsd(state: HyperliquidClearinghouseState | null | undefined): number {
  const rows = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
  let total = 0;
  for (const row of rows) {
    const position = row && typeof row === "object" && "position" in row
      ? (row as { position?: Record<string, unknown> | null }).position
      : row as Record<string, unknown> | null;
    const unrealized = toFiniteNumber(position?.unrealizedPnl ?? position?.unrealizedPL, 0);
    total += unrealized;
  }
  return roundUsd(total, 6);
}

function pickString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const raw = String((value as Record<string, unknown>)[key] ?? "").trim();
    if (raw) return raw;
  }
  return null;
}

function pickNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const parsed = Number((value as Record<string, unknown>)[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function postHyperliquidInfoWithRetry(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const baseUrl = String(process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz").trim();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/info`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return await response.json().catch(() => null) as Record<string, unknown> | null;
      }
      const body = await response.text().catch(() => "");
      const error = new Error(`hyperliquid_info_request_failed:${response.status}:${body}`);
      if ((response.status !== 429 && response.status < 500) || attempt >= 2) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (attempt >= 2) {
        throw error instanceof Error ? error : new Error(String(error ?? "hyperliquid_info_request_failed"));
      }
      lastError = error instanceof Error ? error : new Error(String(error ?? "hyperliquid_info_request_failed"));
    }
    await sleep(400 * (attempt + 1));
  }
  if (lastError) throw lastError;
  throw new Error("hyperliquid_info_request_failed");
}

async function readHyperliquidClearinghouseState(
  address: `0x${string}`
): Promise<HyperliquidClearinghouseState> {
  const payload = await postHyperliquidInfoWithRetry({
    type: "clearinghouseState",
    user: address
  });
  return {
    withdrawable: toNormalizedDecimalString(payload?.withdrawable, "0"),
    accountValue: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.accountValue, "0"),
    totalMarginUsed: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.totalMarginUsed, "0"),
    assetPositions: Array.isArray(payload?.assetPositions) ? payload!.assetPositions as unknown[] : []
  };
}

async function readHyperliquidSpotAssetBalance(address: `0x${string}`, asset: string): Promise<string> {
  const [stateRaw, spotMetaRaw] = await Promise.all([
    postHyperliquidInfoWithRetry({
      type: "spotClearinghouseState",
      user: address
    }),
    postHyperliquidInfoWithRetry({
      type: "spotMeta"
    })
  ]);
  const spotStateRaw = stateRaw?.spotState as Record<string, unknown> | null | undefined;

  const tokens = Array.isArray(spotMetaRaw?.tokens)
    ? spotMetaRaw.tokens
    : Array.isArray(spotMetaRaw?.universe)
      ? spotMetaRaw.universe
      : [];
  const tokenNameByIndex = new Map<number, string>();
  tokens.forEach((entry: unknown, fallbackIndex: number) => {
    const resolvedIndexRaw = pickNumber(entry, ["index", "token", "tokenId", "coinIndex"]);
    const resolvedIndex = resolvedIndexRaw === null || resolvedIndexRaw < 0
      ? fallbackIndex
      : Math.trunc(resolvedIndexRaw);
    const name = pickString(entry, ["name", "coin", "symbol", "tokenName"]);
    if (name) {
      tokenNameByIndex.set(resolvedIndex, name.toUpperCase());
    }
  });

  const balancesRaw = Array.isArray(stateRaw?.balances)
    ? stateRaw.balances
    : Array.isArray(spotStateRaw?.balances)
      ? spotStateRaw.balances as unknown[]
      : Array.isArray(stateRaw?.tokenBalances)
        ? stateRaw.tokenBalances
        : [];
  const normalizedAsset = String(asset ?? "").trim().toUpperCase();

  for (const entry of balancesRaw) {
    const tokenIndex = pickNumber(entry, ["token", "tokenId", "coinIndex"]);
    const tokenName = tokenIndex === null ? null : tokenNameByIndex.get(tokenIndex);
    const symbol = (
      pickString(entry, ["coin", "symbol", "tokenName", "name"])
      ?? tokenName
      ?? ""
    ).toUpperCase();
    if (symbol !== normalizedAsset) continue;
    return toNormalizedDecimalString(pickString(entry, ["total", "balance", "sz", "amount", "available"]), "0");
  }
  return "0";
}

export async function readHyperliquidSpotUsdcBalance(address: `0x${string}`): Promise<string> {
  return readHyperliquidSpotAssetBalance(address, "USDC");
}

function buildHyperEvmClient() {
  const walletConfig = resolveWalletReadConfig();
  const chain = defineChain({
    id: walletConfig.hyperEvmChainId,
    name: walletConfig.hyperEvmChainId === 999 ? "HyperEVM" : `HyperEVM-${walletConfig.hyperEvmChainId}`,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
      default: {
        http: [walletConfig.hyperEvmRpcUrl]
      }
    }
  });
  return {
    walletConfig,
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    })
  };
}

function deriveLowHypeState(balanceWei: string | null, thresholdHype: number): AgentWalletSummary["lowHypeState"] {
  if (!balanceWei) return "unavailable";
  try {
    const currentWei = BigInt(balanceWei);
    const thresholdWei = parseEther(String(Math.max(0, thresholdHype)));
    return currentWei < thresholdWei ? "low" : "ok";
  } catch {
    return "unavailable";
  }
}

function mapAgentWalletSummary(user: any): AgentWalletSummary {
  const address = toNullableString(user?.agentWallet);
  const version = Math.max(1, Math.trunc(Number(user?.agentWalletVersion ?? 1) || 1));
  const secretRef = toNullableString(user?.agentSecretRef);
  const hypeBalance = toNullableString(user?.agentLastBalanceFormatted);
  const hypeBalanceWei = toNullableString(user?.agentLastBalanceWei);
  const lowHypeThreshold = toNonNegativeNumber(user?.agentHypeWarnThreshold, 0.05);
  const updatedAt = user?.agentLastBalanceAt instanceof Date
    ? user.agentLastBalanceAt.toISOString()
    : toNullableString(user?.agentLastBalanceAt);
  const stale = !updatedAt;
  return {
    address,
    version,
    secretRef,
    hypeBalance,
    hypeBalanceWei,
    lowHypeThreshold,
    lowHypeState: deriveLowHypeState(hypeBalanceWei, lowHypeThreshold),
    updatedAt,
    stale
  };
}

export function buildBotVaultV3ActionFlags(row: any): BotVaultV3ActionFlags {
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(row?.executionStatus ?? "").trim().toLowerCase();
  const fundingStatus = String(row?.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(row?.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const principalAllocated = toNonNegativeNumber(row?.principalAllocated ?? row?.allocatedUsd);
  const principalReturned = toNonNegativeNumber(row?.principalReturned);
  const claimableProfitUsd = computeClaimableProfitUsd(row);
  const hasOnchainVault = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));
  const hyperEvmFundingConfirmed =
    fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded";
  const fundingConfirmedOnchain =
    principalAllocated > 0
    || principalReturned > 0
    || hyperEvmFundingConfirmed
    || fundingStatus === "settled"
    || hypercoreFundingStatus === "pending"
    || hypercoreFundingStatus === "funded"
    || hypercoreFundingStatus === "withdrawn";

  return {
    hasOnchainVault,
    fundingConfirmedOnchain,
    canClaim: hasOnchainVault && executionStatus !== "closed" && status !== "CLOSED" && claimableProfitUsd > 0.000001,
    canClose: hasOnchainVault
      && executionStatus !== "closed"
      && (status === "FUNDED" || status === "ACTIVE" || status === "PAUSED" || status === "CLOSE_ONLY"),
    canRecover: hasOnchainVault
      && fundingConfirmedOnchain
      && executionStatus === "closed"
      && (status === "CLOSE_ONLY" || status === "CLOSED"),
    canSetAgentWallet: true
  };
}

export function buildBotVaultV3HealthSummary(row: any): BotVaultV3HealthSummary {
  const { onchainBotVaultAddress, agentWalletAddress } = readBotVaultV3AddressSemantics(row);
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(row?.executionStatus ?? "").trim().toLowerCase();
  const fundingStatus = String(row?.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(row?.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const fundingConfirmedOnchain =
    actionFlags.fundingConfirmedOnchain
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded";
  const onchainStateKnown = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));

  let lifecycleStatus = "created";
  if (executionStatus === "closed") lifecycleStatus = "closed";
  else if (status === "ACTIVE") lifecycleStatus = "active";
  else if (status === "PAUSED") lifecycleStatus = "paused";
  else if (status === "CLOSE_ONLY") lifecycleStatus = "close_only";
  else if (status === "CLOSED") lifecycleStatus = "closed";
  else if (status === "FUNDED") lifecycleStatus = "funded";
  else if (fundingStatus === "hyper_evm_funding_requested") lifecycleStatus = "funding_requested";
  else if (status === "DEPLOYED") lifecycleStatus = onchainStateKnown ? "deployed" : "created";

  let fundingHealth = "empty";
  if (fundingStatus === "hyper_evm_funding_requested") fundingHealth = "requested";
  // `pending` is the currently used post-EVM-funding bridge/transfer state. A separate
  // confirmed HyperCore-funded transition is not emitted by today's BotVaultV3 flow yet.
  else if (hypercoreFundingStatus === "pending") fundingHealth = "transfer_pending";
  else if (hypercoreFundingStatus === "funded") fundingHealth = "funded";
  else if (fundingStatus === "settled" || hypercoreFundingStatus === "withdrawn") fundingHealth = "settled";
  else if (fundingConfirmedOnchain) fundingHealth = "confirmed_onchain";

  let actionState = "idle";
  if (!agentWalletAddress && actionFlags.canSetAgentWallet) actionState = "agent_setup_required";
  else if (actionFlags.canRecover) actionState = "recover_available";
  else if (actionFlags.canClaim) actionState = "claim_available";
  else if (actionFlags.canClose) actionState = "close_available";
  else if (fundingHealth === "requested" || fundingHealth === "transfer_pending") actionState = "waiting_on_chain";
  else if (executionStatus === "closed" || lifecycleStatus === "closed") actionState = "closed";

  return {
    lifecycleStatus,
    fundingHealth,
    onchainStateKnown,
    actionState
  };
}

function mapBotVaultSummary(row: any): BotVaultV3Summary {
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const healthSummary = buildBotVaultV3HealthSummary(row);
  const addresses = readBotVaultV3AddressSemantics(row);
  return {
    id: String(row.id),
    botId: String(row.botId),
    userId: String(row.userId),
    vaultModel: String(row.vaultModel ?? "bot_vault_v3"),
    beneficiaryAddress: toNullableString(row.beneficiaryAddress),
    ...addresses,
    agentWalletVersion: Math.max(1, Math.trunc(Number(row.agentWalletVersion ?? 1) || 1)),
    agentSecretRef: toNullableString(row.agentSecretRef),
    allocatedUsd: toNonNegativeNumber(row.allocatedUsd),
    availableUsd: toNonNegativeNumber(row.availableUsd),
    withdrawnUsd: toNonNegativeNumber(row.withdrawnUsd),
    claimedProfitUsd: toNonNegativeNumber(row.claimedProfitUsd),
    feePaidTotal: toNonNegativeNumber(row.feePaidTotal),
    fundingStatus: String(row.fundingStatus ?? "vault_empty"),
    hypercoreFundingStatus: String(row.hypercoreFundingStatus ?? "not_funded"),
    ...actionFlags,
    healthSummary,
    executionStatus: toNullableString(row.executionStatus),
    status: String(row.status ?? "DEPLOYED"),
    claimableProfitUsd: computeClaimableProfitUsd(row),
    endedAt: row.endedAt instanceof Date ? row.endedAt.toISOString() : toNullableString(row.endedAt),
    closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : toNullableString(row.closedAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : toNullableString(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : toNullableString(row.updatedAt)
  };
}

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

async function readBotVaultV3OnchainSnapshot(params: {
  publicClient: any;
  vaultAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}): Promise<BotVaultV3OnchainSnapshot> {
  const [statusRaw, principalDepositedRaw, principalReturnedRaw, feePaidTotalRaw, usdcBalanceRaw] = await Promise.all([
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "status"
    }),
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "principalDeposited"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "principalReturned"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "feePaidTotal"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [params.vaultAddress]
    }) as Promise<bigint>
  ]);

  return {
    status: statusIndexToLabel(statusRaw),
    principalAllocated: formatUsdAtomicToNumber(principalDepositedRaw),
    principalReturned: formatUsdAtomicToNumber(principalReturnedRaw),
    availableUsd: formatUsdAtomicToNumber(usdcBalanceRaw),
    feePaidTotal: formatUsdAtomicToNumber(feePaidTotalRaw)
  };
}

export function buildBotVaultV3ResyncUpdate(snapshot: BotVaultV3OnchainSnapshot, now = new Date()) {
  const data: Record<string, unknown> = {
    status: snapshot.status,
    principalAllocated: snapshot.principalAllocated,
    allocatedUsd: snapshot.principalAllocated,
    principalReturned: snapshot.principalReturned,
    availableUsd: snapshot.availableUsd,
    feePaidTotal: snapshot.feePaidTotal
  };

  const economicallyClosed = snapshot.status === "CLOSED"
    || (
      snapshot.status === "CLOSE_ONLY"
      && snapshot.availableUsd <= 0
      && snapshot.principalReturned > 0
    );

  if (economicallyClosed) {
    data.fundingStatus = "settled";
    data.hypercoreFundingStatus = "withdrawn";
    data.executionStatus = "closed";
    data.endedAt = now;
    data.closedAt = now;
    return data;
  }

  if (snapshot.principalAllocated > 0 || snapshot.availableUsd > 0) {
    data.fundingStatus = "hyper_evm_confirmed_onchain";
  }

  return data;
}

async function resolveTemplateIdForBot(db: any): Promise<string> {
  const exact = await db.botTemplate.findUnique({
    where: { id: "legacy_grid_default" },
    select: { id: true }
  }).catch(() => null);
  if (exact?.id) return String(exact.id);
  const fallback = await db.botTemplate.findFirst({
    where: {},
    orderBy: { createdAt: "asc" },
    select: { id: true }
  }).catch(() => null);
  if (fallback?.id) return String(fallback.id);
  throw new Error("bot_template_missing");
}

export function createBotVaultV3Service(db: any, deps?: CreateBotVaultV3ServiceDeps) {
  const agentSecretProvider = deps?.agentSecretProvider ?? createApiAgentSecretProvider();
  const controllerAddress = toNullableString(process.env.BOT_VAULT_V3_CONTROLLER_ADDRESS);
  const logger = deps?.logger ?? defaultLogger;
  const decryptSecretValue = deps?.decryptSecret ?? decryptSecret;
  const buildControllerWalletClientOverride = deps?.buildControllerWalletClient ?? null;
  const readHyperliquidClearinghouseStateLive = deps?.readHyperliquidClearinghouseState ?? readHyperliquidClearinghouseState;
  const readHyperliquidSpotAssetBalanceLive = deps?.readHyperliquidSpotAssetBalance ?? readHyperliquidSpotAssetBalance;
  const readHyperliquidSpotUsdcBalanceLive = deps?.readHyperliquidSpotUsdcBalance ?? readHyperliquidSpotUsdcBalance;
  const createPerpExecutionAdapterImpl = deps?.createPerpExecutionAdapter ?? createPerpExecutionAdapter;
  const createVaultCoreWriterImpl = deps?.createVaultCoreWriter ?? createDefaultVaultCoreWriter;
  const createVaultSpotClientImpl = deps?.createVaultSpotClient ?? createDefaultVaultSpotClient;
  const cancelAllOrdersImpl = deps?.cancelAllOrders ?? cancelAllOrders;
  const closePositionsMarketImpl = deps?.closePositionsMarket ?? closePositionsMarket;
  const sleepImpl = deps?.sleep ?? sleep;

  function buildControllerWalletClient(expectedControllerAddress?: string | null) {
    if (buildControllerWalletClientOverride) {
      return buildControllerWalletClientOverride(expectedControllerAddress);
    }
    const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
      throw new Error("controller_private_key_missing");
    }
    const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
    const { chain, walletConfig } = buildHyperEvmClient();
    const rpcUrl = resolveHyperEvmWriteRpcUrl(walletConfig.hyperEvmRpcUrl);
    const account = privateKeyToAccount(privateKey);
    if (expectedControllerAddress && isAddress(expectedControllerAddress)) {
      if (String(account.address).toLowerCase() !== String(expectedControllerAddress).toLowerCase()) {
        throw new Error("controller_private_key_address_mismatch");
      }
    }
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl || walletConfig.hyperEvmRpcUrl)
    });
    return { account, chain, publicClient, walletClient };
  }

  async function readHypercoreAccountingFeeUsdForBotVault(params: {
    botVaultId: string;
    executionMetadata?: unknown;
  }): Promise<number> {
    const executionMetadata = toRecord(params.executionMetadata);
    const metadataFeeUsd = roundUsd(
      toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
      6
    );
    if (metadataFeeUsd > 0) return metadataFeeUsd;
    if (!db?.feeEvent?.findMany) return 0;
    const rows = await db.feeEvent.findMany({
      where: {
        botVaultId: params.botVaultId,
        eventType: "ADJUSTMENT"
      },
      select: {
        feeAmount: true,
        metadata: true
      }
    }).catch(() => []);
    let totalFeeUsd = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const metadata = toRecord(row?.metadata);
      if (String(metadata.source ?? "") !== "hypercore_account_creation") continue;
      totalFeeUsd += toNonNegativeNumber(row?.feeAmount);
    }
    return roundUsd(totalFeeUsd, 6);
  }

  async function createProfitShareFeeEventIfNew(params: {
    botVaultId: string;
    sourceKey: string;
    profitBaseUsd: number;
    feeAmountUsd: number;
    treasuryRecipient: string | null;
    feeRatePct: number;
    txHash: string;
    sourceAction: "claim_profit" | "close_vault" | "recover_closed_funds";
    grossAmountUsd: number;
    netReturnedUsd: number;
    excludedPrincipalUsd: number;
  }): Promise<void> {
    if (!db?.feeEvent?.create || params.feeAmountUsd <= 0) return;
    try {
      await db.feeEvent.create({
        data: {
          botVaultId: params.botVaultId,
          eventType: "PROFIT_SHARE",
          profitBase: roundUsd(params.profitBaseUsd, 6),
          feeAmount: roundUsd(params.feeAmountUsd, 6),
          sourceKey: params.sourceKey,
          metadata: {
            treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
            contractVersion: ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
            treasuryRecipient: params.treasuryRecipient,
            feeRatePct: params.feeRatePct,
            txHash: params.txHash,
            sourceAction: params.sourceAction,
            grossAmountUsd: roundUsd(params.grossAmountUsd, 6),
            netReturnedUsd: roundUsd(params.netReturnedUsd, 6),
            excludedPrincipalUsd: roundUsd(params.excludedPrincipalUsd, 6)
          }
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  async function loadExecutionCloseoutContext(params: {
    userId: string;
    botVaultId: string;
  }): Promise<{
    id: string;
    userId: string;
    symbol: string | null;
    agentWallet: string | null;
    agentWalletVersion: number;
    agentSecretRef: string | null;
    exchangeAccount: {
      id: string;
      exchange: string;
      apiKeyEnc: string;
      apiSecretEnc: string;
      passphraseEnc: string | null;
    } | null;
    executionVaultAddress: string | null;
  } | null> {
    const row = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: {
        id: true,
        userId: true,
        vaultAddress: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        gridInstance: {
          select: {
            template: {
              select: {
                symbol: true
              }
            },
            exchangeAccount: {
              select: {
                id: true,
                exchange: true,
                apiKeyEnc: true,
                apiSecretEnc: true,
                passphraseEnc: true
              }
            }
          }
        },
        bot: {
          select: {
            symbol: true,
            exchangeAccount: {
              select: {
                id: true,
                exchange: true,
                apiKeyEnc: true,
                apiSecretEnc: true,
                passphraseEnc: true
              }
            }
          }
        }
      }
    });
    if (!row) return null;
    const exchangeAccount = row.gridInstance?.exchangeAccount ?? row.bot?.exchangeAccount ?? null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      symbol: toNullableString(row.gridInstance?.template?.symbol) ?? toNullableString(row.bot?.symbol),
      agentWallet: toNullableString(row.agentWallet),
      agentWalletVersion: Number.isFinite(Number(row.agentWalletVersion))
        ? Math.max(1, Math.trunc(Number(row.agentWalletVersion)))
        : 1,
      agentSecretRef: toNullableString(row.agentSecretRef),
      exchangeAccount: exchangeAccount
        ? {
            id: String(exchangeAccount.id),
            exchange: String(exchangeAccount.exchange ?? ""),
            apiKeyEnc: String(exchangeAccount.apiKeyEnc),
            apiSecretEnc: String(exchangeAccount.apiSecretEnc),
            passphraseEnc: exchangeAccount.passphraseEnc ? String(exchangeAccount.passphraseEnc) : null
          }
        : null,
      executionVaultAddress: toNullableString(row.vaultAddress)
    };
  }

  async function resolveExecutionCloseoutAccount(
    context: NonNullable<Awaited<ReturnType<typeof loadExecutionCloseoutContext>>>
  ): Promise<TradingAccount> {
    if (!context.exchangeAccount) {
      throw new Error("bot_vault_v3_exchange_account_missing");
    }
    if (!context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      throw new Error("bot_vault_v3_execution_vault_address_missing");
    }

    const decryptedApiKey = decryptSecretValue(context.exchangeAccount.apiKeyEnc).trim();
    const decryptedApiSecret = decryptSecretValue(context.exchangeAccount.apiSecretEnc).trim();
    const decryptedPrivateKey = normalizePrivateKey(decryptedApiSecret);
    const decryptedSignerAddress = deriveAddressFromPrivateKey(decryptedApiSecret);
    const decryptedApiKeyAddress = isAddress(decryptedApiKey) ? decryptedApiKey as `0x${string}` : null;
    const expectedAgentWallet = toNullableString(context.agentWallet);

    let resolvedApiKey = decryptedApiKeyAddress ?? decryptedSignerAddress;
    let resolvedApiSecret = decryptedPrivateKey;

    if (expectedAgentWallet && isAddress(expectedAgentWallet)) {
      const agentCredentials = await agentSecretProvider.getAgentCredentials({
        userId: context.userId,
        botVaultId: context.id,
        agentWalletAddress: expectedAgentWallet,
        agentWalletVersion: context.agentWalletVersion,
        agentSecretRef: context.agentSecretRef
      }).catch(() => null);
      const agentPrivateKey = normalizePrivateKey(agentCredentials?.privateKey);
      const agentSignerAddress = agentCredentials?.address && isAddress(agentCredentials.address)
        ? agentCredentials.address as `0x${string}`
        : deriveAddressFromPrivateKey(agentCredentials?.privateKey);

      if (agentPrivateKey && agentSignerAddress && sameAddress(agentSignerAddress, expectedAgentWallet)) {
        resolvedApiKey = expectedAgentWallet as `0x${string}`;
        resolvedApiSecret = agentPrivateKey;
      } else if (decryptedPrivateKey && decryptedSignerAddress && sameAddress(decryptedSignerAddress, expectedAgentWallet)) {
        resolvedApiKey = expectedAgentWallet as `0x${string}`;
        resolvedApiSecret = decryptedPrivateKey;
      } else {
        throw new Error(`bot_vault_v3_agent_credentials_missing:${String(expectedAgentWallet).toLowerCase()}`);
      }
    }

    if (!resolvedApiKey || !isAddress(resolvedApiKey)) {
      throw new Error("bot_vault_v3_execution_api_key_invalid");
    }
    if (!resolvedApiSecret) {
      throw new Error("bot_vault_v3_execution_api_secret_invalid");
    }

    return {
      id: context.exchangeAccount.id,
      userId: context.userId,
      exchange: context.exchangeAccount.exchange,
      label: `${context.exchangeAccount.exchange}:${context.id}`,
      apiKey: resolvedApiKey,
      apiSecret: resolvedApiSecret,
      passphrase: context.executionVaultAddress,
      botVaultAddress: context.executionVaultAddress,
      marketDataExchangeAccountId: null
    };
  }

  async function readRequiresHypercoreExitGasTopUp(vaultAddress: `0x${string}`): Promise<boolean> {
    const targetHype = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
    if (targetHype <= 0) return false;
    const hypeBalance = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(vaultAddress, "HYPE"));
    return hypeBalance + 0.0000001 < targetHype;
  }

  async function waitForPositionsToFlat(adapter: any, symbol?: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const positions = typeof adapter?.listPositions === "function"
        ? await adapter.listPositions(symbol ? { symbol } : undefined)
        : [];
      const hasOpenPositions = Array.isArray(positions)
        ? positions.some((position) => Math.abs(Number(position?.size ?? 0)) > 0.0000001)
        : false;
      if (!hasOpenPositions) return;
      await sleepImpl(750);
    }
  }

  async function ensureHypercoreExitGas(params: {
    account: TradingAccount;
    vaultAddress: `0x${string}`;
    onchainStatus: string;
  }): Promise<void> {
    const coreWriter = createVaultCoreWriterImpl(params.account);
    const spotClient = createVaultSpotClientImpl(params.account);
    if (!spotClient) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_market_client_missing");
    }
    if (!coreWriter) {
      throw new Error("bot_vault_v3_hypercore_exit_corewriter_missing");
    }

    const targetHype = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
    const maxUsdcSpend = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_MAX_USDC_SPEND", 1);
    if (targetHype <= 0 || maxUsdcSpend <= 0) return;
    const hypeBefore = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "HYPE"));
    if (hypeBefore >= targetHype - 0.0000001) return;
    if (params.onchainStatus !== "ACTIVE") {
      throw new Error(`bot_vault_v3_hypercore_exit_gas_order_not_allowed:${params.onchainStatus}`);
    }

    const spotUsdcBefore = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "USDC"));
    const spendBudgetUsd = Math.min(spotUsdcBefore, maxUsdcSpend);
    if (spendBudgetUsd <= 0.000001) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_usdc_missing");
    }

    const hypeUsdcMarket = findSpotSymbol(await spotClient.listSymbols(), "HYPE", "USDC");
    const marketAssetIndex = Number(hypeUsdcMarket?.assetIndex ?? NaN);
    if (!hypeUsdcMarket?.symbol || !Number.isFinite(marketAssetIndex) || marketAssetIndex < 0) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_market_missing");
    }

    const referencePrice = toNonNegativeFinite(await spotClient.getLastPrice(hypeUsdcMarket.symbol));
    if (referencePrice <= 0) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_price_unavailable");
    }

    const stepSize = toNonNegativeFinite(hypeUsdcMarket.stepSize);
    const minQty = Math.max(
      toNonNegativeFinite(hypeUsdcMarket.minQty),
      stepSize
    );
    const desiredQty = roundStep(
      Math.max(targetHype - hypeBefore, minQty || targetHype),
      stepSize || null,
      "up"
    );
    const maxAffordableQty = roundStep(spendBudgetUsd / referencePrice, stepSize || null, "down");
    const buyQty = maxAffordableQty >= desiredQty && desiredQty > 0
      ? desiredQty
      : maxAffordableQty;
    if (buyQty <= 0.000000001 || (minQty > 0 && buyQty + 0.000000001 < minQty)) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_budget_too_low");
    }

    const marketSlippage = envNumber("HYPERLIQUID_SPOT_MARKET_SLIPPAGE_PCT", 0.05) / 100;
    const limitPx = Number((referencePrice * (1 + marketSlippage)).toFixed(8));
    const normalizedQty = Number(buyQty.toFixed(8));
    const gasOrderResult = await coreWriter.placeLimitOrder({
      asset: 10_000 + Math.trunc(marketAssetIndex),
      isBuy: true,
      limitPx,
      sz: normalizedQty,
      reduceOnly: false,
      encodedTif: 3,
      clientOrderId: `bot-vault-exit-gas-${crypto.randomUUID()}`
    });
    if (gasOrderResult.status !== "confirmed") {
      throw new Error(
        gasOrderResult.errorMessage
        ?? gasOrderResult.errorCode
        ?? "bot_vault_v3_hypercore_exit_gas_confirmation_pending"
      );
    }
    await sleepImpl(750);
  }

  function isHyperliquidRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
      /hyperliquid_info_request_failed:429\b/i.test(message)
      || /rate[_ -]?limit/i.test(message)
      || /too many requests/i.test(message)
    );
  }

  function isHyperliquidTransientError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
      isHyperliquidRateLimitError(message)
      || /hyperliquidapierror/i.test(message)
      || /unknown error occurred/i.test(message)
      || /failed to deserialize/i.test(message)
      || /request timeout/i.test(message)
      || /fetch failed/i.test(message)
      || /network/i.test(message)
    );
  }

  async function retryHyperliquidTransient<T>(
    operation: string,
    run: () => Promise<T>,
    attempts = 4
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error ?? operation));
        if (!isHyperliquidTransientError(normalized) || attempt >= attempts - 1) {
          throw normalized;
        }
        lastError = normalized;
      }
      await sleepImpl(Math.min(5_000, 500 * (2 ** attempt)));
    }
    throw lastError ?? new Error(`bot_vault_v3_hyperliquid_retry_exhausted:${operation}`);
  }

  type HypercoreExitCheck = {
    state: HyperliquidClearinghouseState;
    withdrawableUsd: number;
    accountValueUsd: number;
    marginUsedUsd: number;
    openPositionCount: number;
    spotUsdcUsd: number;
    requiresExit: boolean;
  };

  async function readHypercoreExitCheck(vaultAddress: `0x${string}`, usdcBalanceRaw: bigint): Promise<HypercoreExitCheck> {
    const state = await readHyperliquidClearinghouseStateLive(vaultAddress);
    const withdrawableUsd = toNonNegativeFinite(state.withdrawable);
    const accountValueUsd = toNonNegativeFinite(state.accountValue);
    const marginUsedUsd = toNonNegativeFinite(state.totalMarginUsed);
    const openPositionCount = Array.isArray(state.assetPositions) ? state.assetPositions.length : 0;
    const spotUsdcUsd = toNonNegativeFinite(await readHyperliquidSpotUsdcBalanceLive(vaultAddress));
    return {
      state,
      withdrawableUsd,
      accountValueUsd,
      marginUsedUsd,
      openPositionCount,
      spotUsdcUsd,
      requiresExit:
        withdrawableUsd > 0.000001
        || spotUsdcUsd > 0.000001
        || marginUsedUsd > 0.000001
        || openPositionCount > 0
        || (accountValueUsd > 0.000001 && usdcBalanceRaw === 0n)
    };
  }

  async function readHypercoreExitCheckWithRetry(
    vaultAddress: `0x${string}`,
    usdcBalanceRaw: bigint
  ): Promise<HypercoreExitCheck> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await readHypercoreExitCheck(vaultAddress, usdcBalanceRaw);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error ?? "hypercore_exit_check_failed"));
        if (!isHyperliquidRateLimitError(normalized) || attempt >= 5) {
          throw normalized;
        }
        lastError = normalized;
      }
      await sleepImpl(Math.min(8000, 750 * (2 ** attempt)));
    }
    throw lastError ?? new Error("bot_vault_v3_hypercore_exit_check_rate_limited");
  }

  function formatHypercoreExitRequiredError(check: HypercoreExitCheck): Error {
    return new Error(
      [
        "bot_vault_v3_hypercore_exit_required",
        `withdrawable=${check.state.withdrawable}`,
        `spotUsdc=${String(check.spotUsdcUsd)}`,
        `accountValue=${check.state.accountValue}`,
        `marginUsed=${check.state.totalMarginUsed}`,
        `openPositions=${String(check.openPositionCount)}`
      ].join(":")
    );
  }

  async function bestEffortSettleHypercoreExit(params: {
    userId: string;
    botVaultId: string;
    onchainStatus: string;
  }): Promise<void> {
    const context = await loadExecutionCloseoutContext(params);
    if (!context?.exchangeAccount || !context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      return;
    }
    const logSettlementStepFailure = (step: string, error: unknown) => {
      logger.warn("bot_vault_v3_hypercore_exit_settlement_step_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        step,
        error: String(error)
      });
    };
    let account: TradingAccount;
    try {
      account = await resolveExecutionCloseoutAccount(context);
    } catch (error) {
      logSettlementStepFailure("resolve_execution_account", error);
      return;
    }
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const symbol = context.symbol ?? undefined;
    try {
      await cancelAllOrdersImpl(adapter, symbol).catch(() => ({ requested: 0, cancelled: 0, failed: 0 }));
      const positions = typeof adapter?.listPositions === "function"
        ? await retryHyperliquidTransient(
            "list_positions",
            () => adapter.listPositions(symbol ? { symbol } : undefined)
          ).catch((error) => {
            logSettlementStepFailure("list_positions", error);
            return [];
          })
        : [];
      const actionablePositions = Array.isArray(positions)
        ? positions.filter((position) => Math.abs(Number(position?.size ?? 0)) > 0.0000001)
        : [];
      for (const position of actionablePositions) {
        const positionSymbol = String(position?.symbol ?? symbol ?? "").trim();
        if (!positionSymbol) continue;
        await retryHyperliquidTransient(
          `close_position:${positionSymbol}`,
          () => closePositionsMarketImpl(adapter, positionSymbol, position.side)
        ).catch((error) => {
          logSettlementStepFailure(`close_position:${positionSymbol}`, error);
          return [];
        });
      }
      await retryHyperliquidTransient(
        "wait_positions_flat",
        () => waitForPositionsToFlat(adapter, symbol)
      ).catch((error) => {
        logSettlementStepFailure("wait_positions_flat", error);
      });

      const accountState: { availableMargin?: unknown } | null = typeof adapter?.getAccountState === "function"
        ? await retryHyperliquidTransient(
            "get_account_state",
            async () => {
              const result = await adapter.getAccountState();
              return result as { availableMargin?: unknown } | null;
            }
          ).catch((error) => {
            logSettlementStepFailure("get_account_state", error);
            return null;
          })
        : null;
      const withdrawableUsd = Math.max(0, Number(accountState?.availableMargin ?? 0));
      if (withdrawableUsd > 0.000001 && typeof adapterAny.transferUsdClass === "function") {
        await retryHyperliquidTransient(
          "transfer_usd_class_to_spot",
          async () => {
            const result = await adapterAny.transferUsdClass({
              amountUsd: withdrawableUsd,
              toPerp: false
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "bot_vault_v3_transfer_usd_class_not_confirmed");
            }
            return result;
          }
        ).catch((error) => {
          logSettlementStepFailure("transfer_usd_class_to_spot", error);
          return null;
        });
        await sleepImpl(750);
      }

      await retryHyperliquidTransient(
        "ensure_hypercore_exit_gas",
        () => ensureHypercoreExitGas({
          account,
          vaultAddress: context.executionVaultAddress as `0x${string}`,
          onchainStatus: params.onchainStatus
        })
      ).catch((error) => {
        logSettlementStepFailure("ensure_hypercore_exit_gas", error);
      });

      const spotBalance: { amountUsd?: unknown } | null = typeof adapterAny.getCoreUsdcSpotBalance === "function"
        ? await retryHyperliquidTransient(
            "get_core_usdc_spot_balance",
            async () => {
              const result = await adapterAny.getCoreUsdcSpotBalance();
              return result as { amountUsd?: unknown } | null;
            }
          ).catch((error) => {
            logSettlementStepFailure("get_core_usdc_spot_balance", error);
            return null;
          })
        : null;
      const spotUsdcUsd = Math.max(0, Number(spotBalance?.amountUsd ?? 0));
      if (spotUsdcUsd > 0.000001 && typeof adapterAny.transferUsdcSpotToEvm === "function") {
        await retryHyperliquidTransient(
          "transfer_usdc_spot_to_evm",
          async () => {
            const result = await adapterAny.transferUsdcSpotToEvm({
              amountUsd: spotUsdcUsd
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "bot_vault_v3_transfer_spot_to_evm_not_confirmed");
            }
            return result;
          }
        ).catch((error) => {
          logSettlementStepFailure("transfer_usdc_spot_to_evm", error);
          return null;
        });
        await sleepImpl(750);
      }
    } catch (error) {
      logger.warn("bot_vault_v3_hypercore_exit_settlement_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        error: String(error)
      });
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function resyncBotVaultV3StateFromChain(params: {
    botVaultId: string;
    vaultAddress: `0x${string}`;
    publicClient: any;
    usdcAddress: `0x${string}`;
  }) {
    const snapshot = await readBotVaultV3OnchainSnapshot({
      publicClient: params.publicClient,
      vaultAddress: params.vaultAddress,
      usdcAddress: params.usdcAddress
    });
    await db.botVault.update({
      where: { id: params.botVaultId },
      data: buildBotVaultV3ResyncUpdate(snapshot)
    });
    return snapshot;
  }

  async function refreshUserAgentWalletSummary(params: { user: any; persist?: boolean }): Promise<AgentWalletSummary> {
    const address = toNullableString(params.user?.agentWallet);
    if (!address || !isAddress(address)) return mapAgentWalletSummary(params.user);
    try {
      const { publicClient } = buildHyperEvmClient();
      const balance = await publicClient.getBalance({
        address: address as `0x${string}`
      });
      const updatedAt = new Date();
      const formatted = formatUnits(balance, 18);
      if (params.persist !== false) {
        await db.user.update({
          where: { id: String(params.user.id) },
          data: {
            agentLastBalanceAt: updatedAt,
            agentLastBalanceWei: balance.toString(),
            agentLastBalanceFormatted: formatted
          }
        }).catch(() => undefined);
      }
      return mapAgentWalletSummary({
        ...params.user,
        agentLastBalanceAt: updatedAt,
        agentLastBalanceWei: balance.toString(),
        agentLastBalanceFormatted: formatted
      });
    } catch {
      return mapAgentWalletSummary(params.user);
    }
  }

  async function getUserAgentWalletSummary(params: { userId: string }) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    return refreshUserAgentWalletSummary({ user });
  }

  async function setUserAgentWallet(params: SetUserAgentWalletParams) {
    const agentWallet = String(params.agentWallet ?? "").trim();
    if (!isAddress(agentWallet)) throw new Error("agent_wallet_invalid");
    const updated = await db.user.update({
      where: { id: params.userId },
      data: {
        agentWallet,
        agentWalletVersion: Math.max(1, Math.trunc(Number(params.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(params.agentSecretRef)
      },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    await db.botVault.updateMany({
      where: {
        userId: params.userId,
        vaultModel: "bot_vault_v3",
        status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
      },
      data: {
        agentWallet,
        agentWalletVersion: Math.max(1, Math.trunc(Number(params.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(params.agentSecretRef)
      }
    }).catch(() => undefined);
    return refreshUserAgentWalletSummary({ user: updated });
  }

  async function createUserAgentWallet(params: CreateUserAgentWalletParams) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    if (toNullableString(user.agentWallet)) {
      throw new Error("agent_wallet_already_configured");
    }

    const activeSecret = await db.agentWalletSecret.findFirst({
      where: {
        userId: params.userId,
        status: "active"
      },
      select: {
        address: true,
        version: true,
        secretRef: true
      },
      orderBy: { version: "desc" }
    }).catch(() => null);

    if (activeSecret?.address && isAddress(activeSecret.address)) {
      const restored = await db.user.update({
        where: { id: params.userId },
        data: {
          agentWallet: activeSecret.address,
          agentWalletVersion: Math.max(1, Math.trunc(Number(activeSecret.version ?? 1) || 1)),
          agentSecretRef: toNullableString(activeSecret.secretRef)
        },
        select: {
          id: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        }
      });
      await db.botVault.updateMany({
        where: {
          userId: params.userId,
          vaultModel: "bot_vault_v3",
          status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
        },
        data: {
          agentWallet: activeSecret.address,
          agentWalletVersion: Math.max(1, Math.trunc(Number(activeSecret.version ?? 1) || 1)),
          agentSecretRef: toNullableString(activeSecret.secretRef)
        }
      }).catch(() => undefined);
      return refreshUserAgentWalletSummary({ user: restored });
    }

    const lastSecret = await db.agentWalletSecret.findFirst({
      where: { userId: params.userId },
      select: { version: true },
      orderBy: { version: "desc" }
    }).catch(() => null);
    const nextVersion = Math.max(1, Math.trunc(Number(lastSecret?.version ?? 0) || 0) + 1);
    const privateKey = `0x${crypto.randomBytes(32).toString("hex")}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    const secretRef = `agent_wallet:${params.userId}:${nextVersion}:${crypto.randomUUID()}`;

    const updated = await db.$transaction(async (tx: any) => {
      await tx.agentWalletSecret.create({
        data: {
          userId: params.userId,
          address: account.address,
          version: nextVersion,
          secretRef,
          encryptedPrivateKey: encryptSecret(privateKey),
          status: "active"
        }
      });
      const nextUser = await tx.user.update({
        where: { id: params.userId },
        data: {
          agentWallet: account.address,
          agentWalletVersion: nextVersion,
          agentSecretRef: secretRef
        },
        select: {
          id: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        }
      });
      await tx.botVault.updateMany({
        where: {
          userId: params.userId,
          vaultModel: "bot_vault_v3",
          status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
        },
        data: {
          agentWallet: account.address,
          agentWalletVersion: nextVersion,
          agentSecretRef: secretRef
        }
      });
      return nextUser;
    });

    return refreshUserAgentWalletSummary({ user: updated });
  }

  async function setUserAgentThreshold(params: SetUserAgentThresholdParams) {
    const thresholdHype = toNonNegativeNumber(params.thresholdHype, -1);
    if (!Number.isFinite(thresholdHype) || thresholdHype < 0) {
      throw new Error("invalid_threshold_hype");
    }
    const updated = await db.user.update({
      where: { id: params.userId },
      data: { agentHypeWarnThreshold: thresholdHype },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    return refreshUserAgentWalletSummary({ user: updated, persist: false });
  }

  async function withdrawHypeFromUserAgentWallet(params: WithdrawUserAgentHypeParams) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        walletAddress: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    const agentWallet = toNullableString(user.agentWallet);
    const targetAddress = toNullableString(user.walletAddress);
    if (!agentWallet || !isAddress(agentWallet)) throw new Error("agent_wallet_missing");
    if (!targetAddress || !isAddress(targetAddress)) throw new Error("linked_wallet_missing");
    const credentials = await agentSecretProvider.getAgentCredentials({
      userId: params.userId,
      masterVaultId: null,
      botVaultId: `user:${params.userId}`,
      agentWalletAddress: agentWallet,
      agentWalletVersion: user.agentWalletVersion,
      agentSecretRef: user.agentSecretRef
    });
    if (!credentials?.privateKey) throw new Error("agent_secret_missing");

    const reserveHype = toNonNegativeNumber(params.reserveHype, 0.003);
    const { chain, publicClient, walletConfig } = buildHyperEvmClient();
    const account = privateKeyToAccount(credentials.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    });
    const rawBalance = await publicClient.getBalance({ address: agentWallet as `0x${string}` });
    const reserveWei = parseEther(String(reserveHype));
    const requestedWei = params.amountHype != null ? parseEther(String(Math.max(0, Number(params.amountHype)))) : null;
    let amountWei = requestedWei ?? (rawBalance > reserveWei ? rawBalance - reserveWei : 0n);
    if (rawBalance - amountWei < reserveWei) {
      amountWei = rawBalance > reserveWei ? rawBalance - reserveWei : 0n;
    }
    if (amountWei <= 0n) throw new Error("insufficient_hype_balance");

    const txHash = await walletClient.sendTransaction({
      account,
      chain,
      to: targetAddress as `0x${string}`,
      value: amountWei
    });
    const nextBalanceWei = rawBalance - amountWei;
    await db.user.update({
      where: { id: params.userId },
      data: {
        agentLastBalanceAt: new Date(),
        agentLastBalanceWei: nextBalanceWei.toString(),
        agentLastBalanceFormatted: formatUnits(nextBalanceWei, 18)
      }
    }).catch(() => undefined);

    return {
      txHash,
      amountHype: formatUnits(amountWei, 18),
      remainingReserveHype: formatUnits(nextBalanceWei, 18),
      targetAddress
    };
  }

  async function getBotVaultForBot(params: { userId: string; botId: string }): Promise<BotVaultV3Summary | null> {
    const row = await db.botVault.findFirst({
      where: {
        userId: params.userId,
        botId: params.botId,
        vaultModel: "bot_vault_v3"
      }
    });
    return row ? mapBotVaultSummary(row) : null;
  }

  async function findBotVaultRecordForBot(params: {
    userId: string;
    botId: string;
    select?: Record<string, boolean>;
  }) {
    return db.botVault.findFirst({
      where: {
        userId: params.userId,
        botId: params.botId,
        vaultModel: "bot_vault_v3"
      },
      select: params.select
    });
  }

  async function findBotVaultRecordById(params: {
    userId: string;
    botVaultId: string;
    select?: Record<string, boolean>;
  }) {
    return db.botVault.findFirst({
      where: {
        userId: params.userId,
        id: params.botVaultId,
        vaultModel: "bot_vault_v3"
      },
      select: params.select
    });
  }

  async function ensureBotVaultForBot(params: { userId: string; botId: string }): Promise<BotVaultV3Summary> {
    const existing = await getBotVaultForBot(params);
    if (existing) return existing;

    const [bot, user, templateId] = await Promise.all([
      db.bot.findFirst({
        where: { id: params.botId, userId: params.userId },
        select: { id: true, userId: true }
      }),
      db.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          walletAddress: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true
        }
      }),
      resolveTemplateIdForBot(db)
    ]);
    if (!bot) throw new Error("bot_not_found");
    if (!user) throw new Error("user_not_found");

    const created = await db.botVault.create({
      data: {
        userId: params.userId,
        masterVaultId: null,
        templateId,
        botId: params.botId,
        vaultModel: "bot_vault_v3",
        beneficiaryAddress: toNullableString(user.walletAddress),
        controllerAddress,
        agentWallet: toNullableString(user.agentWallet),
        agentWalletVersion: Math.max(1, Math.trunc(Number(user.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(user.agentSecretRef),
        fundingStatus: "deployed",
        hypercoreFundingStatus: "not_funded",
        executionStatus: "created",
        availableUsd: 0,
        allocatedUsd: 0,
        principalAllocated: 0,
        principalReturned: 0,
        claimedProfitUsd: 0
      }
    });
    return mapBotVaultSummary(created);
  }

  async function fundBotVault(params: FundBotVaultParams): Promise<BotVaultV3Summary> {
    const amountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0));
    if (amountUsd <= 0) throw new Error("amount_required");
    const current = await ensureBotVaultForBot({ userId: params.userId, botId: params.botId });
    const updated = await db.botVault.update({
      where: { id: current.id },
      data: {
        // Keep DB balances unchanged until the onchain Funded event confirms principal actually arrived.
        fundingStatus: "hyper_evm_funding_requested",
        hypercoreFundingStatus: "not_funded",
        executionStatus: "created"
      }
    });
    return mapBotVaultSummary(updated);
  }

  async function loadClaimProfitQuote(params: LoadClaimProfitQuoteParams): Promise<ClaimProfitQuote> {
    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");

    const controllerClient = buildControllerWalletClient(expectedControllerAddress);
    const { publicClient } = controllerClient;

    const [statusRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, evmUsdcBalanceRaw, excludedPrincipalUsd, hypercoreState, hypercoreSpotUsdcRaw] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      }),
      retryHyperliquidTransient(
        "claim_profit_clearinghouse_state",
        () => readHyperliquidClearinghouseStateLive(vaultAddress as `0x${string}`)
      ).catch(() => ({
        withdrawable: "0",
        accountValue: "0",
        totalMarginUsed: "0",
        assetPositions: []
      } satisfies HyperliquidClearinghouseState)),
      retryHyperliquidTransient(
        "claim_profit_spot_usdc_balance",
        () => readHyperliquidSpotUsdcBalanceLive(vaultAddress as `0x${string}`)
      ).catch(() => "0")
    ]);

    const status = statusIndexToLabel(statusRaw);
    if (status === "CLOSED") {
      throw new Error("claim_profit_unavailable:vault_closed");
    }

    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const evmUsdcBalanceUsd = formatUsdAtomicToNumber(evmUsdcBalanceRaw);
    const hypercoreAccountValueUsd = roundUsd(toNonNegativeFinite(hypercoreState.accountValue), 6);
    const hypercoreSpotUsdcUsd = roundUsd(toNonNegativeFinite(hypercoreSpotUsdcRaw), 6);
    const unrealizedPnlUsd = sumHyperliquidUnrealizedPnlUsd(hypercoreState);
    const totalVaultValueUsd = roundUsd(evmUsdcBalanceUsd + hypercoreAccountValueUsd + hypercoreSpotUsdcUsd, 6);
    const effectivePrincipalOutstandingUsd = formatUsdAtomicToNumber(effectivePrincipalOutstandingRaw);
    const claimableProfitUsd = roundUsd(
      Math.max(0, totalVaultValueUsd - effectivePrincipalOutstandingUsd - unrealizedPnlUsd),
      6
    );
    const claimableProfitRaw = toAtomicUsd(claimableProfitUsd);
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    if (claimableProfitRaw <= 0n) {
      if (params.allowEmptyClaim === true) {
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          status,
          claimableProfitRaw,
          requestedAmountRaw: 0n,
          feeRatePctRaw,
          feeAmountRaw: 0n,
          treasuryRecipientRaw: null,
          excludedPrincipalUsd,
          usdcAddress,
          controllerClient,
          evmUsdcBalanceRaw
        };
      }
      throw new Error("claim_profit_unavailable:no_claimable_profit");
    }

    const requestedAmountRaw = params.amountUsd != null
      ? toAtomicUsd(params.amountUsd)
      : claimableProfitRaw;
    if (requestedAmountRaw <= 0n) {
      throw new Error("invalid_amount_usd");
    }
    if (requestedAmountRaw > claimableProfitRaw) {
      throw new Error("claim_profit_unavailable:amount_exceeds_claimable_profit");
    }

    const feeAmountRaw = (requestedAmountRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      status,
      claimableProfitRaw,
      requestedAmountRaw,
      feeRatePctRaw,
      feeAmountRaw,
      treasuryRecipientRaw,
      excludedPrincipalUsd,
      usdcAddress,
      controllerClient,
      evmUsdcBalanceRaw
    };
  }

  async function settleClaimProfitToEvm(params: {
    userId: string;
    botVaultId: string;
    vaultAddress: `0x${string}`;
    onchainStatus: string;
    requiredAmountUsd: number;
    currentEvmBalanceUsd: number;
  }): Promise<void> {
    const shortfallUsd = roundUsd(Math.max(0, params.requiredAmountUsd - params.currentEvmBalanceUsd), 6);
    if (shortfallUsd <= 0.000001) return;

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: params.botVaultId
    });
    if (!context) throw new Error("bot_vault_not_found");

    const executionAccount = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(executionAccount);
    const adapterAny = adapter as any;

    try {
      let spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      if (spotUsdcUsd + 0.000001 < shortfallUsd) {
        if (typeof adapterAny.transferUsdClass !== "function") {
          throw new Error("claim_profit_unavailable:hypercore_transfer_unavailable");
        }
        const neededFromPerpUsd = roundUsd(Math.max(0, shortfallUsd - spotUsdcUsd), 6);
        const accountState = typeof adapter?.getAccountState === "function"
          ? await retryHyperliquidTransient(
              "claim_profit_get_account_state",
              async () => {
                const result = await adapter.getAccountState();
                return result as { availableMargin?: unknown } | null;
              }
            ).catch(() => null)
          : null;
        const withdrawableUsd = roundUsd(toNonNegativeFinite(accountState?.availableMargin), 6);
        if (withdrawableUsd + 0.000001 < neededFromPerpUsd) {
          throw new Error("claim_profit_unavailable:insufficient_hypercore_withdrawable");
        }
        await retryHyperliquidTransient(
          "claim_profit_transfer_usd_class_to_spot",
          async () => {
            const result = await adapterAny.transferUsdClass({
              amountUsd: neededFromPerpUsd,
              toPerp: false
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "claim_profit_unavailable:transfer_usd_class_not_confirmed");
            }
            return result;
          }
        );
        await sleepImpl(750);
        spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      }

      const transferToEvmUsd = roundUsd(Math.min(shortfallUsd, spotUsdcUsd), 6);
      if (transferToEvmUsd <= 0.000001) {
        throw new Error("claim_profit_unavailable:no_hypercore_spot_usdc");
      }
      if (typeof adapterAny.transferUsdcSpotToEvm !== "function") {
        throw new Error("claim_profit_unavailable:spot_to_evm_transfer_unavailable");
      }

      await retryHyperliquidTransient(
        "claim_profit_ensure_exit_gas",
        () => ensureHypercoreExitGas({
          account: executionAccount,
          vaultAddress: params.vaultAddress,
          onchainStatus: params.onchainStatus
        })
      );

      await retryHyperliquidTransient(
        "claim_profit_transfer_usdc_spot_to_evm",
        async () => {
          const result = await adapterAny.transferUsdcSpotToEvm({
            amountUsd: transferToEvmUsd
          });
          if (result?.status !== "confirmed") {
            throw new Error(result?.errorMessage ?? result?.errorCode ?? "claim_profit_unavailable:transfer_spot_to_evm_not_confirmed");
          }
          return result;
        }
      );
      await sleepImpl(750);
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function previewClaimProfit(params: PreviewClaimProfitParams): Promise<BotVaultV3ClaimProfitPreview> {
    const quote = await loadClaimProfitQuote({
      ...params,
      allowEmptyClaim: true
    });
    return {
      botVaultId: quote.botVaultId,
      vaultAddress: quote.vaultAddress,
      onchainBotVaultAddress: quote.onchainBotVaultAddress,
      status: quote.status,
      maxClaimableUsd: formatUsdAtomicToNumber(quote.claimableProfitRaw),
      requestedAmountUsd: formatUsdAtomicToNumber(quote.requestedAmountRaw),
      feeRatePct: Number(quote.feeRatePctRaw),
      feeAmountUsd: formatUsdAtomicToNumber(quote.feeAmountRaw),
      netAmountUsd: roundUsd(
        Math.max(
          0,
          formatUsdAtomicToNumber(quote.requestedAmountRaw) - formatUsdAtomicToNumber(quote.feeAmountRaw)
        ),
        6
      ),
      excludedPrincipalUsd: roundUsd(quote.excludedPrincipalUsd, 6),
      treasuryRecipient: toNullableString(quote.treasuryRecipientRaw)
    };
  }

  async function claimProfit(params: ClaimProfitParams): Promise<BotVaultV3ClaimProfitResult> {
    let quote = await loadClaimProfitQuote(params);
    const {
      botVaultId,
      vaultAddress,
      requestedAmountRaw,
      usdcAddress
    } = quote;
    const requestedAmountUsd = formatUsdAtomicToNumber(requestedAmountRaw);

    if (formatUsdAtomicToNumber(quote.evmUsdcBalanceRaw) + 0.000001 < requestedAmountUsd) {
      await settleClaimProfitToEvm({
        userId: params.userId,
        botVaultId,
        vaultAddress: vaultAddress as `0x${string}`,
        onchainStatus: quote.status,
        requiredAmountUsd: requestedAmountUsd,
        currentEvmBalanceUsd: formatUsdAtomicToNumber(quote.evmUsdcBalanceRaw)
      });
      quote = await loadClaimProfitQuote(params);
    }

    const {
      feeAmountRaw,
      feeRatePctRaw,
      treasuryRecipientRaw,
      excludedPrincipalUsd,
      controllerClient
    } = quote;
    const { account, chain, publicClient, walletClient } = controllerClient;

    const claimTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "claimProfit",
        args: [requestedAmountRaw, feeAmountRaw, 0n]
      })
    });
    const claimReceipt = await publicClient.waitForTransactionReceipt({
      hash: claimTxHash as `0x${string}`,
      confirmations: 1
    });
    if (claimReceipt.status !== "success") {
      throw new Error("bot_vault_v3_claim_profit_tx_failed");
    }

    await resyncBotVaultV3StateFromChain({
      botVaultId,
      vaultAddress: vaultAddress as `0x${string}`,
      publicClient,
      usdcAddress
    }).catch(() => undefined);

    await createProfitShareFeeEventIfNew({
      botVaultId,
      sourceKey: `bot_vault_v3:${botVaultId}:claim_profit:${String(claimTxHash).toLowerCase()}:fee_event`,
      profitBaseUsd: formatUsdAtomicToNumber(requestedAmountRaw),
      feeAmountUsd: formatUsdAtomicToNumber(feeAmountRaw),
      treasuryRecipient: toNullableString(treasuryRecipientRaw),
      feeRatePct: Number(feeRatePctRaw),
      txHash: String(claimTxHash),
      sourceAction: "claim_profit",
      grossAmountUsd: formatUsdAtomicToNumber(requestedAmountRaw),
      netReturnedUsd: roundUsd(
        Math.max(
          0,
          formatUsdAtomicToNumber(requestedAmountRaw) - formatUsdAtomicToNumber(feeAmountRaw)
        ),
        6
      ),
      excludedPrincipalUsd
    }).catch(() => undefined);

    return {
      botVaultId,
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      claimTxHash,
      grossAmountAtomic: requestedAmountRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString(),
      principalPortionAtomic: "0"
    };
  }

  async function readCoreUsdcSpotBalanceFromAdapter(adapter: any): Promise<number> {
    if (typeof adapter?.getCoreUsdcSpotBalance !== "function") return 0;
    const balance = await retryHyperliquidTransient(
      "get_core_usdc_spot_balance",
      async () => {
        const result = await adapter.getCoreUsdcSpotBalance();
        return result as { amountUsd?: unknown } | null;
      }
    );
    return Math.max(0, Number(balance?.amountUsd ?? 0));
  }

  async function finalizeMarginAdd(params: FinalizeMarginAddParams): Promise<BotVaultV3FinalizeMarginAddResult> {
    const requestedAmountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0), 6);
    if (requestedAmountUsd <= 0) throw new Error("amount_required");

    const botVault = await findBotVaultRecordById({
      userId: params.userId,
      botVaultId: params.botVaultId,
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
    if (!context) throw new Error("bot_vault_not_found");

    const account = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const { account: controllerAccount, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);

    let activateTxHash: string | null = null;
    let depositTxHash: string | null = null;
    let pauseTxHash: string | null = null;
    let restoredPaused = false;

    try {
      const statusRaw = await publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      });
      const initialStatus = statusIndexToLabel(statusRaw);
      let currentStatus = initialStatus;

      if (initialStatus === "PAUSED" || initialStatus === "FUNDED") {
        activateTxHash = await sendSerializedControllerTransaction({
          account: controllerAccount,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: botVaultV3Abi,
            functionName: "activate",
            args: []
          })
        });
        const activateReceipt = await publicClient.waitForTransactionReceipt({
          hash: activateTxHash as `0x${string}`,
          confirmations: 1
        });
        if (activateReceipt.status !== "success") {
          throw new Error("bot_vault_v3_margin_add_activate_tx_failed");
        }
        currentStatus = "ACTIVE";
      }

      if (currentStatus !== "ACTIVE") {
        throw new Error(`bot_vault_v3_margin_add_invalid_status:${currentStatus}`);
      }

      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      const missingHypercoreFundingUsd = roundUsd(
        Math.max(0, requestedAmountUsd - coreSpotBalanceBeforeUsd),
        6
      );

      if (missingHypercoreFundingUsd > 0.000001) {
        const evmBalanceRaw = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [vaultAddress as `0x${string}`]
        }) as bigint;
        const evmBalanceUsd = formatUsdAtomicToNumber(evmBalanceRaw);
        if (evmBalanceUsd + 0.000001 < missingHypercoreFundingUsd) {
          throw new Error(`bot_vault_v3_margin_add_insufficient_evm_balance:${String(evmBalanceUsd)}`);
        }
        depositTxHash = await sendSerializedControllerTransaction({
          account: controllerAccount,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: botVaultV3Abi,
            functionName: "depositUsdcToHyperCore",
            args: [toAtomicUsd(missingHypercoreFundingUsd)]
          })
        });
        const depositReceipt = await publicClient.waitForTransactionReceipt({
          hash: depositTxHash as `0x${string}`,
          confirmations: 1
        });
        if (depositReceipt.status !== "success") {
          throw new Error("bot_vault_v3_margin_add_deposit_tx_failed");
        }
        await sleepImpl(750);
      }

      if (typeof adapterAny.transferUsdClass !== "function") {
        throw new Error("bot_vault_v3_margin_transfer_unavailable");
      }

      await retryHyperliquidTransient(
        "transfer_usd_class_to_perp",
        () => adapterAny.transferUsdClass({
          amountUsd: requestedAmountUsd,
          toPerp: true
        })
      );

      const coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => null);

      if (initialStatus === "PAUSED") {
        try {
          pauseTxHash = await sendSerializedControllerTransaction({
            account: controllerAccount,
            chain,
            publicClient,
            walletClient
          }, {
            to: vaultAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: parseAbi(["function pause()"]),
              functionName: "pause",
              args: []
            })
          });
          const pauseReceipt = await publicClient.waitForTransactionReceipt({
            hash: pauseTxHash as `0x${string}`,
            confirmations: 1
          });
          restoredPaused = pauseReceipt.status === "success";
        } catch (error) {
          logger.warn("bot_vault_v3_margin_add_restore_pause_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            error: String(error)
          });
        }
      }

      await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      }).catch(() => undefined);
      await db.botVault.update({
        where: { id: String(botVault.id) },
        data: {
          hypercoreFundingStatus: "funded"
        }
      }).catch(() => undefined);

      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        requestedAmountUsd,
        depositedAmountUsd: missingHypercoreFundingUsd,
        transferToPerpAmountUsd: requestedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
        activateTxHash,
        depositTxHash,
        pauseTxHash,
        restoredPaused
      };
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function reduceMargin(params: ReduceMarginParams): Promise<BotVaultV3ReduceMarginResult> {
    const releasedAmountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0), 6);
    if (releasedAmountUsd <= 0) throw new Error("amount_required");

    const botVault = await findBotVaultRecordById({
      userId: params.userId,
      botVaultId: params.botVaultId,
      select: {
        id: true,
        vaultAddress: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
    if (!context) throw new Error("bot_vault_not_found");
    const account = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;

    try {
      if (typeof adapterAny.transferUsdClass !== "function") {
        throw new Error("bot_vault_v3_margin_transfer_unavailable");
      }
      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      await retryHyperliquidTransient(
        "transfer_usd_class_to_spot",
        () => adapterAny.transferUsdClass({
          amountUsd: releasedAmountUsd,
          toPerp: false
        })
      );
      const coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => null);
      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6)
      };
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function endBotVault(params: EndBotVaultParams) {
    const bot = await db.bot.findFirst({
      where: {
        id: params.botId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!bot) throw new Error("bot_not_found");

    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
      select: { id: true }
    });
    if (!botVault?.id) return null;
    return controllerCloseBotVault({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
  }

  async function controllerCloseBotVault(
    params: ControllerCloseBotVaultParams
  ): Promise<BotVaultV3ControllerCloseResult> {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId,
        vaultModel: "bot_vault_v3"
      },
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusBeforeRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceBeforeRaw, excludedPrincipalUsd] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      })
    ]);
    const statusBefore = statusIndexToLabel(statusBeforeRaw);
    if (
      statusBefore !== "ACTIVE"
      && statusBefore !== "PAUSED"
      && statusBefore !== "FUNDED"
      && statusBefore !== "CLOSE_ONLY"
      && statusBefore !== "CLOSED"
    ) {
      throw new Error(`bot_vault_v3_close_invalid_status:${statusBefore}`);
    }
    let closeOnlyTxHash: string | null = null;
    let statusAfterCloseOnly = statusBefore;
    let currentStatus = statusBefore;

    if (statusBefore === "CLOSED") {
      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        closeOnlyTxHash,
        closeTxHash: null,
        onchainStatusBefore: statusBefore,
        onchainStatusAfterCloseOnly: statusAfterCloseOnly,
        principalToReturnAtomic: "0",
        grossAmountAtomic: "0",
        feeAmountAtomic: "0"
      };
    }

    let usdcBalanceRaw = usdcBalanceBeforeRaw;
    let hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    if (hypercoreExitCheck.requiresExit && (currentStatus === "PAUSED" || currentStatus === "FUNDED")) {
      const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(vaultAddress as `0x${string}`);
      if (needsExitGasTopUp) {
        const activateTxHash = await sendSerializedControllerTransaction({
          account,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: botVaultV3Abi,
            functionName: "activate",
            args: []
          })
        });
        const activateReceipt = await publicClient.waitForTransactionReceipt({
          hash: activateTxHash as `0x${string}`,
          confirmations: 1
        });
        if (activateReceipt.status !== "success") {
          throw new Error("bot_vault_v3_activate_for_exit_tx_failed");
        }
        const activatedStatusRaw = await publicClient.readContract({
          address: vaultAddress as `0x${string}`,
          abi: botVaultV3Abi,
          functionName: "status"
        });
        currentStatus = statusIndexToLabel(activatedStatusRaw);
        if (currentStatus !== "ACTIVE") {
          throw new Error(`bot_vault_v3_activate_for_exit_failed:${currentStatus}`);
        }
      }
    }

    if (hypercoreExitCheck.requiresExit && currentStatus === "ACTIVE") {
      await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: currentStatus
      });
      usdcBalanceRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    }

    if (currentStatus === "ACTIVE" || currentStatus === "PAUSED" || currentStatus === "FUNDED") {
      closeOnlyTxHash = await sendSerializedControllerTransaction({
        account,
        chain,
        publicClient,
        walletClient
      }, {
        to: vaultAddress as `0x${string}`,
        data: encodeFunctionData({
          abi: botVaultV3Abi,
          functionName: "setCloseOnly",
          args: []
        })
      });
      const closeOnlyReceipt = await publicClient.waitForTransactionReceipt({
        hash: closeOnlyTxHash as `0x${string}`,
        confirmations: 1
      });
      if (closeOnlyReceipt.status !== "success") {
        throw new Error("bot_vault_v3_close_only_tx_failed");
      }
      const statusAfterCloseOnlyRaw = await publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      });
      statusAfterCloseOnly = statusIndexToLabel(statusAfterCloseOnlyRaw);
      currentStatus = statusAfterCloseOnly;
      if (statusAfterCloseOnly !== "CLOSE_ONLY") {
        throw new Error(`bot_vault_v3_close_only_failed:${statusAfterCloseOnly}`);
      }
    }

    usdcBalanceRaw = await publicClient.readContract({
      address: usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [vaultAddress as `0x${string}`]
    }) as bigint;
    hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);

    if (hypercoreExitCheck.requiresExit) {
      await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: statusAfterCloseOnly
      });
      usdcBalanceRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
      if (hypercoreExitCheck.requiresExit) {
        throw formatHypercoreExitRequiredError(hypercoreExitCheck);
      }
    }

    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const principalToReturnRaw = effectivePrincipalOutstandingRaw > usdcBalanceRaw
      ? usdcBalanceRaw
      : effectivePrincipalOutstandingRaw;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;
    const closeTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "closeVault",
        args: [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
      })
    });
    const closeReceipt = await publicClient.waitForTransactionReceipt({
      hash: closeTxHash as `0x${string}`,
      confirmations: 1
    });
    if (closeReceipt.status !== "success") {
      throw new Error("bot_vault_v3_close_tx_failed");
    }

    const grossAmountUsd = formatUsdAtomicToNumber(usdcBalanceRaw);
    const principalReturnedUsd = formatUsdAtomicToNumber(principalToReturnRaw);
    const feeAmountUsd = formatUsdAtomicToNumber(feeAmountRaw);
    const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd));
    const netReturnedUsd = roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd));

    let postCloseSnapshot: BotVaultV3OnchainSnapshot | null = null;
    try {
      postCloseSnapshot = await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      });
    } catch {
      await db.botVault.update({
        where: { id: String(botVault.id) },
        data: {
          principalReturned: { increment: principalReturnedUsd },
          availableUsd: 0,
          withdrawnUsd: { increment: netReturnedUsd },
          claimedProfitUsd: { increment: profitComponentUsd },
          feePaidTotal: { increment: feeAmountUsd },
          fundingStatus: "settled",
          hypercoreFundingStatus: "withdrawn",
          executionStatus: "closed",
          status: "CLOSE_ONLY",
          endedAt: new Date(),
          closedAt: new Date()
        }
      }).catch(() => undefined);
    }

    if (postCloseSnapshot) {
      const settledAt = new Date();
      await db.botVault.update({
        where: { id: String(botVault.id) },
        data: {
          withdrawnUsd: { increment: netReturnedUsd },
          claimedProfitUsd: { increment: profitComponentUsd },
          fundingStatus: "settled",
          hypercoreFundingStatus: "withdrawn",
          executionStatus: "closed",
          executionLastError: null,
          executionLastErrorAt: null,
          status: postCloseSnapshot.status,
          endedAt: settledAt,
          closedAt: settledAt
        }
      }).catch(() => undefined);
    }

    await createProfitShareFeeEventIfNew({
      botVaultId: String(botVault.id),
      sourceKey: `bot_vault_v3:${String(botVault.id)}:close_vault:${String(closeTxHash).toLowerCase()}:fee_event`,
      profitBaseUsd: profitComponentUsd,
      feeAmountUsd,
      treasuryRecipient: toNullableString(treasuryRecipientRaw),
      feeRatePct: Number(feeRatePctRaw),
      txHash: String(closeTxHash),
      sourceAction: "close_vault",
      grossAmountUsd,
      netReturnedUsd,
      excludedPrincipalUsd
    }).catch(() => undefined);

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      closeOnlyTxHash,
      closeTxHash,
      onchainStatusBefore: statusBefore,
      onchainStatusAfterCloseOnly: statusAfterCloseOnly,
      principalToReturnAtomic: principalToReturnRaw.toString(),
      grossAmountAtomic: usdcBalanceRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString()
    };
  }

  async function controllerRecoverClosedBotVault(
    params: ControllerRecoverClosedBotVaultParams
  ): Promise<BotVaultV3ControllerRecoverClosedResult> {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId,
        vaultModel: "bot_vault_v3"
      },
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceRaw, excludedPrincipalUsd] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      })
    ]);
    const status = statusIndexToLabel(statusRaw);
    if (status !== "CLOSE_ONLY" && status !== "CLOSED") {
      throw new Error(`bot_vault_v3_recovery_requires_close_only_or_closed_status:${status}`);
    }
    if (usdcBalanceRaw <= 0n) {
      throw new Error("bot_vault_v3_recovery_no_vault_balance");
    }
    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const principalToReturnRaw = effectivePrincipalOutstandingRaw > usdcBalanceRaw
      ? usdcBalanceRaw
      : effectivePrincipalOutstandingRaw;
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;

    const recoverTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "recoverClosedFunds",
        args: [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
      })
    });
    const recoverReceipt = await publicClient.waitForTransactionReceipt({
      hash: recoverTxHash as `0x${string}`,
      confirmations: 1
    });
    if (recoverReceipt.status !== "success") {
      throw new Error("bot_vault_v3_recovery_tx_failed");
    }

    const grossAmountUsd = formatUsdAtomicToNumber(usdcBalanceRaw);
    const principalReturnedUsd = formatUsdAtomicToNumber(principalToReturnRaw);
    const feeAmountUsd = formatUsdAtomicToNumber(feeAmountRaw);
    const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd));
    const netReturnedUsd = roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd));

    let postRecoverySnapshot: BotVaultV3OnchainSnapshot | null = null;
    try {
      postRecoverySnapshot = await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      });
    } catch {
      await db.botVault.update({
        where: { id: String(botVault.id) },
        data: {
          principalReturned: { increment: principalReturnedUsd },
          availableUsd: 0,
          withdrawnUsd: { increment: netReturnedUsd },
          claimedProfitUsd: { increment: profitComponentUsd },
          feePaidTotal: { increment: feeAmountUsd },
          executionStatus: "closed",
          status: status === "CLOSED" ? "CLOSED" : "CLOSE_ONLY"
        }
      }).catch(() => undefined);
    }

    if (postRecoverySnapshot) {
      await db.botVault.update({
        where: { id: String(botVault.id) },
        data: {
          withdrawnUsd: { increment: netReturnedUsd },
          claimedProfitUsd: { increment: profitComponentUsd },
          fundingStatus: "settled",
          hypercoreFundingStatus: "withdrawn",
          executionStatus: "closed",
          executionLastError: null,
          executionLastErrorAt: null,
          status: postRecoverySnapshot.status
        }
      }).catch(() => undefined);
    }

    await createProfitShareFeeEventIfNew({
      botVaultId: String(botVault.id),
      sourceKey: `bot_vault_v3:${String(botVault.id)}:recover_closed_funds:${String(recoverTxHash).toLowerCase()}:fee_event`,
      profitBaseUsd: profitComponentUsd,
      feeAmountUsd,
      treasuryRecipient: toNullableString(treasuryRecipientRaw),
      feeRatePct: Number(feeRatePctRaw),
      txHash: String(recoverTxHash),
      sourceAction: "recover_closed_funds",
      grossAmountUsd,
      netReturnedUsd,
      excludedPrincipalUsd
    }).catch(() => undefined);

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      recoverTxHash,
      principalToReturnAtomic: principalToReturnRaw.toString(),
      grossAmountAtomic: usdcBalanceRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString()
    };
  }

  return {
    getUserAgentWalletSummary,
    createUserAgentWallet,
    setUserAgentWallet,
    setUserAgentThreshold,
    withdrawHypeFromUserAgentWallet,
    getBotVaultForBot,
    ensureBotVaultForBot,
    fundBotVault,
    previewClaimProfit,
    claimProfit,
    finalizeMarginAdd,
    reduceMargin,
    endBotVault,
    controllerCloseBotVault,
    controllerRecoverClosedBotVault
  };
}

export type BotVaultV3Service = ReturnType<typeof createBotVaultV3Service>;

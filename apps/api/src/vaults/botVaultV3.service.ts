import crypto from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, isAddress, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger as defaultLogger } from "../logger.js";
import { decryptSecret } from "../secret-crypto.js";
import { cancelAllOrders, closePositionsMarket, createPerpExecutionAdapter, type TradingAccount } from "../trading.js";
import { HyperliquidSpotClient, isHyperliquidSpotTestnet } from "../spot/hyperliquid-spot.client.js";
import { resolveWalletReadConfig } from "../wallet/config.js";
import { createApiAgentSecretProvider, type AgentSecretProvider as ApiAgentSecretProvider } from "./agentSecretProvider.js";
import { encryptSecret } from "../secret-crypto.js";
import { resolveHyperEvmWriteRpcUrl } from "./onchainAddressBook.js";
import { botVaultFactoryV3Abi, botVaultV3Abi } from "./onchainAbi.js";

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
  readHyperliquidSpotUsdcBalance?: ((address: `0x${string}`) => Promise<string>) | null;
  createPerpExecutionAdapter?: ((account: TradingAccount) => any) | null;
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

type BotVaultV3ExitSpotBalance = {
  coin?: string;
  asset?: string;
  available?: string | number;
  frozen?: string | number;
  locked?: string | number;
  lock?: string | number;
};

type BotVaultV3ExitSpotSymbol = {
  symbol: string;
  exchangeSymbol?: string;
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
  getBalances(): Promise<BotVaultV3ExitSpotBalance[]>;
  listSymbols(): Promise<BotVaultV3ExitSpotSymbol[]>;
  getLastPrice(symbol: string): Promise<number | null>;
  placeOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
  }): Promise<{ orderId: string }>;
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

function readSpotAvailableBalance(rows: BotVaultV3ExitSpotBalance[], symbol: string): number {
  const normalizedTarget = String(symbol ?? "").trim().toUpperCase();
  for (const row of Array.isArray(rows) ? rows : []) {
    const asset = String(row?.asset ?? row?.coin ?? "").trim().toUpperCase();
    if (asset !== normalizedTarget) continue;
    return toNonNegativeFinite(row?.available);
  }
  return 0;
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

function computeClaimableProfitUsd(row: {
  availableUsd?: unknown;
  principalAllocated?: unknown;
  principalReturned?: unknown;
}): number {
  const availableUsd = toNonNegativeNumber(row.availableUsd);
  const principalOutstanding = Math.max(
    0,
    toNonNegativeNumber(row.principalAllocated) - toNonNegativeNumber(row.principalReturned)
  );
  return roundUsd(Math.max(0, availableUsd - principalOutstanding));
}

function toNormalizedDecimalString(value: unknown, fallback = "0"): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : fallback;
}

function toNonNegativeFinite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

async function readHyperliquidSpotUsdcBalance(address: `0x${string}`): Promise<string> {
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
  tokens.forEach((entry: unknown, index: number) => {
    const name = pickString(entry, ["name", "coin", "symbol", "tokenName"]);
    if (name) {
      tokenNameByIndex.set(index, name.toUpperCase());
    }
  });

  const balancesRaw = Array.isArray(stateRaw?.balances)
    ? stateRaw.balances
    : Array.isArray(spotStateRaw?.balances)
      ? spotStateRaw.balances as unknown[]
      : Array.isArray(stateRaw?.tokenBalances)
        ? stateRaw.tokenBalances
        : [];

  for (const entry of balancesRaw) {
    const tokenIndex = pickNumber(entry, ["token", "tokenId", "coinIndex"]);
    const tokenName = tokenIndex === null ? null : tokenNameByIndex.get(tokenIndex);
    const symbol = (
      pickString(entry, ["coin", "symbol", "tokenName", "name"])
      ?? tokenName
      ?? ""
    ).toUpperCase();
    if (symbol !== "USDC") continue;
    return toNormalizedDecimalString(pickString(entry, ["total", "balance", "sz", "amount", "available"]), "0");
  }
  return "0";
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

  if (snapshot.status === "CLOSED") {
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
  const readHyperliquidSpotUsdcBalanceLive = deps?.readHyperliquidSpotUsdcBalance ?? readHyperliquidSpotUsdcBalance;
  const createPerpExecutionAdapterImpl = deps?.createPerpExecutionAdapter ?? createPerpExecutionAdapter;
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
  }): Promise<void> {
    const spotClient = createVaultSpotClientImpl(params.account);
    if (!spotClient) return;

    const targetHype = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
    const maxUsdcSpend = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_MAX_USDC_SPEND", 1);
    if (targetHype <= 0 || maxUsdcSpend <= 0) return;
    const balancesBefore = await spotClient.getBalances();
    const hypeBefore = readSpotAvailableBalance(balancesBefore, "HYPE");
    if (hypeBefore >= targetHype - 0.0000001) return;

    const spotUsdcBefore = readSpotAvailableBalance(balancesBefore, "USDC");
    const spendBudgetUsd = Math.min(spotUsdcBefore, maxUsdcSpend);
    if (spendBudgetUsd <= 0.000001) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_usdc_missing");
    }

    const hypeUsdcMarket = findSpotSymbol(await spotClient.listSymbols(), "HYPE", "USDC");
    if (!hypeUsdcMarket?.symbol) {
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

    await spotClient.placeOrder({
      symbol: hypeUsdcMarket.symbol,
      side: "buy",
      type: "market",
      qty: buyQty
    });
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
  }): Promise<void> {
    const context = await loadExecutionCloseoutContext(params);
    if (!context?.exchangeAccount || !context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      return;
    }
    const agentCredentials = context.agentWallet
      ? await agentSecretProvider.getAgentCredentials({
          userId: context.userId,
          botVaultId: context.id,
          agentWalletAddress: context.agentWallet,
          agentWalletVersion: context.agentWalletVersion,
          agentSecretRef: context.agentSecretRef
        }).catch(() => null)
      : null;
    const account: TradingAccount = {
      id: context.exchangeAccount.id,
      userId: context.userId,
      exchange: context.exchangeAccount.exchange,
      label: `${context.exchangeAccount.exchange}:${context.id}`,
      apiKey: agentCredentials?.address ?? decryptSecretValue(context.exchangeAccount.apiKeyEnc).trim(),
      apiSecret: agentCredentials?.privateKey ?? decryptSecretValue(context.exchangeAccount.apiSecretEnc).trim(),
      passphrase: context.executionVaultAddress
        ?? (context.exchangeAccount.passphraseEnc ? decryptSecretValue(context.exchangeAccount.passphraseEnc).trim() : null),
      botVaultAddress: context.executionVaultAddress,
      marketDataExchangeAccountId: null
    };
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const symbol = context.symbol ?? undefined;
    const logSettlementStepFailure = (step: string, error: unknown) => {
      logger.warn("bot_vault_v3_hypercore_exit_settlement_step_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        step,
        error: String(error)
      });
    };
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
          () => adapterAny.transferUsdClass({
            amountUsd: withdrawableUsd,
            toPerp: false
          })
        ).catch((error) => {
          logSettlementStepFailure("transfer_usd_class_to_spot", error);
          return null;
        });
        await sleepImpl(750);
      }

      await retryHyperliquidTransient(
        "ensure_hypercore_exit_gas",
        () => ensureHypercoreExitGas({
          account
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
          () => adapterAny.transferUsdcSpotToEvm({
            amountUsd: spotUsdcUsd
          })
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

  async function claimProfit(params: ClaimProfitParams): Promise<BotVaultV3ClaimProfitResult> {
    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
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

    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);

    const [statusRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceRaw] = await Promise.all([
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
      }) as Promise<bigint>
    ]);

    const status = statusIndexToLabel(statusRaw);
    if (status === "CLOSED") {
      throw new Error("claim_profit_unavailable:vault_closed");
    }

    const principalOutstandingRaw = principalDepositedRaw > principalReturnedRaw
      ? principalDepositedRaw - principalReturnedRaw
      : 0n;
    const claimableProfitRaw = usdcBalanceRaw > principalOutstandingRaw
      ? usdcBalanceRaw - principalOutstandingRaw
      : 0n;
    if (claimableProfitRaw <= 0n) {
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

    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const feeAmountRaw = (requestedAmountRaw * feeRatePctRaw) / 100n;

    const claimTxHash = await walletClient.sendTransaction({
      account,
      chain,
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
      botVaultId: String(botVault.id),
      vaultAddress: vaultAddress as `0x${string}`,
      publicClient,
      usdcAddress
    }).catch(() => undefined);

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      claimTxHash,
      grossAmountAtomic: requestedAmountRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString(),
      principalPortionAtomic: "0"
    };
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
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusBeforeRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceBeforeRaw] = await Promise.all([
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
      }) as Promise<bigint>
    ]);
    const statusBefore = statusIndexToLabel(statusBeforeRaw);
    let closeOnlyTxHash: string | null = null;
    let statusAfterCloseOnly = statusBefore;
    if (statusBefore === "ACTIVE" || statusBefore === "PAUSED" || statusBefore === "FUNDED") {
      closeOnlyTxHash = await walletClient.sendTransaction({
        account,
        chain,
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
      if (statusAfterCloseOnly !== "CLOSE_ONLY") {
        throw new Error(`bot_vault_v3_close_only_failed:${statusAfterCloseOnly}`);
      }
    } else if (statusBefore !== "CLOSE_ONLY" && statusBefore !== "CLOSED") {
      throw new Error(`bot_vault_v3_close_invalid_status:${statusBefore}`);
    }

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
    if (hypercoreExitCheck.requiresExit) {
      await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id)
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

    const principalOutstandingRaw = principalDepositedRaw > principalReturnedRaw
      ? principalDepositedRaw - principalReturnedRaw
      : 0n;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const profitComponentRaw = usdcBalanceRaw > principalOutstandingRaw
      ? usdcBalanceRaw - principalOutstandingRaw
      : 0n;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;
    const closeTxHash = await walletClient.sendTransaction({
      account,
      chain,
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "closeVault",
        args: [principalOutstandingRaw, usdcBalanceRaw, feeAmountRaw]
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
    const principalReturnedUsd = formatUsdAtomicToNumber(principalOutstandingRaw);
    const feeAmountUsd = formatUsdAtomicToNumber(feeAmountRaw);
    const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd));
    const netReturnedUsd = roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd));

    await resyncBotVaultV3StateFromChain({
      botVaultId: String(botVault.id),
      vaultAddress: vaultAddress as `0x${string}`,
      publicClient,
      usdcAddress
    }).catch(async () => {
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
    });

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      closeOnlyTxHash,
      closeTxHash,
      onchainStatusBefore: statusBefore,
      onchainStatusAfterCloseOnly: statusAfterCloseOnly,
      principalToReturnAtomic: principalOutstandingRaw.toString(),
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
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceRaw] = await Promise.all([
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
      }) as Promise<bigint>
    ]);
    const status = statusIndexToLabel(statusRaw);
    if (status !== "CLOSE_ONLY" && status !== "CLOSED") {
      throw new Error(`bot_vault_v3_recovery_requires_close_only_or_closed_status:${status}`);
    }
    if (usdcBalanceRaw <= 0n) {
      throw new Error("bot_vault_v3_recovery_no_vault_balance");
    }
    const principalOutstandingRaw = principalDepositedRaw > principalReturnedRaw
      ? principalDepositedRaw - principalReturnedRaw
      : 0n;
    const principalToReturnRaw = principalOutstandingRaw > usdcBalanceRaw ? usdcBalanceRaw : principalOutstandingRaw;
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;

    const recoverTxHash = await walletClient.sendTransaction({
      account,
      chain,
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

    await resyncBotVaultV3StateFromChain({
      botVaultId: String(botVault.id),
      vaultAddress: vaultAddress as `0x${string}`,
      publicClient,
      usdcAddress
    }).catch(async () => {
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
    });

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
    claimProfit,
    endBotVault,
    controllerCloseBotVault,
    controllerRecoverClosedBotVault
  };
}

export type BotVaultV3Service = ReturnType<typeof createBotVaultV3Service>;

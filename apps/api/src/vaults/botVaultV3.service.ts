import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, isAddress, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveWalletReadConfig } from "../wallet/config.js";
import { createApiAgentSecretProvider, type AgentSecretProvider as ApiAgentSecretProvider } from "./agentSecretProvider.js";
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
  fundingStatus: string;
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

function formatUsdAtomicToNumber(value: bigint): number {
  return roundUsd(Number(formatUnits(value, 6)), 6);
}

function toAtomicUsd(value: number): bigint {
  const rounded = roundUsd(toNonNegativeNumber(value), 6);
  return parseUnits(rounded.toFixed(6), 6);
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

async function readHyperliquidClearinghouseState(
  address: `0x${string}`
): Promise<HyperliquidClearinghouseState> {
  const baseUrl = String(process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz").trim();
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: "clearinghouseState",
      user: address
    })
  });
  if (!response.ok) {
    throw new Error(`hyperliquid_clearinghouse_state_failed:${response.status}`);
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return {
    withdrawable: toNormalizedDecimalString(payload?.withdrawable, "0"),
    accountValue: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.accountValue, "0"),
    totalMarginUsed: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.totalMarginUsed, "0"),
    assetPositions: Array.isArray(payload?.assetPositions) ? payload!.assetPositions as unknown[] : []
  };
}

async function readHyperliquidSpotUsdcBalance(address: `0x${string}`): Promise<string> {
  const baseUrl = String(process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz").trim();
  const [stateResponse, metaResponse] = await Promise.all([
    fetch(`${baseUrl}/info`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "spotClearinghouseState",
        user: address
      })
    }),
    fetch(`${baseUrl}/info`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "spotMeta"
      })
    })
  ]);
  if (!stateResponse.ok) {
    throw new Error(`hyperliquid_spot_state_failed:${stateResponse.status}`);
  }
  if (!metaResponse.ok) {
    throw new Error(`hyperliquid_spot_meta_failed:${metaResponse.status}`);
  }
  const stateRaw = await stateResponse.json().catch(() => null) as Record<string, unknown> | null;
  const spotMetaRaw = await metaResponse.json().catch(() => null) as Record<string, unknown> | null;
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
    canClaim: hasOnchainVault && status !== "CLOSED" && claimableProfitUsd > 0.000001,
    canClose: hasOnchainVault && (status === "FUNDED" || status === "ACTIVE" || status === "PAUSED" || status === "CLOSE_ONLY"),
    canRecover: hasOnchainVault && fundingConfirmedOnchain && status === "CLOSED",
    canSetAgentWallet: true
  };
}

export function buildBotVaultV3HealthSummary(row: any): BotVaultV3HealthSummary {
  const { onchainBotVaultAddress, agentWalletAddress } = readBotVaultV3AddressSemantics(row);
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const fundingStatus = String(row?.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(row?.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const fundingConfirmedOnchain =
    actionFlags.fundingConfirmedOnchain
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded";
  const onchainStateKnown = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));

  let lifecycleStatus = "created";
  if (status === "ACTIVE") lifecycleStatus = "active";
  else if (status === "PAUSED") lifecycleStatus = "paused";
  else if (status === "CLOSE_ONLY") lifecycleStatus = "close_only";
  else if (status === "CLOSED") lifecycleStatus = "closed";
  else if (status === "FUNDED") lifecycleStatus = "funded";
  else if (fundingStatus === "hyper_evm_funding_requested") lifecycleStatus = "funding_requested";
  else if (status === "DEPLOYED") lifecycleStatus = onchainStateKnown ? "deployed" : "created";

  let fundingHealth = "empty";
  if (fundingStatus === "hyper_evm_funding_requested") fundingHealth = "requested";
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
  else if (lifecycleStatus === "closed") actionState = "closed";

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

  function buildControllerWalletClient(expectedControllerAddress?: string | null) {
    const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
      throw new Error("controller_private_key_missing");
    }
    const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
    const { chain, walletConfig } = buildHyperEvmClient();
    const rpcUrl = String(
      process.env.HYPEREVM_CONTROLLER_RPC_URL
      || process.env.HYPEREVM_RPC_URL_FALLBACK
      || "https://rpc.hypurrscan.io"
    ).trim();
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
    const [statusBeforeRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, usdcBalanceRaw] = await Promise.all([
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

    const hyperCoreState = await readHyperliquidClearinghouseState(vaultAddress as `0x${string}`);
    const hyperCoreWithdrawable = toNonNegativeFinite(hyperCoreState.withdrawable);
    const hyperCoreAccountValue = toNonNegativeFinite(hyperCoreState.accountValue);
    const hyperCoreMarginUsed = toNonNegativeFinite(hyperCoreState.totalMarginUsed);
    const hyperCoreOpenPositions = hyperCoreState.assetPositions.length;
    const hyperCoreSpotUsdc = toNonNegativeFinite(await readHyperliquidSpotUsdcBalance(vaultAddress as `0x${string}`));
    if (
      hyperCoreWithdrawable > 0.000001
      || hyperCoreSpotUsdc > 0.000001
      || hyperCoreMarginUsed > 0.000001
      || hyperCoreOpenPositions > 0
      || (hyperCoreAccountValue > 0.000001 && usdcBalanceRaw === 0n)
    ) {
      throw new Error(
        [
          "bot_vault_v3_hypercore_exit_required",
          `withdrawable=${hyperCoreState.withdrawable}`,
          `spotUsdc=${String(hyperCoreSpotUsdc)}`,
          `accountValue=${hyperCoreState.accountValue}`,
          `marginUsed=${hyperCoreState.totalMarginUsed}`,
          `openPositions=${String(hyperCoreOpenPositions)}`
        ].join(":")
      );
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
          status: "CLOSED",
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
    if (status !== "CLOSED") {
      throw new Error(`bot_vault_v3_recovery_requires_closed_status:${status}`);
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
          status: "CLOSED"
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

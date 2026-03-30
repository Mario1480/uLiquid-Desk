import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, isAddress, parseEther } from "viem";
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
  controllerAddress: string | null;
  vaultAddress: string | null;
  agentWallet: string | null;
  agentWalletVersion: number;
  agentSecretRef: string | null;
  allocatedUsd: number;
  availableUsd: number;
  withdrawnUsd: number;
  claimedProfitUsd: number;
  feePaidTotal: number;
  fundingStatus: string;
  hypercoreFundingStatus: string;
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
  recoverTxHash: string;
  principalToReturnAtomic: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
};

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

function buildOnchainActionRequiredError(action: "claim_profit" | "end"): Error {
  return new Error(
    [
      "bot_vault_onchain_action_required",
      action,
      "settle via the BotVaultV3 onchain/grid flow first",
      "perp_to_spot",
      "spot_to_evm",
      "then claim or close on HyperEVM"
    ].join(":")
  );
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

function mapBotVaultSummary(row: any): BotVaultV3Summary {
  return {
    id: String(row.id),
    botId: String(row.botId),
    userId: String(row.userId),
    vaultModel: String(row.vaultModel ?? "bot_vault_v3"),
    beneficiaryAddress: toNullableString(row.beneficiaryAddress),
    controllerAddress: toNullableString(row.controllerAddress),
    vaultAddress: toNullableString(row.vaultAddress),
    agentWallet: toNullableString(row.agentWallet),
    agentWalletVersion: Math.max(1, Math.trunc(Number(row.agentWalletVersion ?? 1) || 1)),
    agentSecretRef: toNullableString(row.agentSecretRef),
    allocatedUsd: toNonNegativeNumber(row.allocatedUsd),
    availableUsd: toNonNegativeNumber(row.availableUsd),
    withdrawnUsd: toNonNegativeNumber(row.withdrawnUsd),
    claimedProfitUsd: toNonNegativeNumber(row.claimedProfitUsd),
    feePaidTotal: toNonNegativeNumber(row.feePaidTotal),
    fundingStatus: String(row.fundingStatus ?? "vault_empty"),
    hypercoreFundingStatus: String(row.hypercoreFundingStatus ?? "not_funded"),
    executionStatus: toNullableString(row.executionStatus),
    status: String(row.status ?? "ACTIVE"),
    claimableProfitUsd: computeClaimableProfitUsd(row),
    endedAt: row.endedAt instanceof Date ? row.endedAt.toISOString() : toNullableString(row.endedAt),
    closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : toNullableString(row.closedAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : toNullableString(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : toNullableString(row.updatedAt)
  };
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
    const moveToHyperCore = params.moveToHyperCore !== false;
    const updated = await db.botVault.update({
      where: { id: current.id },
      data: {
        principalAllocated: { increment: amountUsd },
        allocatedUsd: { increment: amountUsd },
        availableUsd: { increment: amountUsd },
        fundingStatus: "hyper_evm_funded",
        hypercoreFundingStatus: moveToHyperCore ? "funded" : "pending",
        executionStatus: moveToHyperCore ? "funded" : "created"
      }
    });
    return mapBotVaultSummary(updated);
  }

  async function claimProfit(params: ClaimProfitParams) {
    await ensureBotVaultForBot({ userId: params.userId, botId: params.botId });
    throw buildOnchainActionRequiredError("claim_profit");
  }

  async function endBotVault(params: EndBotVaultParams) {
    await ensureBotVaultForBot({ userId: params.userId, botId: params.botId });
    throw buildOnchainActionRequiredError("end");
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
    const erc20BalanceOfAbi = [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
      }
    ] as const;

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
    if (
      hyperCoreWithdrawable > 0.000001
      || hyperCoreMarginUsed > 0.000001
      || hyperCoreOpenPositions > 0
      || (hyperCoreAccountValue > 0.000001 && usdcBalanceRaw === 0n)
    ) {
      throw new Error(
        [
          "bot_vault_v3_hypercore_exit_required",
          `withdrawable=${hyperCoreState.withdrawable}`,
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

    await db.botVault.update({
      where: { id: String(botVault.id) },
      data: {
        status: "CLOSED",
        endedAt: new Date(),
        closedAt: new Date()
      }
    }).catch(() => undefined);

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
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
    const erc20BalanceOfAbi = [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
      }
    ] as const;

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

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
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

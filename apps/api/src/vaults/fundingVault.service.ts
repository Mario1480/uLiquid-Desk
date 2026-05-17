import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  keccak256,
  pad,
  parseEther,
  parseUnits,
  toHex,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fundingVaultFactoryV1Abi, fundingVaultV1Abi } from "./onchainAbi.js";
import {
  resolveFundingVaultFactoryAddress,
  resolveHyperEvmWriteRpcUrl,
  resolveOnchainAddressBook
} from "./onchainAddressBook.js";
import { getEffectiveVaultExecutionMode, isOnchainMode, type VaultExecutionMode } from "./executionMode.js";
import { createApiAgentSecretProvider, type AgentSecretProvider } from "./agentSecretProvider.js";
import { GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY, parseVaultSafetyControls } from "./safetyControls.js";
import type { OnchainActionType, OnchainTxRequest } from "./onchainProvider.types.js";

type FundingVaultServiceDeps = {
  agentSecretProvider?: AgentSecretProvider | null;
};

type FundingVaultConfig = {
  mode: VaultExecutionMode;
  chainId: number;
  rpcUrl: string;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  confirmations: number;
};

type FundingVaultLaunchInput = {
  userId: string;
  fundingVaultId?: string | null;
  botVaultId: string;
  gridInstanceId?: string | null;
  templateId: string;
  botId: string;
  allocationUsd: number;
  controllerAddress: string;
  agentWallet?: string | null;
  platformFeeRatePct?: number | null;
  affiliateFeeRatePct?: number | null;
  affiliateRecipientAddress?: string | null;
  actionKey?: string | null;
};

type FundingVaultFundExistingInput = {
  userId: string;
  fundingVaultId?: string | null;
  botVaultId: string;
  gridInstanceId?: string | null;
  amountUsd: number;
  actionKey?: string | null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return raw as `0x${string}`;
}

function normalizeActionKey(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function toBytes32(value: string): `0x${string}` {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return pad("0x", { size: 32 });
  const hex = toHex(trimmed);
  if ((hex.length - 2) / 2 > 32) return keccak256(hex);
  return pad(hex, { size: 32 });
}

function amountToAtomic(amountUsd: number): bigint {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_amount_usd");
  return parseUnits(amount.toFixed(6), 6);
}

function normalizeTxHash(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("invalid_tx_hash");
  return raw.toLowerCase();
}

function mapActionRow(row: any) {
  return {
    id: String(row.id),
    actionKey: String(row.actionKey),
    actionType: String(row.actionType),
    status: String(row.status),
    userId: row.userId ? String(row.userId) : null,
    masterVaultId: row.masterVaultId ? String(row.masterVaultId) : null,
    fundingVaultId: row.fundingVaultId ? String(row.fundingVaultId) : null,
    botVaultId: row.botVaultId ? String(row.botVaultId) : null,
    chainId: Number(row.chainId),
    txHash: row.txHash ? String(row.txHash) : null,
    toAddress: String(row.toAddress),
    dataHex: String(row.dataHex),
    valueWei: String(row.valueWei),
    metadata: row.metadata ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

function mapFundingVault(row: any, liveBalanceUsd?: number | null) {
  const freeBalance = liveBalanceUsd ?? Number(row?.freeBalance ?? 0);
  const reservedBalance = Number(row?.reservedBalance ?? 0);
  return {
    id: row ? String(row.id) : null,
    userId: row ? String(row.userId) : null,
    onchainAddress: row?.onchainAddress ? String(row.onchainAddress) : null,
    factoryAddress: row?.factoryAddress ? String(row.factoryAddress) : null,
    contractVersion: String(row?.contractVersion ?? "v1"),
    operatorAddress: row?.operatorAddress ? String(row.operatorAddress) : null,
    operatorVersion: Number(row?.operatorVersion ?? 1),
    operatorSecretRef: row?.operatorSecretRef ? String(row.operatorSecretRef) : null,
    freeBalance,
    reservedBalance,
    availableBalance: Math.max(0, freeBalance - reservedBalance),
    totalDeposited: Number(row?.totalDeposited ?? 0),
    totalWithdrawn: Number(row?.totalWithdrawn ?? 0),
    status: String(row?.status ?? "setup_required"),
    lastSyncedAt: row?.lastSyncedAt instanceof Date ? row.lastSyncedAt.toISOString() : null,
    metadata: row?.metadata ?? null,
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

function buildTxRequest(config: FundingVaultConfig, to: `0x${string}`, data: `0x${string}`): OnchainTxRequest {
  return {
    to,
    data,
    value: "0",
    chainId: config.chainId
  };
}

function buildChain(config: FundingVaultConfig) {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 999 ? "HyperEVM" : `HyperEVM-${config.chainId}`,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcUrl] }
    }
  });
}

function createClients(config: FundingVaultConfig, privateKey?: `0x${string}`) {
  const chain = buildChain(config);
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl)
  });
  if (!privateKey) return { chain, publicClient, walletClient: null, account: null };
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(resolveHyperEvmWriteRpcUrl(config.rpcUrl))
  });
  return { chain, publicClient, walletClient, account };
}

export function createFundingVaultService(db: any, deps?: FundingVaultServiceDeps) {
  const agentSecretProvider = deps?.agentSecretProvider ?? createApiAgentSecretProvider();

  async function getMode(): Promise<VaultExecutionMode> {
    return getEffectiveVaultExecutionMode(db);
  }

  async function requireConfig(): Promise<FundingVaultConfig> {
    const mode = await getMode();
    if (!isOnchainMode(mode)) throw new Error("vault_execution_mode_offchain_shadow");
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion: "v4" });
    const factoryAddress = resolveFundingVaultFactoryAddress(mode);
    if (!factoryAddress) throw new Error("funding_vault_factory_address_missing");
    return {
      mode,
      chainId: addressBook.chainId,
      rpcUrl: addressBook.rpcUrl,
      usdcAddress: addressBook.usdcAddress,
      factoryAddress,
      confirmations: addressBook.confirmations
    };
  }

  async function readSafetyControls() {
    if (!db.globalSetting?.findUnique) return parseVaultSafetyControls(null);
    const row = await db.globalSetting.findUnique({
      where: { key: GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY },
      select: { value: true }
    }).catch(() => null);
    return parseVaultSafetyControls(row?.value);
  }

  async function getUserForFundingVault(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        walletAddress: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true
      }
    });
    if (!user) throw new Error("user_not_found");
    return user;
  }

  async function ensureFundingVaultRow(params: {
    userId: string;
    config?: FundingVaultConfig | null;
  }) {
    const user = await getUserForFundingVault(params.userId);
    const operatorAddress = normalizeAddress(user.agentWallet);
    const existing = await db.fundingVault.findUnique({
      where: { userId: params.userId }
    }).catch(() => null);
    if (existing) {
      const nextData: Record<string, unknown> = {};
      if (params.config?.factoryAddress && String(existing.factoryAddress ?? "") !== params.config.factoryAddress) {
        nextData.factoryAddress = params.config.factoryAddress;
      }
      if (operatorAddress && String(existing.operatorAddress ?? "").toLowerCase() !== operatorAddress.toLowerCase()) {
        nextData.operatorAddress = operatorAddress;
        nextData.operatorVersion = Number(user.agentWalletVersion ?? 1);
        nextData.operatorSecretRef = user.agentSecretRef ?? null;
      }
      if (Object.keys(nextData).length > 0) {
        return db.fundingVault.update({
          where: { id: existing.id },
          data: nextData
        });
      }
      return existing;
    }
    return db.fundingVault.create({
      data: {
        userId: params.userId,
        factoryAddress: params.config?.factoryAddress ?? null,
        contractVersion: "v1",
        operatorAddress: operatorAddress ?? null,
        operatorVersion: Number(user.agentWalletVersion ?? 1),
        operatorSecretRef: user.agentSecretRef ?? null,
        status: operatorAddress ? "active" : "operator_missing"
      }
    });
  }

  async function readFundingVaultBalanceUsd(config: FundingVaultConfig, address?: string | null): Promise<number | null> {
    const vaultAddress = normalizeAddress(address);
    if (!vaultAddress) return null;
    const { publicClient } = createClients(config);
    try {
      const raw = await publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vaultAddress]
      }) as bigint;
      return Number(formatUnits(raw, 6));
    } catch {
      return null;
    }
  }

  async function syncFundingVaultBalance(params: { fundingVaultId: string; config: FundingVaultConfig }) {
    const row = await db.fundingVault.findUnique({
      where: { id: params.fundingVaultId }
    });
    if (!row) throw new Error("funding_vault_not_found");
    const liveBalance = await readFundingVaultBalanceUsd(params.config, row.onchainAddress);
    if (liveBalance == null) return row;
    return db.fundingVault.update({
      where: { id: String(row.id) },
      data: {
        freeBalance: liveBalance,
        lastSyncedAt: new Date()
      }
    });
  }

  async function buildAction(params: {
    actionKey: string;
    actionType: OnchainActionType;
    status?: string;
    userId: string;
    fundingVaultId?: string | null;
    botVaultId?: string | null;
    txHash?: string | null;
    txRequest: OnchainTxRequest;
    metadata?: Record<string, unknown> | null;
  }) {
    const existing = await db.onchainAction.findUnique({
      where: { actionKey: params.actionKey }
    }).catch(() => null);
    if (existing) return existing;
    return db.onchainAction.create({
      data: {
        actionKey: params.actionKey,
        actionType: params.actionType,
        status: params.status ?? "prepared",
        userId: params.userId,
        fundingVaultId: params.fundingVaultId ?? null,
        botVaultId: params.botVaultId ?? null,
        chainId: params.txRequest.chainId,
        toAddress: params.txRequest.to,
        dataHex: params.txRequest.data,
        valueWei: params.txRequest.value,
        txHash: params.txHash ? normalizeTxHash(params.txHash) : null,
        metadata: params.metadata ?? null
      }
    });
  }

  async function getOverview(params: { userId: string }) {
    const mode = await getMode();
    let config: FundingVaultConfig | null = null;
    try {
      config = isOnchainMode(mode) ? await requireConfig() : null;
    } catch {
      config = null;
    }
    const user = await getUserForFundingVault(params.userId);
    const row = await ensureFundingVaultRow({ userId: params.userId, config });
    const liveBalance = config ? await readFundingVaultBalanceUsd(config, row.onchainAddress) : null;
    const syncedRow = config && liveBalance != null
      ? await db.fundingVault.update({
          where: { id: String(row.id) },
          data: { freeBalance: liveBalance, lastSyncedAt: new Date() }
        })
      : row;
    return {
      mode,
      fundingVault: mapFundingVault(syncedRow, liveBalance),
      linkedWalletAddress: user.walletAddress ? String(user.walletAddress) : null,
      agentWalletAddress: user.agentWallet ? String(user.agentWallet) : null,
      ready: Boolean(syncedRow?.onchainAddress && user.agentWallet),
      setup: {
        canCreate: Boolean(user.walletAddress && user.agentWallet && config?.factoryAddress && !syncedRow?.onchainAddress),
        needsLinkedWallet: !user.walletAddress,
        needsAgentWallet: !user.agentWallet,
        needsOnchainAddress: !syncedRow?.onchainAddress
      },
      chain: config
        ? {
            chainId: config.chainId,
            usdcAddress: config.usdcAddress,
            factoryAddress: config.factoryAddress
          }
        : null
    };
  }

  async function buildCreateTx(params: { userId: string; actionKey?: string | null }) {
    const config = await requireConfig();
    const user = await getUserForFundingVault(params.userId);
    const ownerAddress = normalizeAddress(user.walletAddress);
    const operatorAddress = normalizeAddress(user.agentWallet);
    if (!ownerAddress) throw new Error("wallet_address_required");
    if (!operatorAddress) throw new Error("agent_wallet_required");
    const fundingVault = await ensureFundingVaultRow({ userId: params.userId, config });
    if (fundingVault.onchainAddress) throw new Error("funding_vault_already_created");
    const data = encodeFunctionData({
      abi: fundingVaultFactoryV1Abi,
      functionName: "createFundingVault",
      args: [operatorAddress]
    });
    const txRequest = buildTxRequest(config, config.factoryAddress, data);
    const action = await buildAction({
      actionKey: normalizeActionKey(params.actionKey, `funding_vault:create:${params.userId}`),
      actionType: "create_funding_vault",
      userId: params.userId,
      fundingVaultId: String(fundingVault.id),
      txRequest,
      metadata: {
        ownerAddress,
        operatorAddress,
        factoryAddress: config.factoryAddress,
        contractVersion: "funding_vault_v1",
        mode: config.mode
      }
    });
    return { ok: true, mode: config.mode, fundingVault: mapFundingVault(fundingVault), action: mapActionRow(action), txRequest };
  }

  async function buildDepositTx(params: { userId: string; amountUsd: number; actionKey?: string | null }) {
    const config = await requireConfig();
    const fundingVault = await ensureFundingVaultRow({ userId: params.userId, config });
    const vaultAddress = normalizeAddress(fundingVault.onchainAddress);
    if (!vaultAddress) throw new Error("funding_vault_onchain_address_missing");
    const amountAtomic = amountToAtomic(params.amountUsd);
    const data = encodeFunctionData({
      abi: fundingVaultV1Abi,
      functionName: "deposit",
      args: [amountAtomic]
    });
    const txRequest = buildTxRequest(config, vaultAddress, data);
    const action = await buildAction({
      actionKey: normalizeActionKey(params.actionKey, `funding_vault:deposit:${params.userId}:${params.amountUsd}`),
      actionType: "deposit_funding_vault",
      userId: params.userId,
      fundingVaultId: String(fundingVault.id),
      txRequest,
      metadata: {
        amountUsd: params.amountUsd,
        amountAtomic: amountAtomic.toString(),
        fundingVaultAddress: vaultAddress,
        contractVersion: "funding_vault_v1",
        mode: config.mode
      }
    });
    return { ok: true, mode: config.mode, fundingVault: mapFundingVault(fundingVault), action: mapActionRow(action), txRequest };
  }

  async function buildOwnerWithdrawTx(params: { userId: string; amountUsd: number; actionKey?: string | null }) {
    const config = await requireConfig();
    const controls = await readSafetyControls();
    if (controls.fundingVaultWithdrawsDisabled || controls.withdrawsDisabled) {
      throw new Error("funding_vault_withdraws_disabled");
    }
    const fundingVault = await ensureFundingVaultRow({ userId: params.userId, config });
    const vaultAddress = normalizeAddress(fundingVault.onchainAddress);
    if (!vaultAddress) throw new Error("funding_vault_onchain_address_missing");
    const amountAtomic = amountToAtomic(params.amountUsd);
    const data = encodeFunctionData({
      abi: fundingVaultV1Abi,
      functionName: "ownerWithdraw",
      args: [amountAtomic]
    });
    const txRequest = buildTxRequest(config, vaultAddress, data);
    const action = await buildAction({
      actionKey: normalizeActionKey(params.actionKey, `funding_vault:owner_withdraw:${params.userId}:${params.amountUsd}`),
      actionType: "withdraw_funding_vault",
      userId: params.userId,
      fundingVaultId: String(fundingVault.id),
      txRequest,
      metadata: {
        amountUsd: params.amountUsd,
        amountAtomic: amountAtomic.toString(),
        fundingVaultAddress: vaultAddress,
        contractVersion: "funding_vault_v1",
        mode: config.mode
      }
    });
    return { ok: true, mode: config.mode, fundingVault: mapFundingVault(fundingVault), action: mapActionRow(action), txRequest };
  }

  async function requireAgentExecutionContext(params: { userId: string; fundingVault: any; config: FundingVaultConfig }) {
    const operatorAddress = normalizeAddress(params.fundingVault.operatorAddress);
    if (!operatorAddress) throw new Error("funding_vault_operator_missing");
    const credentials = await agentSecretProvider.getAgentCredentials({
      userId: params.userId,
      agentWalletAddress: operatorAddress,
      agentWalletVersion: Number(params.fundingVault.operatorVersion ?? 1),
      agentSecretRef: params.fundingVault.operatorSecretRef ?? null
    });
    if (!credentials?.privateKey) throw new Error("agent_wallet_secret_missing");
    const { chain, publicClient, walletClient, account } = createClients(params.config, credentials.privateKey as `0x${string}`);
    if (!walletClient || !account) throw new Error("agent_wallet_client_unavailable");
    if (account.address.toLowerCase() !== operatorAddress.toLowerCase()) throw new Error("agent_wallet_secret_mismatch");
    const minHype = parseEther(String(process.env.FUNDING_VAULT_AGENT_MIN_HYPE ?? "0.001"));
    const hypeBalance = await publicClient.getBalance({ address: operatorAddress });
    if (hypeBalance < minHype) throw new Error("funding_vault_agent_hype_low");
    return { chain, publicClient, walletClient, account, operatorAddress, hypeBalance };
  }

  async function sendAgentAction(params: {
    userId: string;
    fundingVault: any;
    botVaultId?: string | null;
    actionKey: string;
    actionType: OnchainActionType;
    txRequest: OnchainTxRequest;
    metadata: Record<string, unknown>;
    afterSubmitted?: (input: { action: any; txHash: string }) => Promise<void>;
  }) {
    const config = await requireConfig();
    const action = await buildAction({
      actionKey: params.actionKey,
      actionType: params.actionType,
      status: "prepared",
      userId: params.userId,
      fundingVaultId: String(params.fundingVault.id),
      botVaultId: params.botVaultId ?? null,
      txRequest: params.txRequest,
      metadata: params.metadata
    });
    if (action.txHash && String(action.status) === "submitted") {
      return { ok: true, mode: config.mode, action: mapActionRow(action), txHash: String(action.txHash) };
    }
    let submittedTxHash: string | null = null;
    try {
      const context = await requireAgentExecutionContext({ userId: params.userId, fundingVault: params.fundingVault, config });
      const txHash = await context.walletClient.sendTransaction({
        account: context.account,
        chain: context.chain,
        to: params.txRequest.to,
        data: params.txRequest.data as Hex,
        value: 0n
      });
      submittedTxHash = normalizeTxHash(txHash);
      const updated = await db.onchainAction.update({
        where: { id: action.id },
        data: {
          status: "submitted",
          txHash: submittedTxHash,
          metadata: {
            ...(action.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata) ? action.metadata : {}),
            txSubmittedAt: new Date().toISOString(),
            operatorAddress: context.operatorAddress,
            agentHypeBalanceWei: context.hypeBalance.toString()
          }
        }
      });
      try {
        await params.afterSubmitted?.({ action: updated, txHash: submittedTxHash });
      } catch (postSubmitError) {
        await db.onchainAction.update({
          where: { id: action.id },
          data: {
            metadata: {
              ...(updated.metadata && typeof updated.metadata === "object" && !Array.isArray(updated.metadata) ? updated.metadata : {}),
              postSubmitWarning: String(postSubmitError),
              postSubmitWarningAt: new Date().toISOString()
            }
          }
        }).catch(() => undefined);
      }
      return { ok: true, mode: config.mode, action: mapActionRow(updated), txHash: submittedTxHash };
    } catch (error) {
      if (submittedTxHash) throw error;
      await db.onchainAction.update({
        where: { id: action.id },
        data: {
          status: "failed",
          metadata: {
            ...(action.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata) ? action.metadata : {}),
            failedAt: new Date().toISOString(),
            lastError: String(error)
          }
        }
      }).catch(() => undefined);
      throw error;
    }
  }

  async function launchBotVault(params: FundingVaultLaunchInput) {
    const config = await requireConfig();
    const controls = await readSafetyControls();
    if (controls.gridStartsDisabled || controls.fundingVaultLaunchesDisabled) {
      throw new Error("funding_vault_launches_disabled");
    }
    const fundingVault = params.fundingVaultId
      ? await db.fundingVault.findFirst({ where: { id: params.fundingVaultId, userId: params.userId } })
      : await ensureFundingVaultRow({ userId: params.userId, config });
    if (!fundingVault) throw new Error("funding_vault_not_found");
    const vaultAddress = normalizeAddress(fundingVault.onchainAddress);
    if (!vaultAddress) throw new Error("funding_vault_onchain_address_missing");
    await syncFundingVaultBalance({ fundingVaultId: String(fundingVault.id), config }).catch(() => undefined);
    const refreshed = await db.fundingVault.findUnique({ where: { id: String(fundingVault.id) } });
    const requiredUsd = Number(params.allocationUsd);
    if (!Number.isFinite(requiredUsd) || requiredUsd <= 0) throw new Error("invalid_amount_usd");
    const availableUsd = Number(refreshed?.freeBalance ?? 0) - Number(refreshed?.reservedBalance ?? 0);
    if (availableUsd + 1e-9 < requiredUsd) throw new Error("funding_vault_insufficient_usdc");
    const controllerAddress = normalizeAddress(params.controllerAddress);
    const agentWallet = normalizeAddress(params.agentWallet ?? fundingVault.operatorAddress);
    if (!controllerAddress) throw new Error("controller_address_required");
    if (!agentWallet) throw new Error("agent_wallet_required");
    const affiliateRecipient = normalizeAddress(params.affiliateRecipientAddress) ?? ZERO_ADDRESS;
    const amountAtomic = amountToAtomic(requiredUsd);
    const actionKey = normalizeActionKey(params.actionKey, `funding_vault:launch:${params.botVaultId}:${requiredUsd}`);
    const actionId = toBytes32(actionKey);
    const data = encodeFunctionData({
      abi: fundingVaultV1Abi,
      functionName: "launchBotVault",
      args: [
        {
          controller: controllerAddress,
          agentWallet,
          templateId: toBytes32(params.templateId),
          botId: toBytes32(params.botId),
          amount: amountAtomic,
          platformFeeRatePct: BigInt(Math.max(0, Math.trunc(Number(params.platformFeeRatePct ?? 0)))),
          affiliateFeeRatePct: BigInt(Math.max(0, Math.trunc(Number(params.affiliateFeeRatePct ?? 0)))),
          affiliateRecipient
        },
        actionId
      ] as any
    });
    const txRequest = buildTxRequest(config, vaultAddress, data);
    const metadata = {
      fundingSource: "funding_vault",
      fundingVaultAddress: vaultAddress,
      amountUsd: requiredUsd,
      amountAtomic: amountAtomic.toString(),
      templateId: params.templateId,
      botId: params.botId,
      controllerAddress,
      agentWallet,
      platformFeeRatePct: params.platformFeeRatePct ?? 0,
      affiliateFeeRatePct: params.affiliateFeeRatePct ?? 0,
      affiliateRecipientAddress: affiliateRecipient,
      actionId,
      contractVersion: "v4",
      fundingVaultContractVersion: "funding_vault_v1",
      mode: config.mode
    };
    return sendAgentAction({
      userId: params.userId,
      fundingVault,
      botVaultId: params.botVaultId,
      actionKey,
      actionType: "launch_bot_vault_from_funding_vault",
      txRequest,
      metadata,
      afterSubmitted: async ({ action, txHash }) => {
        const now = new Date().toISOString();
        await db.$transaction(async (tx: any) => {
          const botVault = await tx.botVault.findUnique({
            where: { id: params.botVaultId },
            select: { executionMetadata: true }
          });
          const executionMetadata = botVault?.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
            ? botVault.executionMetadata as Record<string, unknown>
            : {};
          await tx.botVault.update({
            where: { id: params.botVaultId },
            data: {
              fundingVaultId: String(fundingVault.id),
              fundingSource: "funding_vault",
              beneficiaryAddress: vaultAddress,
              fundingStatus: "hyper_evm_funding_requested",
              executionStatus: "created",
              executionMetadata: {
                ...executionMetadata,
                fundingSource: "funding_vault",
                fundingVaultId: String(fundingVault.id),
                fundingVaultAddress: vaultAddress,
                beneficiaryAddress: vaultAddress,
                provisioning: {
                  phase: "submitted_waiting_indexer",
                  reason: "agent_signed_funding_vault_launch",
                  idempotencyKey: actionKey,
                  pendingActionId: String(action.id),
                  pendingActionStatus: "submitted",
                  txHash,
                  allocationUsd: requiredUsd,
                  startedAt: now
                }
              }
            }
          });
          if (params.gridInstanceId) {
            await tx.gridBotInstance.update({
              where: { id: params.gridInstanceId },
              data: {
                state: "funding_pending",
                stateJson: {
                  provisioning: {
                    phase: "submitted_waiting_indexer",
                    reason: "agent_signed_funding_vault_launch",
                    idempotencyKey: actionKey,
                    pendingActionId: String(action.id),
                    pendingActionStatus: "submitted",
                    walletSignatureRequired: false,
                    txHash,
                    startedAt: now
                  }
                },
                lastPlanError: null
              }
            });
          }
          await tx.fundingVault.update({
            where: { id: String(fundingVault.id) },
            data: {
              reservedBalance: { increment: requiredUsd }
            }
          }).catch(() => undefined);
        });
      }
    });
  }

  async function fundExistingBotVault(params: FundingVaultFundExistingInput) {
    const config = await requireConfig();
    const controls = await readSafetyControls();
    if (controls.gridStartsDisabled || controls.fundingVaultLaunchesDisabled) {
      throw new Error("funding_vault_launches_disabled");
    }
    const fundingVault = params.fundingVaultId
      ? await db.fundingVault.findFirst({ where: { id: params.fundingVaultId, userId: params.userId } })
      : await ensureFundingVaultRow({ userId: params.userId, config });
    if (!fundingVault) throw new Error("funding_vault_not_found");
    const vaultAddress = normalizeAddress(fundingVault.onchainAddress);
    if (!vaultAddress) throw new Error("funding_vault_onchain_address_missing");
    await syncFundingVaultBalance({ fundingVaultId: String(fundingVault.id), config }).catch(() => undefined);
    const refreshed = await db.fundingVault.findUnique({ where: { id: String(fundingVault.id) } });
    const requiredUsd = Number(params.amountUsd);
    if (!Number.isFinite(requiredUsd) || requiredUsd <= 0) throw new Error("invalid_amount_usd");
    const availableUsd = Number(refreshed?.freeBalance ?? 0) - Number(refreshed?.reservedBalance ?? 0);
    if (availableUsd + 1e-9 < requiredUsd) throw new Error("funding_vault_insufficient_usdc");
    const botVault = await db.botVault.findFirst({
      where: { id: params.botVaultId, userId: params.userId }
    });
    const botVaultAddress = normalizeAddress(botVault?.vaultAddress);
    if (!botVault || !botVaultAddress) throw new Error("bot_vault_onchain_address_missing");
    const amountAtomic = amountToAtomic(params.amountUsd);
    const actionKey = normalizeActionKey(params.actionKey, `funding_vault:fund_existing:${params.botVaultId}:${params.amountUsd}`);
    const actionId = toBytes32(actionKey);
    const data = encodeFunctionData({
      abi: fundingVaultV1Abi,
      functionName: "fundExistingBotVault",
      args: [botVaultAddress, amountAtomic, actionId]
    });
    const txRequest = buildTxRequest(config, vaultAddress, data);
    return sendAgentAction({
      userId: params.userId,
      fundingVault,
      botVaultId: params.botVaultId,
      actionKey,
      actionType: "fund_bot_vault_from_funding_vault",
      txRequest,
      metadata: {
        fundingSource: "funding_vault",
        fundingVaultAddress: vaultAddress,
        botVaultAddress,
        amountUsd: params.amountUsd,
        amountAtomic: amountAtomic.toString(),
        actionId,
        contractVersion: "v4",
        fundingVaultContractVersion: "funding_vault_v1",
        mode: config.mode
      },
      afterSubmitted: async ({ action, txHash }) => {
        await db.$transaction(async (tx: any) => {
          if (params.gridInstanceId) {
            await tx.gridBotInstance.update({
              where: { id: params.gridInstanceId },
              data: {
                state: "funding_pending",
                stateJson: {
                  provisioning: {
                    phase: "submitted_waiting_reserve_indexer",
                    reason: "agent_signed_funding_vault_refill",
                    idempotencyKey: actionKey,
                    pendingActionId: String(action.id),
                    pendingActionStatus: "submitted",
                    walletSignatureRequired: false,
                    txHash,
                    startedAt: new Date().toISOString()
                  }
                }
              }
            }).catch(() => undefined);
          }
          await tx.fundingVault.update({
            where: { id: String(fundingVault.id) },
            data: {
              reservedBalance: { increment: params.amountUsd }
            }
          }).catch(() => undefined);
        });
      }
    });
  }

  async function agentWithdrawToOwner(params: { userId: string; amountUsd: number; actionKey?: string | null }) {
    const config = await requireConfig();
    const controls = await readSafetyControls();
    if (controls.fundingVaultWithdrawsDisabled || controls.withdrawsDisabled) {
      throw new Error("funding_vault_withdraws_disabled");
    }
    const fundingVault = await ensureFundingVaultRow({ userId: params.userId, config });
    const vaultAddress = normalizeAddress(fundingVault.onchainAddress);
    if (!vaultAddress) throw new Error("funding_vault_onchain_address_missing");
    const amountAtomic = amountToAtomic(params.amountUsd);
    const actionKey = normalizeActionKey(params.actionKey, `funding_vault:agent_withdraw:${params.userId}:${params.amountUsd}`);
    const actionId = toBytes32(actionKey);
    const data = encodeFunctionData({
      abi: fundingVaultV1Abi,
      functionName: "operatorWithdrawToOwner",
      args: [amountAtomic, actionId]
    });
    const txRequest = buildTxRequest(config, vaultAddress, data);
    return sendAgentAction({
      userId: params.userId,
      fundingVault,
      actionKey,
      actionType: "agent_withdraw_funding_vault",
      txRequest,
      metadata: {
        fundingSource: "funding_vault",
        fundingVaultAddress: vaultAddress,
        amountUsd: params.amountUsd,
        amountAtomic: amountAtomic.toString(),
        actionId,
        contractVersion: "funding_vault_v1",
        mode: config.mode
      }
    });
  }

  return {
    getMode,
    getOverview,
    buildCreateTx,
    buildDepositTx,
    buildOwnerWithdrawTx,
    agentWithdrawToOwner,
    launchBotVault,
    fundExistingBotVault,
    syncFundingVaultBalance
  };
}

export type FundingVaultService = ReturnType<typeof createFundingVaultService>;

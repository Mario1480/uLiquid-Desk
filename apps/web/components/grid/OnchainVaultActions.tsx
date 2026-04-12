"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { encodeFunctionData, erc20Abi, parseUnits, type Hex } from "viem";
import {
  useAccount,
  useConnection,
  useSendTransaction,
  useWaitForTransactionReceipt
} from "wagmi";
import { getPublicClient, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import { apiGet, apiPost } from "../../lib/api";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../lib/web3/config";
import { getWalletFeatureConfig } from "../../lib/wallet/config";
import { buildBotVaultFundingBreakdown } from "./botVaultFunding";
import type {
  BotVaultSnapshot,
  GridInstance,
  MeResponse,
  OnchainActionItem,
  OnchainBuildActionResponse,
  UserOnchainActionsResponse
} from "./types";
import { createIdempotencyKey, errMsg, formatDateTime, formatNumber, normalizeGridProvisioningPhase } from "./utils";
import { hasExistingOnchainBotVault } from "../../src/grid/botVaultState";

function shortAddress(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "n/a";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function normalizeAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function buildActionKey(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function actionLabel(actionType: string): string {
  switch (actionType) {
    case "create_master_vault":
      return "Create MasterVault";
    case "deposit_master_vault":
      return "Deposit";
    case "withdraw_master_vault":
      return "Withdraw";
    case "create_bot_vault":
      return "Create BotVault";
    case "reserve_for_bot_vault":
      return "Reserve for BotVault";
    case "fund_bot_vault_hypercore":
      return "Fund BotVault on HyperCore";
    case "set_bot_vault_close_only":
      return "Set BotVault Close-only";
    case "claim_from_bot_vault":
      return "Claim";
    case "close_bot_vault":
      return "Close";
    case "recover_closed_bot_vault":
      return "Recover closed vault";
    case "set_treasury_recipient":
      return "Set Treasury";
    case "set_profit_share_fee_rate":
      return "Set Fee Rate";
    default:
      return actionType;
  }
}


function actionStatusTone(status: string): { color: string; borderColor: string } {
  if (status === "confirmed") return { color: "#16a34a", borderColor: "rgba(34,197,94,0.35)" };
  if (status === "submitted") return { color: "#0284c7", borderColor: "rgba(14,165,233,0.35)" };
  if (status === "failed") return { color: "#dc2626", borderColor: "rgba(239,68,68,0.35)" };
  return { color: "#f59e0b", borderColor: "rgba(245,158,11,0.35)" };
}

function resolveGasOverride(actionType: string, txRequest: OnchainBuildActionResponse["txRequest"]): bigint | undefined {
  const explicitGas = String(txRequest.gas ?? "").trim();
  if (explicitGas) {
    try {
      return BigInt(explicitGas);
    } catch {
      // ignore malformed gas hints and fall back to local overrides
    }
  }

  const normalized = String(actionType ?? "").trim().toLowerCase();
  if (normalized === "create_master_vault") {
    // Keep a modest fixed limit for HyperEVM wallet flows without exceeding the block gas limit.
    return BigInt(300_000);
  }
  return undefined;
}

const HYPEREVM_USDC_ADDRESS = getWalletFeatureConfig().usdc.address as `0x${string}` | null;

function parseActionAmountAtomic(action: OnchainActionItem | null | undefined): bigint | null {
  const metadata = action?.metadata;
  const amountAtomicRaw = typeof metadata?.amountAtomic === "string" ? metadata.amountAtomic.trim() : "";
  if (amountAtomicRaw) {
    try {
      return BigInt(amountAtomicRaw);
    } catch {
      return null;
    }
  }
  const amountUsd = Number(metadata?.amountUsd ?? metadata?.allocationUsd ?? NaN);
  if (Number.isFinite(amountUsd) && amountUsd > 0) {
    try {
      return parseUnits(String(amountUsd), 6);
    } catch {
      return null;
    }
  }
  return null;
}

type ActionFlowState =
  | "idle"
  | "requesting_tx"
  | "awaiting_wallet_signature"
  | "submitting_tx_hash"
  | "pending_confirmations"
  | "confirmed";

export function useOnchainActionFlow(onAfterSuccess?: () => Promise<void> | void) {
  const t = useTranslations("grid.onchain");
  const { address, isConnected } = useAccount();
  const connection = useConnection();
  const { sendTransactionAsync, isPending: isWalletPending } = useSendTransaction();

  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const [mode, setMode] = useState<"offchain_shadow" | "onchain_simulated" | "onchain_live">("offchain_shadow");
  const [actions, setActions] = useState<OnchainActionItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flowState, setFlowState] = useState<ActionFlowState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<Hex | undefined>(undefined);

  const receipt = useWaitForTransactionReceipt({
    hash: lastTxHash,
    query: {
      enabled: Boolean(lastTxHash)
    }
  });

  const walletMatches = useMemo(
    () => normalizeAddress(address) !== "" && normalizeAddress(address) === normalizeAddress(linkedWalletAddress),
    [address, linkedWalletAddress]
  );
  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;
  const canSignLiveActions = mode !== "offchain_shadow" && isConnected && walletMatches && !chainMismatch;

  async function load() {
    const [me, onchain] = await Promise.all([
      apiGet<MeResponse>("/auth/me"),
      apiGet<UserOnchainActionsResponse>("/vaults/onchain/actions?limit=25")
    ]);
    const walletAddress = String(me?.walletAddress ?? me?.user?.walletAddress ?? "").trim();
    setLinkedWalletAddress(walletAddress || null);
    setMode(onchain.mode);
    setActions(Array.isArray(onchain.items) ? onchain.items : []);
  }

  useEffect(() => {
    void load().catch((loadError) => setError(errMsg(loadError)));
  }, []);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    setFlowState("confirmed");
    setNotice(t("messages.walletConfirmedIndexerPending"));
    void load().catch(() => undefined);
    void Promise.resolve(onAfterSuccess?.()).catch(() => undefined);
  }, [receipt.isSuccess, onAfterSuccess, t]);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 9;

    async function refresh() {
      if (cancelled) return;
      await load().catch(() => undefined);
      await Promise.resolve(onAfterSuccess?.()).catch(() => undefined);
      attempt += 1;
      if (cancelled || attempt >= maxAttempts) return;
      window.setTimeout(() => {
        void refresh();
      }, 5000);
    }

    window.setTimeout(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
    };
  }, [receipt.isSuccess, onAfterSuccess]);

  async function requestChainSwitch() {
    await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
  }

  async function ensureUsdcAllowanceForAction(built: OnchainBuildActionResponse) {
    if (built.action.actionType !== "fund_bot_vault_v3") return;
    if (!address) throw new Error("wallet_address_required");
    if (!HYPEREVM_USDC_ADDRESS) throw new Error("usdc_address_missing");
    const spender = built.txRequest.to as `0x${string}`;
    const amountAtomic = parseActionAmountAtomic(built.action);
    if (!amountAtomic || amountAtomic <= BigInt(0)) throw new Error("amount_atomic_missing");
    const publicClient = getPublicClient(wagmiConfig, { chainId: built.txRequest.chainId });
    if (!publicClient) throw new Error("public_client_missing");

    const allowanceRaw = await (publicClient as any).readContract({
      address: HYPEREVM_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address as `0x${string}`, spender]
    }) as bigint;
    if (allowanceRaw >= amountAtomic) return;

    setNotice(t("messages.waitingApproval"));
    const approvalTxHash = await sendTransactionAsync({
      account: address as `0x${string}`,
      to: HYPEREVM_USDC_ADDRESS,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amountAtomic]
      }),
      value: BigInt(0),
      chainId: built.txRequest.chainId
    });
    try {
      await waitForTransactionReceipt(wagmiConfig, {
        chainId: built.txRequest.chainId,
        hash: approvalTxHash as Hex,
        confirmations: 1
      });
      setNotice(t("messages.approvalConfirmed"));
    } catch (approvalError) {
      const message = String(approvalError);
      if (message.toLowerCase().includes("rejected")) {
        throw new Error(t("messages.approvalRejected"));
      }
      throw new Error(`${t("messages.approvalReverted")}: ${message}`);
    }
  }

  async function markActionFailed(actionId: string, txHash?: string) {
    await apiPost(`/vaults/onchain/actions/${encodeURIComponent(actionId)}/fail-tx`, {
      txHash
    }).catch(() => undefined);
  }

  async function executeAction(params: {
    busyKey: string;
    buildPath: string;
    body: Record<string, unknown>;
  }) {
    setBusyKey(params.busyKey);
    setFlowState("requesting_tx");
    setError(null);
    setNotice(null);
    let built: OnchainBuildActionResponse | null = null;
    let txHash: Hex | null = null;
    try {
      built = await apiPost<OnchainBuildActionResponse>(params.buildPath, params.body);
      setMode(built.mode);
      await ensureUsdcAllowanceForAction(built);
      setFlowState("awaiting_wallet_signature");
      txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: built.txRequest.to as `0x${string}`,
        data: built.txRequest.data as Hex,
        value: BigInt(String(built.txRequest.value ?? "0")),
        chainId: built.txRequest.chainId,
        gas: resolveGasOverride(built.action.actionType, built.txRequest)
      });
      setFlowState("submitting_tx_hash");
      await apiPost(`/vaults/onchain/actions/${encodeURIComponent(built.action.id)}/submit-tx`, {
        txHash,
        idempotencyKey: createIdempotencyKey(`submit-onchain-tx:${built.action.id}`)
      });
      setLastTxHash(txHash as Hex);
      setFlowState("pending_confirmations");
      setNotice(t("messages.txSubmitted"));
      await waitForTransactionReceipt(wagmiConfig, {
        chainId: built.txRequest.chainId,
        hash: txHash as Hex,
        confirmations: 1
      });
      setFlowState("confirmed");
      setNotice(t("messages.walletConfirmedIndexerPending"));
      await load();
      await Promise.resolve(onAfterSuccess?.());
      return true;
    } catch (actionError) {
      if (built?.action?.id && txHash) {
        await markActionFailed(built.action.id, txHash);
        await load().catch(() => undefined);
        await Promise.resolve(onAfterSuccess?.()).catch(() => undefined);
      }
      setFlowState("idle");
      setError(errMsg(actionError));
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function executeBuiltAction(params: {
    busyKey: string;
    built: OnchainBuildActionResponse;
    onBeforeTxSubmittedError?: () => Promise<void> | void;
    awaitConfirmation?: boolean;
    pendingNotice?: string;
    confirmedNotice?: string;
  }) {
    setBusyKey(params.busyKey);
    setFlowState("awaiting_wallet_signature");
    setError(null);
    setNotice(null);
    let txSubmitted = false;
    let txHash: Hex | null = null;
    try {
      setMode(params.built.mode);
      await ensureUsdcAllowanceForAction(params.built);
      txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: params.built.txRequest.to as `0x${string}`,
        data: params.built.txRequest.data as Hex,
        value: BigInt(String(params.built.txRequest.value ?? "0")),
        chainId: params.built.txRequest.chainId,
        gas: resolveGasOverride(params.built.action.actionType, params.built.txRequest)
      });
      txSubmitted = true;
      setFlowState("submitting_tx_hash");
      await apiPost(`/vaults/onchain/actions/${encodeURIComponent(params.built.action.id)}/submit-tx`, {
        txHash,
        idempotencyKey: createIdempotencyKey(`submit-onchain-tx:${params.built.action.id}`)
      });
      setFlowState("pending_confirmations");
      setNotice(params.pendingNotice ?? t("messages.txSubmitted"));
      await load();
      await Promise.resolve(onAfterSuccess?.());
      if (params.awaitConfirmation) {
        await waitForTransactionReceipt(wagmiConfig, {
          chainId: params.built.txRequest.chainId,
          hash: txHash as Hex,
          confirmations: 1
        });
        setFlowState("confirmed");
        setNotice(params.confirmedNotice ?? t("messages.walletConfirmedIndexerPending"));
        await load();
        await Promise.resolve(onAfterSuccess?.());
        return true;
      }
      setLastTxHash(txHash as Hex);
      return true;
    } catch (actionError) {
      if (txSubmitted && txHash) {
        await markActionFailed(params.built.action.id, txHash);
        await load().catch(() => undefined);
        await Promise.resolve(onAfterSuccess?.()).catch(() => undefined);
      }
      if (!txSubmitted) {
        await Promise.resolve(params.onBeforeTxSubmittedError?.()).catch(() => undefined);
      }
      setFlowState("idle");
      setError(errMsg(actionError));
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  return {
    address: address ?? null,
    linkedWalletAddress,
    isConnected,
    chainId: connection.chainId ?? null,
    chainMismatch,
    walletMatches,
    mode,
    actions,
    busyKey,
    flowState,
    isWalletPending,
    error,
    notice,
    canSignLiveActions,
    lastTxHash,
    setError,
    setNotice,
    load,
    requestChainSwitch,
    executeAction,
    executeBuiltAction
  };
}

function OnchainActionTimeline({
  t,
  items
}: {
  t: ReturnType<typeof useTranslations>;
  items: OnchainActionItem[];
}) {
  if (items.length === 0) {
    return <div className="settingsMutedText">{t("noRecentActions")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((item) => {
        const tone = actionStatusTone(item.status);
        return (
          <div
            key={item.id}
            className="card"
            style={{ padding: 10, borderColor: tone.borderColor }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>{actionLabel(item.actionType)}</strong>
              <span style={{ color: tone.color, fontSize: 12, fontWeight: 700 }}>{item.status}</span>
            </div>
            <div className="settingsMutedText" style={{ marginTop: 4 }}>
              {t("actionMeta", {
                chainId: String(item.chainId),
                createdAt: formatDateTime(item.createdAt)
              })}
            </div>
            {item.txHash ? (
              <div className="settingsMutedText" style={{ marginTop: 4 }}>
                {t("txHashLabel")}: {shortAddress(item.txHash)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OnchainGuardrailNotice({
  t,
  mode,
  isConnected,
  walletMatches,
  chainMismatch,
  linkedWalletAddress,
  onSwitchNetwork
}: {
  t: ReturnType<typeof useTranslations>;
  mode: string;
  isConnected: boolean;
  walletMatches: boolean;
  chainMismatch: boolean;
  linkedWalletAddress: string | null;
  onSwitchNetwork: () => Promise<void>;
}) {
  if (mode === "offchain_shadow") {
    return <div className="settingsMutedText">{t("modeDisabled")}</div>;
  }
  if (!linkedWalletAddress) {
    return <div className="settingsMutedText">{t("walletLinkRequired")}</div>;
  }
  if (!isConnected) {
    return <div className="settingsMutedText">{t("walletConnectRequired")}</div>;
  }
  if (!walletMatches) {
    return (
      <div className="settingsMutedText">
        {t("walletMismatch", { wallet: shortAddress(linkedWalletAddress) })}
      </div>
    );
  }
  if (chainMismatch) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="settingsMutedText">{t("wrongNetwork", { chain: TARGET_CHAIN_NAME })}</div>
        <button className="btn" type="button" onClick={() => void onSwitchNetwork()}>
          {t("switchNetwork")}
        </button>
      </div>
    );
  }
  return null;
}

export function MasterVaultOnchainActionsCard() {
  return null;
}

export function BotVaultOnchainActionsCard({
  botVault,
  hasOnchainBotVault,
  defaultAllocationUsd,
  gridInvestUsd,
  extraMarginUsd,
  provisioningStatus,
  onUpdated
}: {
  botVault: BotVaultSnapshot | null | undefined;
  hasOnchainBotVault?: boolean;
  defaultAllocationUsd: number;
  gridInvestUsd: number;
  extraMarginUsd: number;
  provisioningStatus?: GridInstance["provisioningStatus"];
  onUpdated?: () => Promise<void> | void;
}) {
  const t = useTranslations("grid.onchain");
  const flow = useOnchainActionFlow(onUpdated);
  const stablecoinLabel = flow.mode === "onchain_live" || flow.mode === "onchain_simulated"
    || botVault?.executionProvider === "hyperliquid_demo"
    || botVault?.executionProvider === "hyperliquid"
    ? "USDC"
    : "USDT";
  const isBotVaultV3 = useMemo(
    () => String(botVault.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3",
    [botVault.vaultModel]
  );
  const fundingBreakdown = useMemo(
    () => buildBotVaultFundingBreakdown({
      investUsd: gridInvestUsd,
      extraMarginUsd,
      includeCreateFee: isBotVaultV3
    }),
    [extraMarginUsd, gridInvestUsd, isBotVaultV3]
  );

  const pendingReserveUsd = useMemo(
    () => Math.max(0, Number(fundingBreakdown.totalFundingUsd ?? 0) - Number(botVault?.allocatedUsd ?? 0)),
    [botVault?.allocatedUsd, fundingBreakdown.totalFundingUsd]
  );
  const fundingReconciledOnchain = useMemo(() => {
    const principalAllocated = Number(botVault?.principalAllocated ?? 0);
    const status = String(botVault?.status ?? "").trim().toUpperCase();
    const executionStatus = String(botVault?.executionStatus ?? "").trim().toLowerCase();
    const phase = normalizeGridProvisioningPhase(provisioningStatus?.phase ?? null);
    return principalAllocated > 0.000001
      || status === "ACTIVE"
      || executionStatus === "running"
      || phase === "execution_active";
  }, [botVault?.executionStatus, botVault?.principalAllocated, botVault?.status, provisioningStatus?.phase]);

  const botActions = useMemo(
    () =>
      flow.actions
        .filter((item) => item.botVaultId === botVault?.id)
        .filter((item) => {
          if (item.actionType !== "fund_bot_vault_v3" || item.status !== "failed") return true;
          return !fundingReconciledOnchain;
        }),
    [flow.actions, botVault?.id, fundingReconciledOnchain]
  );
  const showExistingBotVaultActions = hasExistingOnchainBotVault({
    explicit: hasOnchainBotVault,
    botVault
  });
  const provisioningPhase = useMemo(
    () => normalizeGridProvisioningPhase(provisioningStatus?.phase ?? null),
    [provisioningStatus?.phase]
  );
  const needsInitialReserve = useMemo(() => {
    const status = String(botVault?.status ?? "").trim().toUpperCase();
    if (!botVault?.id || !botVault?.onchainVaultAddress) return false;
    if (status === "CLOSED") return false;
    return pendingReserveUsd > 0.000001;
  }, [botVault?.id, botVault?.onchainVaultAddress, botVault?.status, pendingReserveUsd]);
  const waitingForReserveSignature = provisioningPhase === "pending_reserve_signature";
  const waitingForHypercoreFundingSignature = provisioningPhase === "pending_hypercore_funding_signature";
  const waitingForIndexer =
    provisioningPhase === "submitted_waiting_indexer"
    || provisioningPhase === "submitted_waiting_reserve_indexer"
    || provisioningPhase === "submitted_waiting_hypercore_funding_indexer";

  if (!botVault) return null;

  async function handleReserve() {
    if (!Number.isFinite(pendingReserveUsd) || pendingReserveUsd <= 0) {
      flow.setError(t("messages.invalidAmount"));
      return;
    }
    await flow.executeAction({
      busyKey: "reserve-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/reserve-tx`,
      body: {
        amountUsd: pendingReserveUsd,
        actionKey: buildActionKey(`web-reserve-bot-vault:${botVault.id}`)
      }
    });
  }

  async function handleFundHypercore() {
    await flow.executeAction({
      busyKey: "fund-hypercore-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/fund-hypercore-tx`,
      body: {
        actionKey: buildActionKey(`web-fund-hypercore-bot-vault:${botVault.id}`)
      }
    });
  }

  return (
    <section className="card" style={{ padding: 12, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t("botTitle")}</h3>
      <div className="settingsMutedText" style={{ marginBottom: 10 }}>
        {t("botMeta", {
          status: String(botVault.status ?? "n/a"),
          executionStatus: String(botVault.executionStatus ?? "n/a"),
          mode: flow.mode
        })}
      </div>

      {flow.error ? <div className="settingsAlert settingsAlertError" style={{ marginBottom: 10 }}>{flow.error}</div> : null}
      {flow.notice ? <div className="settingsAlert settingsAlertSuccess" style={{ marginBottom: 10 }}>{flow.notice}</div> : null}

      <OnchainGuardrailNotice
        t={t}
        mode={flow.mode}
        isConnected={flow.isConnected}
        walletMatches={flow.walletMatches}
        chainMismatch={flow.chainMismatch}
        linkedWalletAddress={flow.linkedWalletAddress}
        onSwitchNetwork={flow.requestChainSwitch}
      />

      {(waitingForReserveSignature || waitingForHypercoreFundingSignature || waitingForIndexer) ? (
        <div className="card" style={{ padding: 10, marginBottom: 12, borderColor: "rgba(245,158,11,0.35)" }}>
          <strong>{t("provisioningResumeTitle")}</strong>
          <div className="settingsMutedText" style={{ marginTop: 6, marginBottom: 8 }}>
            {waitingForReserveSignature
              ? t("provisioningResumeReserveHint")
              : waitingForHypercoreFundingSignature
                ? t("provisioningResumeHypercoreHint")
                : t("provisioningResumeIndexerHint")}
          </div>
          {waitingForReserveSignature ? (
            <button
              className="btn btnPrimary"
              type="button"
              disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
              onClick={() => void handleReserve()}
            >
              {flow.busyKey === "reserve-bot-vault" ? t("buildingTx") : t("reserveBotVaultAction")}
            </button>
          ) : null}
          {waitingForHypercoreFundingSignature ? (
            <button
              className="btn btnPrimary"
              type="button"
              disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
              onClick={() => void handleFundHypercore()}
            >
              {flow.busyKey === "fund-hypercore-bot-vault" ? t("buildingTx") : t("fundHypercoreAction")}
            </button>
          ) : null}
        </div>
      ) : null}

      {needsInitialReserve ? (
        <div className="card" style={{ padding: 10, marginBottom: 12, borderColor: "rgba(245,158,11,0.35)" }}>
          <strong>{t("reserveBotVaultAction")}</strong>
          <div className="settingsMutedText" style={{ marginTop: 6, marginBottom: 8 }}>
            {t("reservePendingHint", {
              amount: formatNumber(pendingReserveUsd, 2),
              stablecoin: stablecoinLabel
            })}
          </div>
          {isBotVaultV3 ? (
            <div className="settingsMutedText" style={{ marginTop: -2, marginBottom: 8 }}>
              {t("vaultCreateFeeHint", {
                fee: formatNumber(fundingBreakdown.createFeeUsd, 2),
                stablecoin: stablecoinLabel
              })}
            </div>
          ) : null}
          <button
            className="btn btnPrimary"
            type="button"
            disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
            onClick={() => void handleReserve()}
          >
            {flow.busyKey === "reserve-bot-vault" ? t("buildingTx") : t("reserveBotVaultAction")}
          </button>
        </div>
      ) : null}

      {!showExistingBotVaultActions ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div className="card" style={{ padding: 10 }}>
            <strong>{t("createBotVault")}</strong>
            <div className="settingsMutedText" style={{ marginTop: 6 }}>
              {botVault.lifecycle?.pendingActionType === "create_bot_vault"
                ? t("messages.txSubmitted")
                : t("masterCreateHint")}
            </div>
            <div className="settingsMutedText" style={{ marginTop: 8 }}>
              {isBotVaultV3
                ? t("allocationDefaultBreakdownWithCreateFee", {
                    total: formatNumber(fundingBreakdown.totalFundingUsd, 2),
                    invest: formatNumber(fundingBreakdown.investUsd, 2),
                    reserve: formatNumber(fundingBreakdown.extraMarginUsd, 2),
                    fee: formatNumber(fundingBreakdown.createFeeUsd, 2),
                    stablecoin: stablecoinLabel
                  })
                : t("allocationDefaultBreakdown", {
                    total: formatNumber(defaultAllocationUsd, 2),
                    invest: formatNumber(gridInvestUsd, 2),
                    reserve: formatNumber(extraMarginUsd, 2),
                    stablecoin: stablecoinLabel
                  })}
            </div>
            {isBotVaultV3 ? (
              <div className="settingsMutedText" style={{ marginTop: 8 }}>
                {t("vaultCreateFeeHint", {
                  fee: formatNumber(fundingBreakdown.createFeeUsd, 2),
                  stablecoin: stablecoinLabel
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div className="card" style={{ padding: 10 }}>
            <strong>{t("endBotOnlyTitle")}</strong>
            <div className="settingsMutedText" style={{ marginTop: 6 }}>
              {t("endBotOnlyHint")}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <strong>{t("recentActionsTitle")}</strong>
        <div style={{ marginTop: 8 }}>
          <OnchainActionTimeline t={t} items={botActions.slice(0, 6)} />
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { erc20Abi, isAddress, parseUnits, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  useConnection,
  useReadContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract
} from "wagmi";
import { switchChain } from "wagmi/actions";
import { apiGet, apiPost } from "../../lib/api";
import { TARGET_CHAIN, TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../lib/web3/config";
import { getWalletFeatureConfig } from "../../lib/wallet/config";
import type {
  BotVaultPnlReport,
  BotVaultSnapshot,
  MasterVaultSummary,
  MeResponse,
  OnchainActionItem,
  OnchainBuildActionResponse,
  UserOnchainActionsResponse
} from "./types";
import { errMsg, formatDateTime, formatNumber } from "./utils";

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
    case "claim_from_bot_vault":
      return "Claim";
    case "close_bot_vault":
      return "Close";
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

function normalizeWriteError(t: ReturnType<typeof useTranslations<"grid.onchain">>, error: unknown, action: "approve" | "deposit") {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("rejected") || normalized.includes("denied")) {
    return action === "approve" ? t("messages.approvalRejected") : t("messages.depositRejected");
  }
  if (normalized.includes("insufficient funds")) {
    return t("messages.insufficientGas");
  }
  if (normalized.includes("revert") || normalized.includes("execution reverted")) {
    return action === "approve" ? t("messages.approvalReverted") : t("messages.depositReverted");
  }
  return raw || t("messages.txSubmitted");
}

type ActionFlowState =
  | "idle"
  | "requesting_tx"
  | "awaiting_wallet_signature"
  | "submitting_tx_hash"
  | "pending_confirmations"
  | "confirmed";

function useOnchainActionFlow(onAfterSuccess?: () => Promise<void> | void) {
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

  async function requestChainSwitch() {
    await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
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
    try {
      const built = await apiPost<OnchainBuildActionResponse>(params.buildPath, params.body);
      setMode(built.mode);
      setFlowState("awaiting_wallet_signature");
      const txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: built.txRequest.to as `0x${string}`,
        data: built.txRequest.data as Hex,
        value: BigInt(String(built.txRequest.value ?? "0")),
        chainId: built.txRequest.chainId
      });
      setFlowState("submitting_tx_hash");
      await apiPost(`/vaults/onchain/actions/${encodeURIComponent(built.action.id)}/submit-tx`, {
        txHash
      });
      setLastTxHash(txHash as Hex);
      setFlowState("pending_confirmations");
      setNotice(t("messages.txSubmitted"));
      await load();
      await Promise.resolve(onAfterSuccess?.());
    } catch (actionError) {
      setFlowState("idle");
      setError(errMsg(actionError));
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
    setError,
    setNotice,
    load,
    requestChainSwitch,
    executeAction
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

export function MasterVaultOnchainActionsCard({
  masterVault,
  onUpdated
}: {
  masterVault: MasterVaultSummary | null;
  onUpdated?: () => Promise<void> | void;
}) {
  const t = useTranslations("grid.onchain");
  const walletConfig = useMemo(() => getWalletFeatureConfig(), []);
  const [depositAmount, setDepositAmount] = useState("100");
  const [approvalHash, setApprovalHash] = useState<Hex | undefined>(undefined);
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();
  const flow = useOnchainActionFlow(onUpdated);
  const connectedAddress = isAddress(flow.address ?? "") ? (flow.address as `0x${string}`) : undefined;
  const usdcAddress = walletConfig.usdc.address && isAddress(walletConfig.usdc.address)
    ? (walletConfig.usdc.address as `0x${string}`)
    : undefined;
  const masterVaultAddress = masterVault?.onchainAddress && isAddress(masterVault.onchainAddress)
    ? (masterVault.onchainAddress as `0x${string}`)
    : undefined;
  const depositAmountAtomic = useMemo(() => {
    try {
      const normalized = depositAmount.trim();
      if (!normalized) return null;
      return parseUnits(normalized, walletConfig.usdc.decimals);
    } catch {
      return null;
    }
  }, [depositAmount, walletConfig.usdc.decimals]);
  const allowanceQuery = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && masterVaultAddress ? [connectedAddress, masterVaultAddress] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(connectedAddress && masterVaultAddress && usdcAddress)
    }
  });
  const usdcBalanceQuery = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(connectedAddress && usdcAddress)
    }
  });
  const hypeBalanceQuery = useBalance({
    address: connectedAddress,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(connectedAddress)
    }
  });
  const approvalReceipt = useWaitForTransactionReceipt({
    hash: approvalHash,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(approvalHash)
    }
  });

  const masterActions = useMemo(
    () => flow.actions.filter((item) => item.masterVaultId === masterVault?.id || item.actionType.includes("master")),
    [flow.actions, masterVault?.id]
  );
  const zero = BigInt(0);
  const allowance = (allowanceQuery.data as bigint | undefined) ?? zero;
  const usdcBalance = (usdcBalanceQuery.data as bigint | undefined) ?? zero;
  const hypeBalance = hypeBalanceQuery.data?.value ?? zero;
  const requiresApproval = Boolean(depositAmountAtomic && depositAmountAtomic > zero && allowance < depositAmountAtomic);
  const insufficientUsdc = Boolean(depositAmountAtomic && depositAmountAtomic > usdcBalance);
  const insufficientGas = Boolean(flow.isConnected && hypeBalance <= zero);
  const isApproveBusy = isWritePending || approvalReceipt.isLoading;

  useEffect(() => {
    if (!approvalReceipt.isSuccess) return;
    setApprovalHash(undefined);
    flow.setError(null);
    flow.setNotice(t("messages.approvalConfirmed"));
    void Promise.all([allowanceQuery.refetch(), usdcBalanceQuery.refetch(), hypeBalanceQuery.refetch()]);
  }, [allowanceQuery, approvalReceipt.isSuccess, flow, hypeBalanceQuery, t, usdcBalanceQuery]);

  useEffect(() => {
    if (!approvalReceipt.isError) return;
    flow.setError(normalizeWriteError(t, approvalReceipt.error, "approve"));
    flow.setNotice(null);
    setApprovalHash(undefined);
  }, [approvalReceipt.error, approvalReceipt.isError, flow, t]);

  async function handleCreateMasterVault() {
    await flow.executeAction({
      busyKey: "create-master-vault",
      buildPath: "/vaults/onchain/master/create-tx",
      body: {
        actionKey: buildActionKey("web-create-master-vault")
      }
    });
  }

  async function handleDeposit() {
    const amountUsd = Number(depositAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !depositAmountAtomic || depositAmountAtomic <= zero) {
      flow.setError(t("messages.invalidAmount"));
      return;
    }
    if (insufficientUsdc) {
      flow.setError(t("messages.insufficientUsdc"));
      return;
    }
    if (insufficientGas) {
      flow.setError(t("messages.insufficientGas"));
      return;
    }
    await flow.executeAction({
      busyKey: "deposit-master-vault",
      buildPath: "/vaults/onchain/master/deposit-tx",
      body: {
        amountUsd,
        actionKey: buildActionKey("web-deposit-master-vault")
      }
    });
  }

  async function handleApprove() {
    if (!connectedAddress || !usdcAddress || !masterVaultAddress) {
      flow.setError(t("walletConnectRequired"));
      return;
    }
    if (flow.chainMismatch) {
      await flow.requestChainSwitch();
      return;
    }
    if (!depositAmountAtomic || depositAmountAtomic <= zero) {
      flow.setError(t("messages.invalidAmount"));
      return;
    }
    if (insufficientUsdc) {
      flow.setError(t("messages.insufficientUsdc"));
      return;
    }
    if (insufficientGas) {
      flow.setError(t("messages.insufficientGas"));
      return;
    }

    try {
      flow.setError(null);
      flow.setNotice(t("messages.waitingApproval"));
      const hash = await writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [masterVaultAddress, depositAmountAtomic],
        account: connectedAddress,
        chainId: TARGET_CHAIN_ID,
        chain: TARGET_CHAIN
      });
      setApprovalHash(hash as Hex);
    } catch (error) {
      flow.setError(normalizeWriteError(t, error, "approve"));
      flow.setNotice(null);
    }
  }

  async function handleWithdraw() {
    const amountUsd = Number(depositAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      flow.setError(t("messages.invalidAmount"));
      return;
    }
    await flow.executeAction({
      busyKey: "withdraw-master-vault",
      buildPath: "/vaults/onchain/master/withdraw-tx",
      body: {
        amountUsd,
        actionKey: buildActionKey("web-withdraw-master-vault")
      }
    });
  }

  return (
    <section className="card" style={{ padding: 12, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t("masterTitle")}</h3>
      <div className="settingsMutedText" style={{ marginBottom: 10 }}>
        {t("modeLine", { mode: flow.mode })}
      </div>

      {flow.error ? <div className="settingsAlert settingsAlertError" style={{ marginBottom: 10 }}>{flow.error}</div> : null}
      {flow.notice ? <div className="settingsAlert settingsAlertSuccess" style={{ marginBottom: 10 }}>{flow.notice}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("linkedWalletLabel")}</strong>
          <div>{shortAddress(flow.linkedWalletAddress)}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("connectedWalletLabel")}</strong>
          <div>{shortAddress(flow.address)}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("masterAddressLabel")}</strong>
          <div>{shortAddress(masterVault?.onchainAddress)}</div>
        </div>
      </div>

      <OnchainGuardrailNotice
        t={t}
        mode={flow.mode}
        isConnected={flow.isConnected}
        walletMatches={flow.walletMatches}
        chainMismatch={flow.chainMismatch}
        linkedWalletAddress={flow.linkedWalletAddress}
        onSwitchNetwork={flow.requestChainSwitch}
      />

      {!masterVault?.onchainAddress ? (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btnPrimary"
            type="button"
            disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
            onClick={() => void handleCreateMasterVault()}
          >
            {flow.busyKey === "create-master-vault" ? t("buildingTx") : t("createMasterVault")}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(180px, 240px) repeat(2, minmax(180px, auto))", gap: 8, alignItems: "end" }}>
          <label>
            {t("depositAmountLabel")}
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
            />
          </label>
          <button
            className="btn btnPrimary"
            type="button"
            disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending || isApproveBusy}
            onClick={() => void (requiresApproval ? handleApprove() : handleDeposit())}
          >
            {isApproveBusy
              ? t("approvingUsdc")
              : flow.busyKey === "deposit-master-vault"
                ? t("buildingTx")
                : requiresApproval
                  ? t("approveUsdc")
                  : t("depositOnchain")}
          </button>
          <button
            className="btn"
            type="button"
            disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending || isApproveBusy}
            onClick={() => void handleWithdraw()}
          >
            {flow.busyKey === "withdraw-master-vault" ? t("buildingTx") : t("withdrawOnchain")}
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <strong>{t("recentActionsTitle")}</strong>
        <div style={{ marginTop: 8 }}>
          <OnchainActionTimeline t={t} items={masterActions.slice(0, 6)} />
        </div>
      </div>
    </section>
  );
}

export function BotVaultOnchainActionsCard({
  botVault,
  defaultAllocationUsd,
  pnlReport,
  onUpdated
}: {
  botVault: BotVaultSnapshot | null | undefined;
  defaultAllocationUsd: number;
  pnlReport: BotVaultPnlReport | null;
  onUpdated?: () => Promise<void> | void;
}) {
  const t = useTranslations("grid.onchain");
  const flow = useOnchainActionFlow(onUpdated);
  const [allocationUsd, setAllocationUsd] = useState(() => String(Math.max(defaultAllocationUsd, 0)));
  const [claimReleasedReservedUsd, setClaimReleasedReservedUsd] = useState("0");
  const [claimReturnedToFreeUsd, setClaimReturnedToFreeUsd] = useState(() =>
    String(Math.max(Number(pnlReport?.netWithdrawableProfit ?? botVault?.withdrawableUsd ?? 0), 0))
  );
  const [closeReleasedReservedUsd, setCloseReleasedReservedUsd] = useState(() => {
    const outstanding = Math.max(Number(botVault?.principalAllocated ?? 0) - Number(botVault?.principalReturned ?? 0), 0);
    return String(outstanding);
  });
  const [closeReturnedToFreeUsd, setCloseReturnedToFreeUsd] = useState(() =>
    String(Math.max(Number(botVault?.availableUsd ?? 0), 0))
  );

  useEffect(() => {
    setAllocationUsd(String(Math.max(defaultAllocationUsd, 0)));
  }, [defaultAllocationUsd, botVault?.id]);

  useEffect(() => {
    setClaimReturnedToFreeUsd(String(Math.max(Number(pnlReport?.netWithdrawableProfit ?? botVault?.withdrawableUsd ?? 0), 0)));
    setCloseReturnedToFreeUsd(String(Math.max(Number(botVault?.availableUsd ?? 0), 0)));
    setCloseReleasedReservedUsd(String(Math.max(Number(botVault?.principalAllocated ?? 0) - Number(botVault?.principalReturned ?? 0), 0)));
  }, [botVault?.id, botVault?.availableUsd, botVault?.principalAllocated, botVault?.principalReturned, botVault?.withdrawableUsd, pnlReport?.netWithdrawableProfit]);

  const botActions = useMemo(
    () => flow.actions.filter((item) => item.botVaultId === botVault?.id),
    [flow.actions, botVault?.id]
  );

  if (!botVault) return null;

  async function handleCreateBotVault() {
    const amountUsd = Number(allocationUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      flow.setError(t("messages.invalidAmount"));
      return;
    }
    await flow.executeAction({
      busyKey: "create-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/create-tx`,
      body: {
        allocationUsd: amountUsd,
        actionKey: buildActionKey(`web-create-bot-vault:${botVault.id}`)
      }
    });
  }

  async function handleClaim() {
    const releasedReservedUsd = Number(claimReleasedReservedUsd);
    const returnedToFreeUsd = Number(claimReturnedToFreeUsd);
    if (!Number.isFinite(releasedReservedUsd) || releasedReservedUsd < 0 || !Number.isFinite(returnedToFreeUsd) || returnedToFreeUsd <= 0) {
      flow.setError(t("messages.invalidClaimValues"));
      return;
    }
    await flow.executeAction({
      busyKey: "claim-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/claim-tx`,
      body: {
        releasedReservedUsd,
        returnedToFreeUsd,
        actionKey: buildActionKey(`web-claim-bot-vault:${botVault.id}`)
      }
    });
  }

  async function handleClose() {
    const releasedReservedUsd = Number(closeReleasedReservedUsd);
    const returnedToFreeUsd = Number(closeReturnedToFreeUsd);
    if (!Number.isFinite(releasedReservedUsd) || releasedReservedUsd < 0 || !Number.isFinite(returnedToFreeUsd) || returnedToFreeUsd < 0) {
      flow.setError(t("messages.invalidCloseValues"));
      return;
    }
    await flow.executeAction({
      busyKey: "close-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/close-tx`,
      body: {
        releasedReservedUsd,
        returnedToFreeUsd,
        actionKey: buildActionKey(`web-close-bot-vault:${botVault.id}`)
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("botVaultAddressLabel")}</strong>
          <div>{shortAddress(botVault.providerMetadataSummary?.vaultAddress ?? null)}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("botAgentWalletLabel")}</strong>
          <div>{shortAddress(botVault.providerMetadataSummary?.agentWallet ?? null)}</div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <strong>{t("botWithdrawableProfitLabel")}</strong>
          <div>{formatNumber(Number(pnlReport?.netWithdrawableProfit ?? botVault.withdrawableUsd ?? 0), 2)} USDT</div>
        </div>
      </div>

      <OnchainGuardrailNotice
        t={t}
        mode={flow.mode}
        isConnected={flow.isConnected}
        walletMatches={flow.walletMatches}
        chainMismatch={flow.chainMismatch}
        linkedWalletAddress={flow.linkedWalletAddress}
        onSwitchNetwork={flow.requestChainSwitch}
      />

      {!botVault.providerMetadataSummary?.vaultAddress ? (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(180px, 240px) auto", gap: 8, alignItems: "end" }}>
          <label>
            {t("allocationAmountLabel")}
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={allocationUsd}
              onChange={(event) => setAllocationUsd(event.target.value)}
            />
          </label>
          <button
            className="btn btnPrimary"
            type="button"
            disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
            onClick={() => void handleCreateBotVault()}
          >
            {flow.busyKey === "create-bot-vault" ? t("buildingTx") : t("createBotVault")}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div className="card" style={{ padding: 10 }}>
            <strong>{t("claimTitle")}</strong>
            <div className="settingsMutedText" style={{ marginTop: 6, marginBottom: 8 }}>
              {t("claimHint")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) auto", gap: 8, alignItems: "end" }}>
              <label>
                {t("releasedReservedLabel")}
                <input className="input" type="number" min="0" step="0.01" value={claimReleasedReservedUsd} onChange={(event) => setClaimReleasedReservedUsd(event.target.value)} />
              </label>
              <label>
                {t("returnedToFreeLabel")}
                <input className="input" type="number" min="0.01" step="0.01" value={claimReturnedToFreeUsd} onChange={(event) => setClaimReturnedToFreeUsd(event.target.value)} />
              </label>
              <button
                className="btn"
                type="button"
                disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
                onClick={() => void handleClaim()}
              >
                {flow.busyKey === "claim-bot-vault" ? t("buildingTx") : t("claimAction")}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 10 }}>
            <strong>{t("closeTitle")}</strong>
            <div className="settingsMutedText" style={{ marginTop: 6, marginBottom: 8 }}>
              {t("closeHint")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) auto", gap: 8, alignItems: "end" }}>
              <label>
                {t("releasedReservedLabel")}
                <input className="input" type="number" min="0" step="0.01" value={closeReleasedReservedUsd} onChange={(event) => setCloseReleasedReservedUsd(event.target.value)} />
              </label>
              <label>
                {t("returnedToFreeLabel")}
                <input className="input" type="number" min="0" step="0.01" value={closeReturnedToFreeUsd} onChange={(event) => setCloseReturnedToFreeUsd(event.target.value)} />
              </label>
              <button
                className="btn btnPrimary"
                type="button"
                disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
                onClick={() => void handleClose()}
              >
                {flow.busyKey === "close-bot-vault" ? t("buildingTx") : t("closeAction")}
              </button>
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

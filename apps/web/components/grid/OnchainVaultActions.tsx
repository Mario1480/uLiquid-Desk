"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Hex } from "viem";
import {
  useAccount,
  useConnection,
  useSendTransaction,
  useWaitForTransactionReceipt
} from "wagmi";
import { switchChain } from "wagmi/actions";
import { apiGet, apiPost } from "../../lib/api";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../lib/web3/config";
import type {
  BotVaultPnlReport,
  BotVaultSnapshot,
  MasterVaultSummary,
  MeResponse,
  OnchainActionItem,
  OnchainBuildActionResponse,
  UserOnchainActionsResponse
} from "./types";
import { createIdempotencyKey, errMsg, formatDateTime, formatNumber } from "./utils";

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

function replaceStablecoinUnit(label: string, stablecoinLabel: string): string {
  return label.replaceAll("USDT", stablecoinLabel);
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
    case "set_bot_vault_close_only":
      return "Set BotVault Close-only";
    case "claim_from_bot_vault":
      return "Claim";
    case "close_bot_vault":
      return "Close";
    case "set_treasury_recipient":
      return "Set Treasury";
    case "set_profit_share_fee_rate":
      return "Set Fee Rate";
    default:
      return actionType;
  }
}

function roundUsd(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function computeLocalSettlementPreview(input: {
  releasedReservedUsd: number;
  grossReturnedUsd: number;
  realizedPnlNetUsd: number;
  highWaterMarkUsd: number;
  treasuryRecipient: string | null;
  feeRatePct: number;
}) {
  const releasedReservedUsd = Math.max(0, Number(input.releasedReservedUsd ?? 0));
  const grossReturnedUsd = Math.max(0, Number(input.grossReturnedUsd ?? 0));
  const realizedPnlAfterUsd = roundUsd(
    Number(input.realizedPnlNetUsd ?? 0) + grossReturnedUsd - releasedReservedUsd,
    6
  );
  const feeBaseUsd = roundUsd(
    Math.min(
      Math.max(0, grossReturnedUsd - releasedReservedUsd),
      Math.max(0, Math.max(0, realizedPnlAfterUsd) - Math.max(0, Number(input.highWaterMarkUsd ?? 0)))
    ),
    6
  );
  const feeRatePct = Math.max(0, Math.min(100, Number(input.feeRatePct ?? 30)));
  const feeAmountUsd = roundUsd(feeBaseUsd * (feeRatePct / 100), 4);
  return {
    feeBaseUsd,
    feeAmountUsd,
    netReturnedUsd: roundUsd(Math.max(0, grossReturnedUsd - feeAmountUsd), 6),
    treasuryRecipient: input.treasuryRecipient,
    feeRatePct
  };
}

function actionStatusTone(status: string): { color: string; borderColor: string } {
  if (status === "confirmed") return { color: "#16a34a", borderColor: "rgba(34,197,94,0.35)" };
  if (status === "submitted") return { color: "#0284c7", borderColor: "rgba(14,165,233,0.35)" };
  if (status === "failed") return { color: "#dc2626", borderColor: "rgba(239,68,68,0.35)" };
  return { color: "#f59e0b", borderColor: "rgba(245,158,11,0.35)" };
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
        txHash,
        idempotencyKey: createIdempotencyKey(`submit-onchain-tx:${built.action.id}`)
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
    lastTxHash,
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
  const flow = useOnchainActionFlow(onUpdated);

  async function handleCreateMasterVault() {
    await flow.executeAction({
      busyKey: "create-master-vault",
      buildPath: "/vaults/onchain/master/create-tx",
      body: {
        actionKey: buildActionKey("web-create-master-vault")
      }
    });
  }

  return (
    <section className="card" style={{ padding: 12, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t("masterTitle")}</h3>
      <div className="settingsMutedText" style={{ marginBottom: 10 }}>
        {t("masterCreateHint")}
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
          <div>{t("masterVaultOnchainAddressPending")}</div>
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
      ) : null}
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
  const [claimGrossReturnedUsd, setClaimGrossReturnedUsd] = useState(() =>
    String(Math.max(Number(pnlReport?.netWithdrawableProfit ?? botVault?.withdrawableUsd ?? 0), 0))
  );
  const [closeReleasedReservedUsd, setCloseReleasedReservedUsd] = useState(() => {
    const outstanding = Math.max(Number(botVault?.principalAllocated ?? 0) - Number(botVault?.principalReturned ?? 0), 0);
    return String(outstanding);
  });
  const [closeGrossReturnedUsd, setCloseGrossReturnedUsd] = useState(() =>
    String(Math.max(Number(botVault?.availableUsd ?? 0), 0))
  );
  const [masterVaultTreasuryRecipient, setMasterVaultTreasuryRecipient] = useState<string | null>(null);
  const [masterVaultFeeRatePct, setMasterVaultFeeRatePct] = useState<number>(30);
  const stablecoinLabel = flow.mode === "onchain_live" || flow.mode === "onchain_simulated"
    || botVault?.executionProvider === "hyperliquid_demo"
    || botVault?.executionProvider === "hyperliquid"
    ? "USDC"
    : "USDT";

  useEffect(() => {
    setAllocationUsd(String(Math.max(defaultAllocationUsd, 0)));
  }, [defaultAllocationUsd, botVault?.id]);

  useEffect(() => {
    setClaimGrossReturnedUsd(String(Math.max(Number(pnlReport?.netWithdrawableProfit ?? botVault?.withdrawableUsd ?? 0), 0)));
    setCloseGrossReturnedUsd(String(Math.max(Number(botVault?.availableUsd ?? 0), 0)));
    setCloseReleasedReservedUsd(String(Math.max(Number(botVault?.principalAllocated ?? 0) - Number(botVault?.principalReturned ?? 0), 0)));
  }, [botVault?.id, botVault?.availableUsd, botVault?.principalAllocated, botVault?.principalReturned, botVault?.withdrawableUsd, pnlReport?.netWithdrawableProfit]);

  useEffect(() => {
    let cancelled = false;
    void apiGet<MasterVaultSummary>("/vaults/master")
      .then((payload) => {
        if (!cancelled) {
          setMasterVaultTreasuryRecipient(payload?.treasuryRecipient ?? null);
          setMasterVaultFeeRatePct(Number(payload?.feeRatePct ?? 30));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMasterVaultTreasuryRecipient(null);
          setMasterVaultFeeRatePct(30);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [botVault?.masterVaultId]);

  const botActions = useMemo(
    () => flow.actions.filter((item) => item.botVaultId === botVault?.id),
    [flow.actions, botVault?.id]
  );
  const claimPreview = useMemo(
    () => computeLocalSettlementPreview({
      releasedReservedUsd: Number(claimReleasedReservedUsd),
      grossReturnedUsd: Number(claimGrossReturnedUsd),
      realizedPnlNetUsd: Number(botVault?.realizedPnlNet ?? botVault?.realizedNetUsd ?? 0),
      highWaterMarkUsd: Number(botVault?.highWaterMark ?? 0),
      treasuryRecipient: masterVaultTreasuryRecipient,
      feeRatePct: masterVaultFeeRatePct
    }),
    [botVault?.highWaterMark, botVault?.realizedNetUsd, botVault?.realizedPnlNet, claimGrossReturnedUsd, claimReleasedReservedUsd, masterVaultFeeRatePct, masterVaultTreasuryRecipient]
  );
  const closePreview = useMemo(
    () => computeLocalSettlementPreview({
      releasedReservedUsd: Number(closeReleasedReservedUsd),
      grossReturnedUsd: Number(closeGrossReturnedUsd),
      realizedPnlNetUsd: Number(botVault?.realizedPnlNet ?? botVault?.realizedNetUsd ?? 0),
      highWaterMarkUsd: Number(botVault?.highWaterMark ?? 0),
      treasuryRecipient: masterVaultTreasuryRecipient,
      feeRatePct: masterVaultFeeRatePct
    }),
    [botVault?.highWaterMark, botVault?.realizedNetUsd, botVault?.realizedPnlNet, closeGrossReturnedUsd, closeReleasedReservedUsd, masterVaultFeeRatePct, masterVaultTreasuryRecipient]
  );
  const hasConfirmedOnchainCloseOnly = useMemo(
    () => botActions.some((item) => item.actionType === "set_bot_vault_close_only" && item.status === "confirmed"),
    [botActions]
  );
  const canAttemptOnchainClose = useMemo(() => {
    const status = String(botVault.status ?? "").trim().toUpperCase();
    return status === "CLOSE_ONLY" || status === "CLOSED" || hasConfirmedOnchainCloseOnly;
  }, [botVault.status, hasConfirmedOnchainCloseOnly]);

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
    const grossReturnedUsd = Number(claimGrossReturnedUsd);
    if (!Number.isFinite(releasedReservedUsd) || releasedReservedUsd < 0 || !Number.isFinite(grossReturnedUsd) || grossReturnedUsd <= 0) {
      flow.setError(t("messages.invalidClaimValues"));
      return;
    }
    await flow.executeAction({
      busyKey: "claim-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/claim-tx`,
      body: {
        releasedReservedUsd,
        grossReturnedUsd,
        actionKey: buildActionKey(`web-claim-bot-vault:${botVault.id}`)
      }
    });
  }

  async function handleSetCloseOnly() {
    await flow.executeAction({
      busyKey: "set-bot-vault-close-only",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/set-close-only-tx`,
      body: {
        actionKey: buildActionKey(`web-set-bot-vault-close-only:${botVault.id}`)
      }
    });
  }

  async function handleClose() {
    const releasedReservedUsd = Number(closeReleasedReservedUsd);
    const grossReturnedUsd = Number(closeGrossReturnedUsd);
    if (!Number.isFinite(releasedReservedUsd) || releasedReservedUsd < 0 || !Number.isFinite(grossReturnedUsd) || grossReturnedUsd < 0) {
      flow.setError(t("messages.invalidCloseValues"));
      return;
    }
    await flow.executeAction({
      busyKey: "close-bot-vault",
      buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVault.id)}/close-tx`,
      body: {
        releasedReservedUsd,
        grossReturnedUsd,
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
          <div>{formatNumber(Number(pnlReport?.netWithdrawableProfit ?? botVault.withdrawableUsd ?? 0), 2)} {stablecoinLabel}</div>
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
                {replaceStablecoinUnit(t("allocationAmountLabel"), stablecoinLabel)}
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
                {replaceStablecoinUnit(t("releasedReservedLabel"), stablecoinLabel)}
                <input className="input" type="number" min="0" step="0.01" value={claimReleasedReservedUsd} onChange={(event) => setClaimReleasedReservedUsd(event.target.value)} />
              </label>
              <label>
                {replaceStablecoinUnit(t("returnedToFreeLabel"), stablecoinLabel)}
                <input className="input" type="number" min="0.01" step="0.01" value={claimGrossReturnedUsd} onChange={(event) => setClaimGrossReturnedUsd(event.target.value)} />
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
            <div className="settingsMutedText" style={{ marginTop: 8 }}>
              {masterVaultTreasuryRecipient
                ? `${t("previewGrossLabel")}: ${formatNumber(Number(claimGrossReturnedUsd), 2)} ${stablecoinLabel} · ${t("previewFeeLabel")}: ${formatNumber(claimPreview.feeAmountUsd, 2)} ${stablecoinLabel} (${formatNumber(claimPreview.feeRatePct, 0)}%) · ${t("previewNetLabel")}: ${formatNumber(claimPreview.netReturnedUsd, 2)} ${stablecoinLabel} · ${t("previewTreasuryLabel")}: ${shortAddress(claimPreview.treasuryRecipient)}`
                : t("previewLegacyHint")}
            </div>
          </div>

          <div className="card" style={{ padding: 10 }}>
            <strong>{t("closeTitle")}</strong>
            <div className="settingsMutedText" style={{ marginTop: 6, marginBottom: 8 }}>
              {t("closeHint")}
            </div>
            {!canAttemptOnchainClose ? (
              <div className="settingsAlert settingsAlertWarn" style={{ marginBottom: 8 }}>
                {t("messages.closeOnlyRequired")}
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) auto", gap: 8, alignItems: "end" }}>
              <label>
                {replaceStablecoinUnit(t("releasedReservedLabel"), stablecoinLabel)}
                <input className="input" type="number" min="0" step="0.01" value={closeReleasedReservedUsd} onChange={(event) => setCloseReleasedReservedUsd(event.target.value)} />
              </label>
              <label>
                {replaceStablecoinUnit(t("returnedToFreeLabel"), stablecoinLabel)}
                <input className="input" type="number" min="0" step="0.01" value={closeGrossReturnedUsd} onChange={(event) => setCloseGrossReturnedUsd(event.target.value)} />
              </label>
              <button
                className="btn"
                type="button"
                disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending || canAttemptOnchainClose}
                onClick={() => void handleSetCloseOnly()}
              >
                {flow.busyKey === "set-bot-vault-close-only" ? t("buildingTx") : t("setCloseOnlyAction")}
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending || !canAttemptOnchainClose}
                onClick={() => void handleClose()}
              >
                {flow.busyKey === "close-bot-vault" ? t("buildingTx") : t("closeAction")}
              </button>
            </div>
            <div className="settingsMutedText" style={{ marginTop: 8 }}>
              {masterVaultTreasuryRecipient
                ? `${t("previewGrossLabel")}: ${formatNumber(Number(closeGrossReturnedUsd), 2)} ${stablecoinLabel} · ${t("previewFeeLabel")}: ${formatNumber(closePreview.feeAmountUsd, 2)} ${stablecoinLabel} (${formatNumber(closePreview.feeRatePct, 0)}%) · ${t("previewNetLabel")}: ${formatNumber(closePreview.netReturnedUsd, 2)} ${stablecoinLabel} · ${t("previewTreasuryLabel")}: ${shortAddress(closePreview.treasuryRecipient)}`
                : t("previewLegacyHint")}
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

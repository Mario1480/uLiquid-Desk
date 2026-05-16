"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import type { FundingFeatureConfig, WalletFundingOverview } from "../../lib/funding/types";
import type { TransferFeatureConfig, WalletTransferOverview } from "../../lib/transfers/types";
import { formatToken, shortAddress } from "../../lib/wallet/format";
import { useOnchainActionFlow } from "../grid/OnchainVaultActions";
import { createIdempotencyKey } from "../grid/utils";
import { AppIcon } from "../../app/components/AppIcon";
import { HyperEvmAddressLink } from "../wallet/ExplorerLinks";
import ArbitrumHyperCoreBridgeSection from "./ArbitrumHyperCoreBridgeSection";
import FundingTransferSection from "./FundingTransferSection";
import HyperliquidUsdClassTransferSection from "./HyperliquidUsdClassTransferSection";

type ActiveModal = "deposit" | "withdraw" | "spot_perp" | "core_evm" | null;

type FundingVaultOverview = {
  mode: "offchain_shadow" | "onchain_simulated" | "onchain_live" | string;
  fundingVault?: {
    id: string | null;
    onchainAddress: string | null;
    operatorAddress: string | null;
    freeBalance: number;
    reservedBalance: number;
    availableBalance: number;
    status: string;
    lastSyncedAt: string | null;
  } | null;
  linkedWalletAddress?: string | null;
  agentWalletAddress?: string | null;
  ready?: boolean;
  setup?: {
    canCreate?: boolean;
    needsLinkedWallet?: boolean;
    needsAgentWallet?: boolean;
    needsOnchainAddress?: boolean;
  };
};

function displayBalance(value: string | null | undefined, symbol: string, maxDecimals = 2): string {
  if (!value) return "-";
  return `${formatToken(value, maxDecimals)} ${symbol}`;
}

function overviewStatusClass(ok: boolean): string {
  return ok ? "badgeOk" : "badgeWarn";
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function formatFundingVaultUsd(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} USDC`;
}

function parsePositiveUsd(value: string): number | null {
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function hasPositiveRawBalance(balance: { raw: string | null; available: boolean } | null | undefined): boolean {
  if (!balance?.available) return false;
  try {
    return BigInt(balance.raw ?? "0") > BigInt(0);
  } catch {
    return false;
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function modalTitle(t: ReturnType<typeof useTranslations>, activeModal: Exclude<ActiveModal, null>) {
  switch (activeModal) {
    case "deposit":
      return t("actions.deposit");
    case "withdraw":
      return t("actions.withdraw");
    case "spot_perp":
      return t("actions.spotPerp");
    case "core_evm":
      return t("actions.coreEvm");
  }
}

function FundingVaultAddressCopy({ vaultAddress }: { vaultAddress: string | null | undefined }) {
  const t = useTranslations("funding.actionCenter");
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!vaultAddress) return;
    try {
      await copyTextToClipboard(vaultAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`fundingVaultAddressCopy${vaultAddress ? "" : " isEmpty"}`}>
      <div className="fundingVaultAddressCopyText">
        <span className="walletLabel">{t("fundingVault.directDeposit")}</span>
        <code title={vaultAddress ?? undefined}>{vaultAddress ? shortAddress(vaultAddress) : "-"}</code>
        <div className="walletMutedText">{t("fundingVault.directDepositHint")}</div>
      </div>
      {vaultAddress ? (
        <button type="button" className="btn" onClick={() => void copyAddress()}>
          <AppIcon name="copy" />
          {copied ? t("fundingVault.copiedAddress") : t("fundingVault.copyAddress")}
        </button>
      ) : null}
      <HyperEvmAddressLink address={vaultAddress} label="HyperEVMScan" />
    </div>
  );
}

function FundingVaultInlineAddressCopy({ vaultAddress }: { vaultAddress: string | null | undefined }) {
  const t = useTranslations("funding.actionCenter");
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!vaultAddress) return;
    await navigator.clipboard.writeText(vaultAddress);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 1_200);
  }

  if (!vaultAddress) return <strong>-</strong>;

  return (
    <span className="fundingVaultInlineAddress">
      <strong>{shortAddress(vaultAddress)}</strong>
      <button
        type="button"
        className="fundingVaultInlineCopyButton"
        onClick={() => void copyAddress()}
        aria-label={copied ? t("fundingVault.copiedAddress") : t("fundingVault.copyAddress")}
        title={copied ? t("fundingVault.copiedAddress") : t("fundingVault.copyAddress")}
      >
        <AppIcon name={copied ? "check" : "copy"} />
      </button>
    </span>
  );
}

export function FundingVaultQuickCard({ onManage }: { onManage: () => void }) {
  const t = useTranslations("funding.actionCenter");
  const tCommon = useTranslations("funding.common");

  const overviewQuery = useQuery({
    queryKey: ["funding-vault-overview"],
    queryFn: () => apiGet<FundingVaultOverview>("/vaults/funding-vault"),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });

  const overview = overviewQuery.data ?? null;
  const vault = overview?.fundingVault ?? null;
  const ready = Boolean(vault?.onchainAddress && overview?.agentWalletAddress);

  return (
    <article className="walletInfoTile fundingQuickCard">
      <div className="fundingQuickHeader">
        <strong>{t("fundingVault.title")}</strong>
        <span className={`badge ${overviewStatusClass(ready)}`}>
          {ready ? tCommon("ready") : t("fundingVault.setupRequired")}
        </span>
      </div>
      <div className="walletMutedText">{t("fundingVault.subtitle")}</div>
      <div className="fundingQuickStats">
        <span>{t("fundingVault.available")}: <strong>{formatFundingVaultUsd(vault?.availableBalance)}</strong></span>
        <span>{t("fundingVault.reserved")}: <strong>{formatFundingVaultUsd(vault?.reservedBalance)}</strong></span>
        <span>{t("fundingVault.vault")}: <FundingVaultInlineAddressCopy vaultAddress={vault?.onchainAddress} /></span>
        <span>{t("fundingVault.agent")}: <strong>{overview?.agentWalletAddress ? shortAddress(overview.agentWalletAddress) : "-"}</strong></span>
      </div>
      {overviewQuery.isLoading ? <div className="walletMutedText">{t("fundingVault.loading")}</div> : null}
      {overviewQuery.error ? <div className="walletNotice walletNoticeError">{errMsg(overviewQuery.error)}</div> : null}
      <div className="fundingQuickCardActions">
        <button type="button" className="btn btnPrimary" onClick={onManage}>
          <AppIcon name="manage" />
          {t("fundingVault.manage")}
        </button>
        <HyperEvmAddressLink address={vault?.onchainAddress} label="View vault" />
        <HyperEvmAddressLink address={overview?.agentWalletAddress} label="View agent" />
      </div>
    </article>
  );
}

export function BotVaultWalletQuickCard({ onFund, onWithdraw }: { onFund: () => void; onWithdraw: () => void }) {
  const t = useTranslations("funding.actionCenter");
  const tCommon = useTranslations("funding.common");
  const { address, isConnected } = useAccount();

  const fundingQuery = useQuery({
    queryKey: ["funding-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });

  const funding = fundingQuery.data ?? null;
  const relayReady = Boolean(funding?.actions.some((item) => item.id === "relay_botvault_usdc_funding" && item.enabled));
  const withdrawalReady = Boolean(funding?.actions.some((item) => item.id === "relay_botvault_usdc_withdrawal" && item.enabled));
  const loading = Boolean(isConnected && fundingQuery.isLoading);
  const routeReady = relayReady || withdrawalReady;

  return (
    <article className="walletInfoTile fundingQuickCard">
      <div className="fundingQuickHeader">
        <strong>{t("cards.relayTitle")}</strong>
        <span className={`badge ${overviewStatusClass(routeReady)}`}>
          {loading ? t("loading") : routeReady ? tCommon("ready") : t("attention")}
        </span>
      </div>
      <div className="walletMutedText">{t("cards.relaySubtitle")}</div>
      {isConnected ? (
        <div className="fundingQuickStats">
          <span>{t("cards.arbitrumUsdc")}: <strong>{displayBalance(funding?.arbitrum.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.evmUsdc")}: <strong>{displayBalance(funding?.hyperEvm.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.evmHype")}: <strong>{displayBalance(funding?.hyperEvm.hype.formatted, "HYPE", 4)}</strong></span>
        </div>
      ) : (
        <div className="walletNotice walletNoticeCompact">{t("cards.relayConnectHint")}</div>
      )}
      {fundingQuery.error ? <div className="walletNotice walletNoticeError">{errMsg(fundingQuery.error)}</div> : null}
      <div className="fundingQuickCardActions fundingQuickCardActionsSplit">
        <button type="button" className="btn btnPrimary" onClick={onFund} disabled={!isConnected || loading}>
          <AppIcon name="deposit" />
          {t("actions.botvaultFunding")}
        </button>
        <button type="button" className="btn" onClick={onWithdraw} disabled={!isConnected || loading}>
          <AppIcon name="withdraw" />
          {t("actions.botvaultWithdrawal")}
        </button>
      </div>
    </article>
  );
}

export function FundingVaultManagementSection() {
  const t = useTranslations("funding.actionCenter");
  const tCommon = useTranslations("funding.common");
  const [depositAmount, setDepositAmount] = useState("25");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["funding-vault-overview"],
    queryFn: () => apiGet<FundingVaultOverview>("/vaults/funding-vault"),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });

  const flow = useOnchainActionFlow(async () => {
    await overviewQuery.refetch();
  });

  const overview = overviewQuery.data ?? null;
  const vault = overview?.fundingVault ?? null;
  const ready = Boolean(vault?.onchainAddress && overview?.agentWalletAddress);
  const canCreate = Boolean(overview?.setup?.canCreate);
  const busy = Boolean(flow.busyKey) || agentBusy;
  const actionError = localError ?? flow.error ?? (overviewQuery.error ? errMsg(overviewQuery.error) : null);
  const actionNotice = localNotice ?? flow.notice ?? null;

  async function ensureWalletReady() {
    if (flow.mode === "offchain_shadow") throw new Error(t("fundingVault.modeDisabled"));
    if (!flow.isConnected) throw new Error(t("fundingVault.connectWallet"));
    if (!flow.walletMatches) throw new Error(t("fundingVault.walletMismatch"));
    if (flow.chainMismatch) await flow.requestChainSwitch();
  }

  async function executeWalletAction(kind: "create" | "deposit" | "withdraw") {
    setLocalError(null);
    setLocalNotice(null);
    try {
      await ensureWalletReady();
      const amount = kind === "deposit" ? parsePositiveUsd(depositAmount) : kind === "withdraw" ? parsePositiveUsd(withdrawAmount) : null;
      if (kind !== "create" && !amount) throw new Error(t("fundingVault.positiveAmount"));
      const ok = await flow.executeAction({
        busyKey: `funding-vault-${kind}`,
        buildPath:
          kind === "create"
            ? "/vaults/funding-vault/create-tx"
            : kind === "deposit"
              ? "/vaults/funding-vault/deposit-tx"
              : "/vaults/funding-vault/withdraw-tx",
        body: {
          ...(amount ? { amountUsd: amount } : {}),
          actionKey: createIdempotencyKey(`funding-vault-${kind}`)
        }
      });
      if (ok) {
        if (kind === "deposit") setDepositAmount("");
        if (kind === "withdraw") setWithdrawAmount("");
        setLocalNotice(t("fundingVault.txSubmitted"));
        await overviewQuery.refetch();
      }
    } catch (error) {
      setLocalError(errMsg(error));
    }
  }

  async function executeAgentWithdraw() {
    const amount = parsePositiveUsd(withdrawAmount);
    if (!amount) {
      setLocalError(t("fundingVault.positiveAmount"));
      return;
    }
    setAgentBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    try {
      await apiPost("/vaults/funding-vault/agent-withdraw", {
        amountUsd: amount,
        actionKey: createIdempotencyKey("funding-vault-agent-withdraw")
      });
      setWithdrawAmount("");
      setLocalNotice(t("fundingVault.agentWithdrawSubmitted"));
      await Promise.all([
        overviewQuery.refetch(),
        flow.load().catch(() => undefined)
      ]);
    } catch (error) {
      setLocalError(errMsg(error));
    } finally {
      setAgentBusy(false);
    }
  }

  return (
    <section className="card walletCard fundingModalSection">
      <div className="walletSectionHeader fundingModalTitleBlock">
        <div className="walletSectionIntro">
          <h3 className="walletSectionTitle">{t("fundingVault.title")}</h3>
          <div className="walletMutedText">{t("fundingVault.subtitle")}</div>
        </div>
      </div>

      <div className="fundingModalDirectionPill">
        <span>{ready ? tCommon("ready") : t("fundingVault.setupRequired")}</span>
      </div>

      <div className="fundingQuickStats fundingVaultModalStats">
        <span>{t("fundingVault.available")}: <strong>{formatFundingVaultUsd(vault?.availableBalance)}</strong></span>
        <span>{t("fundingVault.reserved")}: <strong>{formatFundingVaultUsd(vault?.reservedBalance)}</strong></span>
        <span>{t("fundingVault.vault")}: <strong>{vault?.onchainAddress ? shortAddress(vault.onchainAddress) : "-"}</strong></span>
        <span>{t("fundingVault.agent")}: <strong>{overview?.agentWalletAddress ? shortAddress(overview.agentWalletAddress) : "-"}</strong></span>
      </div>

      <FundingVaultAddressCopy vaultAddress={vault?.onchainAddress} />

      <div className="fundingVaultModalControls">
        {!vault?.onchainAddress ? (
          <button
            type="button"
            className="btn btnPrimary"
            onClick={() => void executeWalletAction("create")}
            disabled={!canCreate || busy}
          >
            <AppIcon name="create" />
            {flow.busyKey === "funding-vault-create" ? t("fundingVault.creating") : t("fundingVault.create")}
          </button>
        ) : null}
        <div className="fundingVaultModalAmountGrid">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={depositAmount}
            onChange={(event) => setDepositAmount(event.target.value)}
            placeholder={t("fundingVault.depositPlaceholder")}
          />
          <button type="button" className="btn" onClick={() => void executeWalletAction("deposit")} disabled={!ready || busy}>
            <AppIcon name="deposit" />
            {t("fundingVault.deposit")}
          </button>
        </div>
        <div className="fundingVaultModalWithdrawGrid">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={withdrawAmount}
            onChange={(event) => setWithdrawAmount(event.target.value)}
            placeholder={t("fundingVault.withdrawPlaceholder")}
          />
          <button type="button" className="btn" onClick={() => void executeWalletAction("withdraw")} disabled={!ready || busy}>
            <AppIcon name="withdraw" />
            {t("fundingVault.ownerWithdraw")}
          </button>
          <button type="button" className="btn btnPrimary" onClick={() => void executeAgentWithdraw()} disabled={!ready || busy}>
            <AppIcon name="withdraw" />
            {t("fundingVault.agentWithdraw")}
          </button>
        </div>
      </div>
      <div className="fundingVaultModalFeedbackStack">
        {actionNotice ? <div className="walletNotice walletNoticeSuccess">{actionNotice}</div> : null}
        {actionError ? <div className="walletNotice walletNoticeError">{actionError}</div> : null}
        {overviewQuery.isLoading ? <div className="walletMutedText">{t("fundingVault.loading")}</div> : null}
      </div>
    </section>
  );
}

export default function FundingActionCenter({
  fundingConfig,
  transferConfig,
  embedded = false
}: {
  fundingConfig: FundingFeatureConfig;
  transferConfig: TransferFeatureConfig;
  embedded?: boolean;
}) {
  const t = useTranslations("funding.actionCenter");
  const tCommon = useTranslations("funding.common");
  const { address, isConnected } = useAccount();
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const fundingQuery = useQuery({
    queryKey: ["funding-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });

  const transferQuery = useQuery({
    queryKey: ["transfer-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletTransferOverview>(`/transfers/${address}/overview`),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });
  const anyError = isConnected ? fundingQuery.error || transferQuery.error : null;

  const activeModalDialog = activeModal ? (
    <div className="fundingModalOverlay" role="presentation" onClick={() => setActiveModal(null)}>
      <div className="fundingModalCard" role="dialog" aria-modal="true" aria-label={modalTitle(t, activeModal)} onClick={(event) => event.stopPropagation()}>
        <div className="walletSectionHeader fundingModalHeader fundingModalHeaderCompact">
          <button
            type="button"
            className="fundingModalCloseButton"
            aria-label={t("modal.close")}
            onClick={() => setActiveModal(null)}
          >
            <AppIcon name="close" />
          </button>
        </div>
        <div className="fundingModalBody">
          {activeModal === "deposit" ? <ArbitrumHyperCoreBridgeSection config={fundingConfig} presentation="modal" initialFlow="deposit" key="deposit-modal" /> : null}
          {activeModal === "withdraw" ? <ArbitrumHyperCoreBridgeSection config={fundingConfig} presentation="modal" initialFlow="withdraw" key="withdraw-modal" /> : null}
          {activeModal === "spot_perp" ? <HyperliquidUsdClassTransferSection config={fundingConfig} presentation="modal" initialDirection="perp_to_spot" key="spot-perp-modal" /> : null}
          {activeModal === "core_evm" ? <FundingTransferSection config={transferConfig} presentation="modal" initialDirection="core_to_evm" initialAsset="USDC" key="core-evm-modal" /> : null}
        </div>
      </div>
    </div>
  ) : null;

  if (!isConnected) {
    return (
      <section className={embedded ? "fundingActionEmbedded" : "walletStack"}>
        {embedded ? (
          <div className="walletNotice">{t("connectDescription")}</div>
        ) : (
          <section className="card walletCard fundingActionShell">
            <div className="walletNotice">{t("connectDescription")}</div>
          </section>
        )}
        {activeModalDialog}
      </section>
    );
  }

  if (fundingQuery.isLoading || transferQuery.isLoading) {
    const loadingContent = (
      <div className={embedded ? "fundingActionEmbeddedLoading" : "card walletCard fundingActionShell"}>
        <div className="skeletonLine skeletonLineLg" />
        <div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} />
        <div className="walletInfoGrid" style={{ marginTop: 16 }}>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
        </div>
      </div>
    );

    return (
      <section className={embedded ? "fundingActionEmbedded" : "walletStack"}>
        {loadingContent}
      </section>
    );
  }

  if (anyError) {
    return (
      <div className="walletNotice walletNoticeError">
        {String(((anyError as Error)?.message) ?? t("loadError"))}
      </div>
    );
  }

  if (!fundingQuery.data || !transferQuery.data) return null;

  const funding = fundingQuery.data;
  const transfer = transferQuery.data;
  const hyperCoreOk = hasPositiveRawBalance(funding.hyperCore.usdc) || hasPositiveRawBalance(funding.hyperCore.hype);
  const hyperEvmOk = hasPositiveRawBalance(funding.hyperEvm.usdc) || hasPositiveRawBalance(funding.hyperEvm.hype);
  const depositReady = funding.bridge.deposit.enabled;
  const withdrawReady = funding.bridge.withdraw.enabled;
  const spotPerpReady = hasPositiveRawBalance(funding.hyperCore.usdc) || hasPositiveRawBalance(funding.bridge.creditedBalance);

  const fundingCards = (
    <div className={`fundingQuickGrid${embedded ? " fundingQuickGridEmbedded" : ""}`}>
      <article className="walletInfoTile fundingQuickCard">
        <div className="fundingQuickHeader">
          <strong>{t("cards.bridgeTitle")}</strong>
          <span className={`badge ${overviewStatusClass(depositReady && withdrawReady)}`}>{depositReady && withdrawReady ? tCommon("ready") : t("attention")}</span>
        </div>
        <div className="walletMutedText">{t("cards.bridgeSubtitle")}</div>
        <div className="fundingQuickStats">
          <span>{t("cards.arbitrumUsdc")}: <strong>{displayBalance(funding.arbitrum.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.tradingUsdc")}: <strong>{displayBalance(funding.bridge.creditedBalance.formatted, "USDC")}</strong></span>
          <span>{t("cards.bridgeTiming")}: <strong>{t("cards.bridgeTimingValue")}</strong></span>
        </div>
        <div className="fundingQuickCardActions fundingQuickCardActionsSplit">
          <button type="button" className="btn btnPrimary" onClick={() => setActiveModal("deposit")}>
            <AppIcon name="deposit" />
            {t("actions.deposit")}
          </button>
          <button type="button" className="btn" onClick={() => setActiveModal("withdraw")}>
            <AppIcon name="withdraw" />
            {t("actions.withdraw")}
          </button>
        </div>
      </article>

      <article className="walletInfoTile fundingQuickCard">
        <div className="fundingQuickHeader">
          <strong>{t("cards.spotPerpTitle")}</strong>
          <span className={`badge ${overviewStatusClass(spotPerpReady)}`}>{spotPerpReady ? tCommon("ready") : t("attention")}</span>
        </div>
        <div className="walletMutedText">{t("cards.spotPerpSubtitle")}</div>
        <div className="fundingQuickStats">
          <span>{t("cards.spotUsdc")}: <strong>{displayBalance(funding.hyperCore.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.perpUsdc")}: <strong>{displayBalance(funding.bridge.creditedBalance.formatted, "USDC")}</strong></span>
          <span>{t("cards.spotPerpTiming")}: <strong>{t("cards.spotPerpTimingValue")}</strong></span>
        </div>
        <div className="fundingQuickCardActions">
          <button type="button" className="btn" onClick={() => setActiveModal("spot_perp")}>
            <AppIcon name="transfer" />
            {t("actions.spotPerp")}
          </button>
        </div>
      </article>

      <article className="walletInfoTile fundingQuickCard">
        <div className="fundingQuickHeader">
          <strong>{t("cards.coreEvmTitle")}</strong>
          <span className={`badge ${overviewStatusClass(hyperCoreOk && hyperEvmOk)}`}>{hyperCoreOk && hyperEvmOk ? tCommon("ready") : t("attention")}</span>
        </div>
        <div className="walletMutedText">{t("cards.coreEvmSubtitle")}</div>
        <div className="fundingQuickStats">
          <span>{t("cards.coreUsdc")}: <strong>{displayBalance(transfer.hyperCore.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.coreHype")}: <strong>{displayBalance(transfer.hyperCore.hype.formatted, "HYPE", 4)}</strong></span>
          <span>{t("cards.evmUsdc")}: <strong>{displayBalance(transfer.hyperEvm.usdc.formatted, "USDC")}</strong></span>
          <span>{t("cards.evmHype")}: <strong>{displayBalance(transfer.hyperEvm.hype.formatted, "HYPE", 4)}</strong></span>
        </div>
        <div className="fundingQuickCardActions">
          <button type="button" className="btn" onClick={() => setActiveModal("core_evm")}>
            <AppIcon name="transfer" />
            {t("actions.coreEvm")}
          </button>
        </div>
      </article>
    </div>
  );

  return (
    <section className={embedded ? "fundingActionEmbedded" : "walletStack"}>
      {embedded ? fundingCards : <section className="card walletCard fundingActionShell">{fundingCards}</section>}
      {activeModalDialog}
    </section>
  );
}

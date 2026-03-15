"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { apiGet } from "../../lib/api";
import type { FundingFeatureConfig, FundingHistoryResponse, WalletFundingOverview } from "../../lib/funding/types";
import type { TransferFeatureConfig, WalletTransferOverview } from "../../lib/transfers/types";
import { formatDateTime, formatToken, shortAddress } from "../../lib/wallet/format";
import ArbitrumHyperCoreBridgeSection from "./ArbitrumHyperCoreBridgeSection";
import FundingTransferSection from "./FundingTransferSection";
import HyperliquidUsdClassTransferSection from "./HyperliquidUsdClassTransferSection";

type ActiveModal = "deposit" | "withdraw" | "spot_perp" | "core_evm" | null;

function displayBalance(value: string | null | undefined, symbol: string, maxDecimals = 2): string {
  if (!value) return "-";
  return `${formatToken(value, maxDecimals)} ${symbol}`;
}

function statusBadgeClass(status: FundingHistoryResponse["items"][number]["status"]): string {
  if (status === "confirmed") return "badgeOk";
  if (status === "failed") return "badgeDanger";
  if (status === "submitted") return "badgeWarn";
  return "";
}

function overviewStatusClass(ok: boolean): string {
  return ok ? "badgeOk" : "badgeWarn";
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

export default function FundingActionCenter({
  fundingConfig,
  transferConfig
}: {
  fundingConfig: FundingFeatureConfig;
  transferConfig: TransferFeatureConfig;
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

  const historyQuery = useQuery({
    queryKey: ["funding-history", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<FundingHistoryResponse>(`/funding/${address}/history`),
    staleTime: 20_000,
    refetchOnWindowFocus: false
  });

  const historyItems = useMemo(() => historyQuery.data?.items?.slice(0, 4) ?? [], [historyQuery.data?.items]);
  const anyError = fundingQuery.error || transferQuery.error || historyQuery.error;

  if (!isConnected) {
    return (
      <div className="card walletCard walletEmptyState">
        <h3 style={{ marginTop: 0 }}>{t("connectTitle")}</h3>
        <div className="walletMutedText">{t("connectDescription")}</div>
      </div>
    );
  }

  if (fundingQuery.isLoading || transferQuery.isLoading) {
    return (
      <section className="walletStack">
        <div className="card walletCard fundingActionShell">
          <div className="skeletonLine skeletonLineLg" />
          <div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} />
          <div className="walletInfoGrid" style={{ marginTop: 16 }}>
            <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
            <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
            <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
          </div>
        </div>
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
  const hyperCoreOk = funding.hyperCore.available;
  const hyperEvmOk = Boolean(funding.hyperEvm.usdc.available || funding.hyperEvm.hype.available);
  const depositReady = funding.bridge.deposit.enabled;
  const withdrawReady = funding.bridge.withdraw.enabled;

  return (
    <section className="walletStack">
      <section className="card walletCard fundingActionShell">
        <div className="walletSectionHeader">
          <div className="walletSectionIntro">
            <h3 className="walletSectionTitle">{t("title")}</h3>
            <div className="walletMutedText">{t("subtitle")}</div>
          </div>
          {address ? <div className="walletMutedText">{t("connectedWallet", { address: shortAddress(address) })}</div> : null}
        </div>

        <div className="fundingToolbar">
          <button type="button" className="btn btnPrimary" onClick={() => setActiveModal("deposit")}>{t("actions.deposit")}</button>
          <button type="button" className="btn" onClick={() => setActiveModal("withdraw")}>{t("actions.withdraw")}</button>
          <button type="button" className="btn" onClick={() => setActiveModal("spot_perp")}>{t("actions.spotPerp")}</button>
          <button type="button" className="btn" onClick={() => setActiveModal("core_evm")}>{t("actions.coreEvm")}</button>
        </div>

        <div className="fundingQuickGrid">
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
          </article>

          <article className="walletInfoTile fundingQuickCard">
            <div className="fundingQuickHeader">
              <strong>{t("cards.spotPerpTitle")}</strong>
              <span className={`badge ${overviewStatusClass(Boolean(funding.hyperCore.usdc.available && funding.bridge.creditedBalance.available))}`}>{tCommon("ready")}</span>
            </div>
            <div className="walletMutedText">{t("cards.spotPerpSubtitle")}</div>
            <div className="fundingQuickStats">
              <span>{t("cards.spotUsdc")}: <strong>{displayBalance(funding.hyperCore.usdc.formatted, "USDC")}</strong></span>
              <span>{t("cards.perpUsdc")}: <strong>{displayBalance(funding.bridge.creditedBalance.formatted, "USDC")}</strong></span>
              <span>{t("cards.spotPerpTiming")}: <strong>{t("cards.spotPerpTimingValue")}</strong></span>
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
          </article>
        </div>
      </section>

      <section className="card walletCard fundingMiniHistoryCard">
        <div className="walletSectionHeader">
          <div className="walletSectionIntro">
            <h3 className="walletSectionTitle">{t("history.title")}</h3>
            <div className="walletMutedText">{t("history.subtitle")}</div>
          </div>
          <span className="badge">{historyItems.length}</span>
        </div>
        {historyQuery.isLoading ? (
          <>
            <div className="skeletonLine skeletonLineMd" />
            <div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
          </>
        ) : historyItems.length ? (
          <div className="fundingMiniHistoryList">
            {historyItems.map((item) => (
              <article key={item.id} className="fundingMiniHistoryItem">
                <div className="fundingMiniHistoryMain">
                  <strong>{item.title}</strong>
                  <div className="walletMutedText">{item.description}</div>
                </div>
                <div className="fundingMiniHistoryMeta">
                  <span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span>
                  <div className="walletMutedText">{item.createdAt ? formatDateTime(item.createdAt) : "-"}</div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="walletMutedText">{t("history.empty")}</div>
        )}
      </section>

      {activeModal ? (
        <div className="fundingModalOverlay" role="presentation" onClick={() => setActiveModal(null)}>
          <div className="fundingModalCard" role="dialog" aria-modal="true" aria-label={modalTitle(t, activeModal)} onClick={(event) => event.stopPropagation()}>
            <div className="walletSectionHeader fundingModalHeader fundingModalHeaderCompact">
              <button
                type="button"
                className="fundingModalCloseButton"
                aria-label={t("modal.close")}
                onClick={() => setActiveModal(null)}
              >
                ×
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
      ) : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress, parseEther } from "viem";
import { useTranslations } from "next-intl";
import { useAccount, useConnection, useSendTransaction } from "wagmi";
import { switchChain } from "wagmi/actions";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import type { FundingFeatureConfig } from "../../lib/funding/types";
import { formatDateTime, formatToken, formatUsd, shortAddress } from "../../lib/wallet/format";
import type {
  AgentWalletSummaryResponse,
  WalletActivityResponse,
  WalletFeatureConfig,
  WalletOverviewResponse
} from "../../lib/wallet/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../lib/web3/config";
import FundingActionCenter from "../funding/FundingActionCenter";

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export default function WalletDashboardClient({
  config,
  fundingConfig,
  transferConfig
}: {
  config: WalletFeatureConfig;
  fundingConfig: FundingFeatureConfig;
  transferConfig: TransferFeatureConfig;
}) {
  const t = useTranslations("wallet.dashboard");
  const { address, isConnected } = useAccount();
  const connection = useConnection();
  const { sendTransactionAsync, isPending: isWalletPending } = useSendTransaction();
  const [activityOpen, setActivityOpen] = useState(false);
  const [agentFundHypeInput, setAgentFundHypeInput] = useState("0.01");
  const [agentWithdrawHypeInput, setAgentWithdrawHypeInput] = useState("");
  const [agentActionBusy, setAgentActionBusy] = useState<"fund" | "withdraw" | null>(null);
  const [agentActionError, setAgentActionError] = useState<string | null>(null);
  const [agentActionNotice, setAgentActionNotice] = useState<string | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["wallet-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletOverviewResponse>(`/wallet/${address}/overview`)
  });
  const activityQuery = useQuery({
    queryKey: ["wallet-activity", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletActivityResponse>(`/wallet/${address}/activity?limit=6`)
  });
  const agentWalletQuery = useQuery({
    queryKey: ["wallet-agent-wallet"],
    enabled: isConnected,
    queryFn: () => apiGet<AgentWalletSummaryResponse>("/agent-wallet")
  });
  const masterAgentSummary = agentWalletQuery.data ?? null;
  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;
  const masterAgentStateLabel =
    masterAgentSummary?.lowHypeState === "low"
      ? t("masterAgentLowStateLow")
      : masterAgentSummary?.lowHypeState === "unavailable"
        ? t("masterAgentLowStateUnavailable")
        : t("masterAgentLowStateOk");

  async function fundAgentWallet() {
    const targetAddress = String(masterAgentSummary?.address ?? "").trim();
    if (!isConnected || !address) {
      setAgentActionError(t("agentActions.connectWalletFirst"));
      return;
    }
    if (!targetAddress || !isAddress(targetAddress)) {
      setAgentActionError(t("agentActions.saveWalletFirst"));
      return;
    }
    const amountHype = Number(agentFundHypeInput);
    if (!Number.isFinite(amountHype) || amountHype <= 0) {
      setAgentActionError(t("agentActions.positiveAmount"));
      return;
    }

    setAgentActionBusy("fund");
    setAgentActionError(null);
    setAgentActionNotice(null);
    try {
      if (chainMismatch) {
        await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
      }
      const txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: targetAddress as `0x${string}`,
        value: parseEther(String(amountHype)),
        chainId: TARGET_CHAIN_ID
      });
      setAgentFundHypeInput("");
      setAgentActionNotice(t("agentActions.fundSubmitted", { txHash: `${String(txHash).slice(0, 10)}...` }));
      await agentWalletQuery.refetch();
    } catch (error) {
      setAgentActionError(errMsg(error));
    } finally {
      setAgentActionBusy(null);
    }
  }

  async function withdrawAgentWallet() {
    setAgentActionBusy("withdraw");
    setAgentActionError(null);
    setAgentActionNotice(null);
    try {
      await apiPost("/agent-wallet/withdraw-hype", {
        amountHype: agentWithdrawHypeInput ? Number(agentWithdrawHypeInput) : undefined
      });
      setAgentWithdrawHypeInput("");
      setAgentActionNotice(t("agentActions.withdrawSubmitted"));
      await agentWalletQuery.refetch();
    } catch (error) {
      setAgentActionError(errMsg(error));
    } finally {
      setAgentActionBusy(null);
    }
  }

  return (
    <div className="walletPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
      </div>

      {overviewQuery.error ? (
        <div className="walletNotice walletNoticeError">
          {String((overviewQuery.error as Error)?.message ?? t("loadError"))}
        </div>
      ) : null}

      {!isConnected ? (
        <div className="card walletCard walletEmptyState">
          <h3 style={{ marginTop: 0 }}>{t("emptyTitle")}</h3>
          <p className="walletMutedText">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="walletStack">
          <section className="card walletCard">
            <div className="walletSectionIntro" style={{ marginBottom: 12 }}>
              <h3 className="walletSectionTitle">{t("masterAgentWallet")}</h3>
              <div className="walletMutedText">{t("agentActions.subtitle")}</div>
            </div>
            <div className="walletInfoGrid">
              <div className="walletInfoTile">
                <span className="walletLabel">{t("masterAgentWallet")}</span>
                <strong>{shortAddress(masterAgentSummary?.address ?? null)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("masterAgentHypeBalance")}</span>
                <strong>{masterAgentSummary?.hypeBalance ? `${formatToken(masterAgentSummary.hypeBalance, 4)} HYPE` : "—"}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("hypeBalanceHint")}</span>
                <strong>{masterAgentSummary ? `${masterAgentSummary.lowHypeThreshold} HYPE` : "—"}</strong>
                <div className="walletMutedText">{masterAgentSummary?.updatedAt ? formatDateTime(masterAgentSummary.updatedAt) : masterAgentStateLabel}</div>
              </div>
            </div>
            {agentActionError ? (
              <div className="walletNotice walletNoticeError" style={{ marginTop: 12 }}>
                {agentActionError}
              </div>
            ) : null}
            {agentActionNotice ? (
              <div className="walletNotice" style={{ marginTop: 12 }}>
                {agentActionNotice}
              </div>
            ) : null}
            <div className="fundingToolbar" style={{ marginTop: 12 }}>
              <input
                className="input"
                value={agentFundHypeInput}
                onChange={(event) => setAgentFundHypeInput(event.target.value)}
                placeholder={t("agentActions.fundPlaceholder")}
              />
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => void fundAgentWallet()}
                disabled={!masterAgentSummary?.address || agentActionBusy !== null || isWalletPending}
              >
                {agentActionBusy === "fund" || isWalletPending ? t("agentActions.funding") : t("agentActions.fund")}
              </button>
              <input
                className="input"
                value={agentWithdrawHypeInput}
                onChange={(event) => setAgentWithdrawHypeInput(event.target.value)}
                placeholder={t("agentActions.withdrawPlaceholder")}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void withdrawAgentWallet()}
                disabled={!masterAgentSummary?.address || agentActionBusy !== null}
              >
                {agentActionBusy === "withdraw" ? t("agentActions.withdrawing") : t("agentActions.withdraw")}
              </button>
            </div>
            <div className="walletMutedText" style={{ marginTop: 12 }}>
              {t("agentActions.hint", { chain: TARGET_CHAIN_NAME })}
            </div>
          </section>

          <section className="card walletCard walletAccordionCard">
            <button
              type="button"
              className="walletAccordionTrigger"
              onClick={() => setActivityOpen((value) => !value)}
              aria-expanded={activityOpen}
            >
              <div className="walletSectionIntro">
                <h3 className="walletSectionTitle">{t("recentActivityTitle")}</h3>
                <div className="walletMutedText">{t("recentActivitySubtitle")}</div>
              </div>
              <div className="walletAccordionMeta">
                {activityQuery.data?.items?.length ? (
                  <span className="walletAccordionCount">
                    {activityQuery.data.items.length}
                  </span>
                ) : null}
                <span className="badge">{activityOpen ? t("collapseRecentActivity") : t("expandRecentActivity")}</span>
                <span className={`walletAccordionChevron${activityOpen ? " isOpen" : ""}`} aria-hidden="true">
                  ▾
                </span>
              </div>
            </button>

            {activityOpen ? (
              <div className="walletAccordionBody">
                {activityQuery.isLoading ? (
                  <>
                    <div className="skeletonLine skeletonLineLg" />
                    <div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
                    <div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
                  </>
                ) : activityQuery.data?.items?.length ? (
                  <div className="walletList">
                    {activityQuery.data.items.map((item) => (
                      <div key={item.id} className="walletActivityItem">
                        <div className="walletActivityPrimary">
                          <strong>{item.type === "action" ? (item.title ?? t("usdc")) : (item.symbol ?? t("usdc"))}</strong>
                          <div className="walletMutedText">
                            {item.type === "action"
                              ? (item.description ?? item.status ?? "Activity")
                              : `${item.side ?? "Trade"} · ${formatToken(item.size, 3)} @ ${formatToken(item.price, 4)}`}
                          </div>
                        </div>
                        <div className="walletActivitySecondary">
                          <strong>{item.type === "action" ? (item.status ?? "—") : (item.closedPnlUsd === null ? "—" : formatUsd(item.closedPnlUsd))}</strong>
                          <div className="walletMutedText">{formatDateTime(item.timestamp)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="walletMutedText">{t("noRecentActivity")}</div>
                )}
              </div>
            ) : null}
          </section>

          <section className="walletEmbeddedSection">
            <div className="walletSectionDivider" />
            <div className="walletEmbeddedSectionIntro">
              <h3 className="walletSectionTitle">{t("fundingSectionTitle")}</h3>
              <div className="walletMutedText">{t("fundingSectionSubtitle")}</div>
            </div>
            <FundingActionCenter fundingConfig={fundingConfig} transferConfig={transferConfig} />
          </section>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
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
  WalletActivityResponse
} from "../../lib/wallet/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../lib/web3/config";
import FundingActionCenter, {
  BotVaultWalletQuickCard,
  FundingVaultManagementSection,
  FundingVaultQuickCard
} from "../funding/FundingActionCenter";
import RelayBotVaultFundingSection from "../funding/RelayBotVaultFundingSection";
import { PageHeader } from "../../app/components/ui";

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export default function WalletDashboardClient({
  fundingConfig,
  transferConfig
}: {
  fundingConfig: FundingFeatureConfig;
  transferConfig: TransferFeatureConfig;
}) {
  const t = useTranslations("wallet.dashboard");
  const tFundingAction = useTranslations("funding.actionCenter");
  const { address, isConnected } = useAccount();
  const connection = useConnection();
  const { sendTransactionAsync, isPending: isWalletPending } = useSendTransaction();
  const [activityOpen, setActivityOpen] = useState(false);
  const [agentFundHypeInput, setAgentFundHypeInput] = useState("0.01");
  const [agentWithdrawHypeInput, setAgentWithdrawHypeInput] = useState("");
  const [agentThresholdInput, setAgentThresholdInput] = useState("0.05");
  const [agentActionBusy, setAgentActionBusy] = useState<"fund" | "withdraw" | null>(null);
  const [agentSetupBusy, setAgentSetupBusy] = useState<"create" | "threshold" | null>(null);
  const [activeAgentModal, setActiveAgentModal] = useState<"fund" | "withdraw" | null>(null);
  const [activeBotVaultSystemModal, setActiveBotVaultSystemModal] = useState<"botvault_funding" | "funding_vault" | null>(null);
  const [agentActionError, setAgentActionError] = useState<string | null>(null);
  const [agentActionNotice, setAgentActionNotice] = useState<string | null>(null);
  const activityQuery = useQuery({
    queryKey: ["wallet-activity", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletActivityResponse>(`/wallet/${address}/activity?limit=6`)
  });
  const agentWalletQuery = useQuery({
    queryKey: ["wallet-agent-wallet"],
    queryFn: () => apiGet<AgentWalletSummaryResponse>("/agent-wallet")
  });
  const masterAgentSummary = agentWalletQuery.data ?? null;
  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;
  const agentReady = Boolean(masterAgentSummary?.address && masterAgentSummary.lowHypeState === "ok");
  const masterAgentStateLabel = agentWalletQuery.isLoading
    ? t("agentActions.loadingWallet")
    : agentWalletQuery.error
      ? t("agentActions.loadError")
      : masterAgentSummary?.lowHypeState === "low"
        ? t("masterAgentLowStateLow")
        : masterAgentSummary?.lowHypeState === "unavailable"
          ? t("masterAgentLowStateUnavailable")
          : t("masterAgentLowStateOk");
  const agentLaunchNotice = agentWalletQuery.isLoading
    ? t("agentActions.loadingWallet")
    : agentWalletQuery.error
      ? errMsg(agentWalletQuery.error)
      : !masterAgentSummary?.address
        ? t("agentActions.launchBlockedMissing")
        : masterAgentSummary.lowHypeState !== "ok"
          ? t("agentActions.launchBlockedLowHype")
          : t("agentActions.launchReady");
  const agentLaunchNoticeClass = agentReady
    ? "walletNotice walletNoticeCompact"
    : "walletNotice walletNoticeCompact walletNoticeError";

  useEffect(() => {
    setAgentThresholdInput(masterAgentSummary ? String(masterAgentSummary.lowHypeThreshold) : "0.05");
  }, [masterAgentSummary]);

  async function createAgentWallet() {
    setAgentSetupBusy("create");
    setAgentActionError(null);
    setAgentActionNotice(null);
    try {
      await apiPost("/agent-wallet/create", {});
      setAgentActionNotice(t("agentActions.walletCreatedNextStep"));
      await agentWalletQuery.refetch();
    } catch (error) {
      if (error instanceof ApiError && error.payload?.code === "agent_wallet_already_configured") {
        setAgentActionError(t("agentActions.walletExists"));
      } else {
        setAgentActionError(errMsg(error));
      }
    } finally {
      setAgentSetupBusy(null);
    }
  }

  async function saveAgentThreshold() {
    setAgentSetupBusy("threshold");
    setAgentActionError(null);
    setAgentActionNotice(null);
    try {
      await apiPost("/agent-wallet/threshold", {
        thresholdHype: Number(agentThresholdInput)
      });
      setAgentActionNotice(t("agentActions.thresholdSaved"));
      await agentWalletQuery.refetch();
    } catch (error) {
      setAgentActionError(errMsg(error));
    } finally {
      setAgentSetupBusy(null);
    }
  }

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
      setActiveAgentModal(null);
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
      setActiveAgentModal(null);
      setAgentActionNotice(t("agentActions.withdrawSubmitted"));
      await agentWalletQuery.refetch();
    } catch (error) {
      setAgentActionError(errMsg(error));
    } finally {
      setAgentActionBusy(null);
    }
  }

  const agentWalletCard = (
    <article className="walletInfoTile fundingQuickCard walletAgentSystemCard">
      <div className="fundingQuickHeader">
        <strong>{t("masterAgentWallet")}</strong>
        <span className={`badge ${agentReady ? "badgeOk" : "badgeWarn"}`}>{masterAgentStateLabel}</span>
      </div>
      <div className="walletMutedText">{t("agentActions.subtitle")}</div>

      <div className="walletInfoGrid walletInfoGridCompact walletAgentSystemStats">
        <div className="walletInfoTile walletInfoTileCompact">
          <span className="walletLabel">{t("masterAgentWallet")}</span>
          <strong>{shortAddress(masterAgentSummary?.address ?? null)}</strong>
        </div>
        <div className="walletInfoTile walletInfoTileCompact">
          <span className="walletLabel">{t("masterAgentHypeBalance")}</span>
          <strong>{masterAgentSummary?.hypeBalance ? `${formatToken(masterAgentSummary.hypeBalance, 4)} HYPE` : "—"}</strong>
        </div>
        <div className="walletInfoTile walletInfoTileCompact">
          <span className="walletLabel">{t("hypeBalanceHint")}</span>
          <strong>{masterAgentSummary ? `${masterAgentSummary.lowHypeThreshold} HYPE` : "—"}</strong>
          <div className="walletMutedText">{masterAgentSummary?.updatedAt ? formatDateTime(masterAgentSummary.updatedAt) : masterAgentStateLabel}</div>
        </div>
      </div>

      <div className="walletAgentStatusRow">
        <div className={agentLaunchNoticeClass}>{agentLaunchNotice}</div>
        {!isConnected ? (
          <div className="walletNotice walletNoticeCompact">{t("agentActions.connectWalletFirst")}</div>
        ) : null}
        {agentActionError ? (
          <div className="walletNotice walletNoticeCompact walletNoticeError">{agentActionError}</div>
        ) : null}
        {agentActionNotice ? (
          <div className="walletNotice walletNoticeCompact">{agentActionNotice}</div>
        ) : null}
      </div>

      {!masterAgentSummary?.address ? (
        <div className="walletAgentControls">
          <button
            type="button"
            className="btn btnPrimary"
            onClick={() => void createAgentWallet()}
            disabled={agentSetupBusy !== null || agentWalletQuery.isLoading}
          >
            {agentSetupBusy === "create" ? t("agentActions.creatingWallet") : t("agentActions.createWallet")}
          </button>
        </div>
      ) : null}

      <div className="walletAgentControls walletAgentThresholdRow">
        <input
          className="input"
          value={agentThresholdInput}
          onChange={(event) => setAgentThresholdInput(event.target.value)}
          placeholder={t("agentActions.thresholdPlaceholder")}
        />
        <button
          type="button"
          className="btn"
          onClick={() => void saveAgentThreshold()}
          disabled={agentSetupBusy !== null || agentWalletQuery.isLoading}
        >
          {agentSetupBusy === "threshold" ? t("agentActions.savingThreshold") : t("agentActions.saveThreshold")}
        </button>
      </div>

      <div className="fundingQuickCardActions fundingQuickCardActionsSplit">
        <button
          type="button"
          className="btn btnPrimary"
          onClick={() => setActiveAgentModal("fund")}
          disabled={!isConnected || !masterAgentSummary?.address || agentActionBusy !== null || isWalletPending}
        >
          {agentActionBusy === "fund" || isWalletPending ? t("agentActions.funding") : t("agentActions.fund")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setActiveAgentModal("withdraw")}
          disabled={!masterAgentSummary?.address || agentActionBusy !== null}
        >
          {agentActionBusy === "withdraw" ? t("agentActions.withdrawing") : t("agentActions.withdraw")}
        </button>
      </div>
    </article>
  );

  return (
    <div className="walletPage">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="walletStack">
        <section className="card walletCard walletBotVaultSystemCard">
          <div className="walletSectionHeader">
            <div className="walletSectionIntro">
              <h3 className="walletSectionTitle">{t("botVaultSystemTitle")}</h3>
              <div className="walletMutedText">{t("botVaultSystemSubtitle")}</div>
            </div>
          </div>
          <div className="walletBotVaultSystemGrid">
            <BotVaultWalletQuickCard onFund={() => setActiveBotVaultSystemModal("botvault_funding")} />
            <FundingVaultQuickCard onManage={() => setActiveBotVaultSystemModal("funding_vault")} />
            {agentWalletCard}
          </div>
        </section>

        <section className="walletEmbeddedSection walletHyperliquidTransferSection">
          <div className="walletSectionDivider" />
          <div className="walletEmbeddedSectionIntro">
            <h3 className="walletSectionTitle">{t("hyperliquidTransfersTitle")}</h3>
            <div className="walletMutedText">{t("hyperliquidTransfersSubtitle")}</div>
          </div>
          <FundingActionCenter fundingConfig={fundingConfig} transferConfig={transferConfig} />
        </section>

        {isConnected ? (
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
        ) : null}
      </div>

      {activeBotVaultSystemModal ? (
        <div className="fundingModalOverlay" role="presentation" onClick={() => setActiveBotVaultSystemModal(null)}>
          <div
            className="fundingModalCard"
            role="dialog"
            aria-modal="true"
            aria-label={
              activeBotVaultSystemModal === "botvault_funding"
                ? tFundingAction("actions.botvaultFunding")
                : tFundingAction("fundingVault.title")
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="walletSectionHeader fundingModalHeader fundingModalHeaderCompact">
              <button
                type="button"
                className="fundingModalCloseButton"
                aria-label={tFundingAction("modal.close")}
                onClick={() => setActiveBotVaultSystemModal(null)}
              >
                ×
              </button>
            </div>
            <div className="fundingModalBody">
              {activeBotVaultSystemModal === "botvault_funding" ? (
                <RelayBotVaultFundingSection config={fundingConfig} presentation="modal" key="relay-botvault-modal" />
              ) : (
                <FundingVaultManagementSection key="funding-vault-modal" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeAgentModal ? (
        <div className="fundingModalOverlay" role="presentation" onClick={() => setActiveAgentModal(null)}>
          <div
            className="fundingModalCard"
            role="dialog"
            aria-modal="true"
            aria-label={activeAgentModal === "fund" ? t("agentActions.fund") : t("agentActions.withdraw")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="walletSectionHeader fundingModalHeader fundingModalHeaderCompact">
              <div>
                <h3 className="walletSectionTitle" style={{ margin: 0 }}>
                  {activeAgentModal === "fund" ? t("agentActions.fund") : t("agentActions.withdraw")}
                </h3>
                <div className="walletMutedText">{t("agentActions.subtitle")}</div>
              </div>
              <button
                type="button"
                className="fundingModalCloseButton"
                aria-label={t("agentActions.closeModal")}
                onClick={() => setActiveAgentModal(null)}
              >
                ×
              </button>
            </div>
            <div className="fundingModalBody">
              <section className="card walletCard fundingModalSection">
                <div className="walletSectionIntro fundingModalTitleBlock">
                  <div className="fundingModalDirectionPill">
                    {activeAgentModal === "fund"
                      ? `${shortAddress(address ?? null)} -> ${shortAddress(masterAgentSummary?.address ?? null)}`
                      : `${shortAddress(masterAgentSummary?.address ?? null)} -> ${t("linkedWallet")}`}
                  </div>
                  <div className="fundingModalAmountMeta">
                    <span>{t("masterAgentHypeBalance")}</span>
                    <strong>{masterAgentSummary?.hypeBalance ? `${formatToken(masterAgentSummary.hypeBalance, 4)} HYPE` : "—"}</strong>
                  </div>
                </div>
                <div className="walletAmountRow fundingAmountActionRow fundingModalAmountRow fundingModalAmountField">
                  <input
                    className="input walletAmountInput"
                    value={activeAgentModal === "fund" ? agentFundHypeInput : agentWithdrawHypeInput}
                    onChange={(event) => {
                      if (activeAgentModal === "fund") {
                        setAgentFundHypeInput(event.target.value);
                      } else {
                        setAgentWithdrawHypeInput(event.target.value);
                      }
                    }}
                    placeholder={
                      activeAgentModal === "fund"
                        ? t("agentActions.fundPlaceholder")
                        : t("agentActions.withdrawPlaceholder")
                    }
                  />
                </div>
                <div className="walletMutedText">{t("agentActions.hint", { chain: TARGET_CHAIN_NAME })}</div>
                <div className="walletActionRow fundingModalPrimaryActionRow">
                  <button type="button" className="btn" onClick={() => setActiveAgentModal(null)}>
                    {t("agentActions.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btnPrimary"
                    onClick={() => void (activeAgentModal === "fund" ? fundAgentWallet() : withdrawAgentWallet())}
                    disabled={!masterAgentSummary?.address || agentActionBusy !== null || (activeAgentModal === "fund" && isWalletPending)}
                  >
                    {activeAgentModal === "fund"
                      ? (agentActionBusy === "fund" || isWalletPending ? t("agentActions.funding") : t("agentActions.fund"))
                      : (agentActionBusy === "withdraw" ? t("agentActions.withdrawing") : t("agentActions.withdraw"))}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

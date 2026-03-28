"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useTranslations } from "next-intl";
import { apiGet } from "../../lib/api";
import type { FundingFeatureConfig } from "../../lib/funding/types";
import { formatDateTime, formatToken, formatUsd, shortAddress } from "../../lib/wallet/format";
import type {
  MasterVaultSummaryResponse,
  WalletActivityResponse,
  WalletFeatureConfig,
  WalletOverviewResponse
} from "../../lib/wallet/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import { masterVaultAbi as masterVaultRuntimeAbi } from "../../lib/wallet/onchainAbi";
import FundingActionCenter from "../funding/FundingActionCenter";
import MasterVaultDepositCard from "./MasterVaultDepositCard";

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
  const [activityOpen, setActivityOpen] = useState(false);
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
  const masterVaultQuery = useQuery({
    queryKey: ["wallet-master-vault"],
    enabled: isConnected,
    queryFn: () => apiGet<MasterVaultSummaryResponse>("/vaults/master")
  });
  const effectiveDepositConfig = useMemo<WalletFeatureConfig>(() => {
    const runtimeMasterVaultAddress = masterVaultQuery.data?.onchainAddress ?? config.masterVault.address;
    const runtimeMasterVaultAbi = config.masterVault.abi ?? (runtimeMasterVaultAddress ? masterVaultRuntimeAbi : null);
    const masterVaultErrors = config.masterVault.errors.filter(
      (entry) => entry !== "invalid_master_vault_address" && entry !== "invalid_master_vault_abi"
    );

    return {
      ...config,
      masterVault: {
        ...config.masterVault,
        address: runtimeMasterVaultAddress,
        abi: runtimeMasterVaultAbi,
        approveSpender: config.masterVault.approveSpender ?? runtimeMasterVaultAddress,
        errors: masterVaultErrors,
        writeEnabled: Boolean(
          runtimeMasterVaultAddress
          && runtimeMasterVaultAbi
          && config.usdc.address
          && config.masterVault.adapter !== "mock"
          && masterVaultErrors.length === 0
        )
      }
    };
  }, [config, masterVaultQuery.data?.onchainAddress]);
  const depositDisabledHint = useMemo(() => {
    if (effectiveDepositConfig.masterVault.writeEnabled) return null;
    if (masterVaultQuery.data?.onchainAddress) {
      return t("masterVaultDepositGenericHint");
    }
    return null;
  }, [effectiveDepositConfig.masterVault.writeEnabled, masterVaultQuery.data?.onchainAddress, t]);
  const masterAgentSummary = masterVaultQuery.data?.agentWalletSummary ?? null;
  const masterAgentStateLabel =
    masterAgentSummary?.lowHypeState === "low"
      ? t("masterAgentLowStateLow")
      : masterAgentSummary?.lowHypeState === "unavailable"
        ? t("masterAgentLowStateUnavailable")
        : t("masterAgentLowStateOk");

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
              <div className="walletMutedText">{masterAgentStateLabel}</div>
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
          </section>

          <MasterVaultDepositCard
            config={effectiveDepositConfig}
            masterVault={masterVaultQuery.data}
            onSuccess={() => Promise.all([overviewQuery.refetch(), activityQuery.refetch(), masterVaultQuery.refetch()]).then(() => undefined)}
            disabledHintOverride={depositDisabledHint}
          />

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

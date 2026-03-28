"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAccount } from "wagmi";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { apiGet } from "../../lib/api";
import { formatToken, formatUsd, shortAddress } from "../../lib/wallet/format";
import type {
  MasterVaultSummaryResponse,
  WalletOverviewResponse
} from "../../lib/wallet/types";
import { TARGET_CHAIN_ID } from "../../lib/web3/config";

function DashboardWalletSkeleton() {
  return (
    <div className="card dashboardInsightCard dashboardWalletCard" aria-hidden="true">
      <div className="dashboardWalletHead">
        <div className="dashboardWalletIntro">
          <div className="skeletonLine skeletonLineLg" />
          <div className="skeletonLine skeletonLineMd" style={{ marginTop: 8 }} />
        </div>
        <div className="skeletonButton" />
      </div>
      <div className="dashboardWalletGrid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="dashboardWalletTile dashboardWalletTileSkeleton">
            <div className="skeletonLine skeletonLineSm" />
            <div className="skeletonLine skeletonLineMd" />
            <div className="skeletonLine skeletonLineSm" />
          </div>
        ))}
      </div>
      <div className="dashboardWalletFooter">
        <div className="skeletonLine skeletonLineMd" />
        <div className="skeletonButton" />
      </div>
    </div>
  );
}

export default function DashboardWalletCard() {
  const t = useTranslations("dashboard.walletCard");
  const locale = useLocale() as AppLocale;
  const { address, isConnected } = useAccount();

  const overviewQuery = useQuery({
    queryKey: ["dashboard-wallet-overview", address],
    enabled: Boolean(isConnected && address),
    queryFn: () => apiGet<WalletOverviewResponse>(`/wallet/${address}/overview`)
  });

  const masterVaultQuery = useQuery({
    queryKey: ["dashboard-wallet-master-vault", address],
    enabled: Boolean(isConnected && address),
    queryFn: () => apiGet<MasterVaultSummaryResponse>("/vaults/master")
  });

  if (!isConnected) return null;

  const walletHref = withLocalePath("/wallet", locale);

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return <DashboardWalletSkeleton />;
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <section className="card dashboardInsightCard dashboardWalletCard dashboardWalletStateCard">
        <div className="dashboardWalletIntro">
          <div className="dashboardWalletTitle">{t("title")}</div>
          <div className="dashboardWalletSubtitle">{t("subtitle")}</div>
        </div>
        <div className="dashboardWalletState">
          <strong>{t("unavailableTitle")}</strong>
          <div className="dashboardWalletMeta">{t("unavailableDescription")}</div>
        </div>
        <div className="dashboardWalletFooter">
          <div className="dashboardWalletFooterMeta">{t("unavailableFooter")}</div>
          <Link href={walletHref} className="btn btnPrimary">
            {t("open")}
          </Link>
        </div>
      </section>
    );
  }

  const overview = overviewQuery.data;
  const masterVault = masterVaultQuery.data;
  const networkReady = overview.network.chainId === TARGET_CHAIN_ID;
  const masterVaultValue =
    masterVaultQuery.isSuccess && masterVault
      ? formatUsd(masterVault.availableUsd)
      : "\u2014";
  const masterAgentSummary = masterVault?.agentWalletSummary ?? null;
  const masterAgentStateLabel =
    masterAgentSummary?.lowHypeState === "low"
      ? t("masterAgentLowStateLow")
      : masterAgentSummary?.lowHypeState === "unavailable"
        ? t("masterAgentLowStateUnavailable")
        : t("masterAgentLowStateOk");

  let masterVaultMeta = t("masterVaultLoading");
  if (masterVaultQuery.isError) {
    masterVaultMeta = t("masterVaultUnavailable");
  } else if (masterVault) {
    masterVaultMeta = t("masterVaultMeta", {
      status: masterVault.status,
      count: masterVault.botVaultCount
    });
  }

  return (
    <section className="card dashboardInsightCard dashboardWalletCard">
      <div className="dashboardWalletHead">
        <div className="dashboardWalletIntro">
          <div className="dashboardWalletTitle">{t("title")}</div>
          <div className="dashboardWalletSubtitle">{t("subtitle")}</div>
        </div>
        <span className={`badge ${networkReady ? "badgeOk" : "badgeWarn"}`}>
          {networkReady ? t("networkReady") : t("networkMismatch")}
        </span>
      </div>

      <div className="dashboardWalletGrid">
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("address")}</span>
          <strong className="dashboardWalletValue">{shortAddress(overview.address)}</strong>
          <span className="dashboardWalletMeta">{overview.network.name}</span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("hypeBalance")}</span>
          <strong className="dashboardWalletValue">
            {formatToken(overview.balances.hype.formatted, 4)} HYPE
          </strong>
          <span className="dashboardWalletMeta">{t("gasBalanceHint")}</span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("usdcBalance")}</span>
          <strong className="dashboardWalletValue">
            {overview.balances.usdc
              ? `${formatToken(overview.balances.usdc.formatted, 4)} USDC`
              : "\u2014"}
          </strong>
          <span className="dashboardWalletMeta">{t("walletAssetHint")}</span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("masterVaultAvailable")}</span>
          <strong className="dashboardWalletValue">{masterVaultValue}</strong>
          <span className="dashboardWalletMeta">{masterVaultMeta}</span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("masterAgentWallet")}</span>
          <strong className="dashboardWalletValue">{shortAddress(masterAgentSummary?.address ?? null)}</strong>
          <span className="dashboardWalletMeta">
            {masterAgentSummary?.hypeBalance ? `${formatToken(masterAgentSummary.hypeBalance, 4)} HYPE · ${masterAgentStateLabel}` : masterAgentStateLabel}
          </span>
        </div>
      </div>

      <div className="dashboardWalletFooter">
        <div className="dashboardWalletFooterMeta">
          {t("vaultSummary", {
            count: overview.vaultSummary.count,
            value: formatUsd(overview.vaultSummary.totalEquityUsd)
          })}
        </div>
        <Link href={walletHref} className="btn btnPrimary">
          {t("open")}
        </Link>
      </div>
    </section>
  );
}

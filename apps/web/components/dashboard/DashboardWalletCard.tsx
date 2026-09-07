"use client";
import { DeskLink } from "@/components/desk/DeskLink";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskSurface } from "@/components/desk/DeskSurface";
import { GlassSkeleton } from "@/components/einui/liquid-glass/glass-skeleton";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAccount } from "wagmi";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { apiGet } from "../../lib/api";
import { formatToken, formatUsd, shortAddress } from "../../lib/wallet/format";
import type {
  AgentWalletSummaryResponse,
  WalletOverviewResponse
} from "../../lib/wallet/types";
import { TARGET_CHAIN_ID } from "../../lib/web3/config";
import { AppIcon } from "../../app/components/AppIcon";
import Web3Providers from "../../app/components/Web3Providers";

type FundingVaultOverview = {
  fundingVault?: {
    onchainAddress: string | null;
    availableBalance: number;
    reservedBalance: number;
    status: string;
  } | null;
  ready?: boolean;
};

function DashboardWalletSkeleton() {
  return (
    <DeskSurface dense><div className="card dashboardInsightCard dashboardWalletCard" aria-hidden="true">
      <div className="dashboardWalletHead">
        <div className="dashboardWalletIntro">
          <GlassSkeleton className="skeletonLine skeletonLineLg" />
          <GlassSkeleton className="skeletonLine skeletonLineMd" style={{ marginTop: 8 }} />
        </div>
        <GlassSkeleton className="skeletonButton" />
      </div>
      <div className="dashboardWalletGrid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="dashboardWalletTile dashboardWalletTileSkeleton">
            <GlassSkeleton className="skeletonLine skeletonLineSm" />
            <GlassSkeleton className="skeletonLine skeletonLineMd" />
            <GlassSkeleton className="skeletonLine skeletonLineSm" />
          </div>
        ))}
      </div>
      <div className="dashboardWalletFooter">
        <GlassSkeleton className="skeletonLine skeletonLineMd" />
        <GlassSkeleton className="skeletonButton" />
      </div>
    </div></DeskSurface>
  );
}

function DashboardWalletCardContent() {
  const t = useTranslations("dashboard.walletCard");
  const locale = useLocale() as AppLocale;
  const { address, isConnected } = useAccount();
  const walletHref = withLocalePath("/wallet", locale);

  const overviewQuery = useQuery({
    queryKey: ["dashboard-wallet-overview", address],
    enabled: Boolean(isConnected && address),
    queryFn: () => apiGet<WalletOverviewResponse>(`/wallet/${address}/overview`)
  });

  const agentWalletQuery = useQuery({
    queryKey: ["dashboard-wallet-agent-wallet", address],
    enabled: Boolean(isConnected && address),
    queryFn: () => apiGet<AgentWalletSummaryResponse>("/agent-wallet")
  });

  const fundingVaultQuery = useQuery({
    queryKey: ["dashboard-wallet-funding-vault", address],
    enabled: Boolean(isConnected && address),
    queryFn: () => apiGet<FundingVaultOverview>("/vaults/funding-vault"),
    staleTime: 10_000,
    refetchOnWindowFocus: false
  });

  if (!isConnected) {
    return (
      <DeskSurface dense><section className="card dashboardInsightCard dashboardWalletCard dashboardWalletStateCard">
        <div className="dashboardWalletIntro">
          <div className="dashboardWalletTitle">{t("title")}</div>
          <div className="dashboardWalletSubtitle">{t("subtitle")}</div>
        </div>
        <div className="dashboardWalletState">
          <strong>{t("title")}</strong>
          <div className="dashboardWalletMeta">{t("subtitle")}</div>
        </div>
        <div className="dashboardWalletFooter">
          <div className="dashboardWalletFooterMeta">{t("unavailableFooter")}</div>
          <DeskLink href={walletHref} className="btn btnPrimary">
            <AppIcon name="wallet" />
            {t("open")}
          </DeskLink>
        </div>
      </section></DeskSurface>
    );
  }

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return <DashboardWalletSkeleton />;
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <DeskSurface dense><section className="card dashboardInsightCard dashboardWalletCard dashboardWalletStateCard">
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
          <DeskLink href={walletHref} className="btn btnPrimary">
            <AppIcon name="wallet" />
            {t("open")}
          </DeskLink>
        </div>
      </section></DeskSurface>
    );
  }

  const overview = overviewQuery.data;
  const networkReady = overview.network.chainId === TARGET_CHAIN_ID;
  const botVaultValue = formatUsd(overview.vaultSummary.totalEquityUsd);
  const agentWallet = agentWalletQuery.data ?? null;
  const fundingVault = fundingVaultQuery.data?.fundingVault ?? null;
  const fundingVaultAddress = fundingVault?.onchainAddress ?? null;
  const fundingVaultBalance = fundingVaultAddress
    ? `${formatToken(fundingVault?.availableBalance ?? null, 2)} USDC`
    : "\u2014";
  const fundingVaultMeta = fundingVaultQuery.isLoading
    ? t("fundingWalletLoading")
    : fundingVaultAddress
      ? t("fundingWalletMeta", {
          reserved: `${formatToken(fundingVault?.reservedBalance ?? 0, 2)} USDC`
        })
      : t("fundingWalletSetupRequired");
  const masterAgentStateLabel =
    agentWallet?.lowHypeState === "low"
      ? t("masterAgentLowStateLow")
      : agentWallet?.lowHypeState === "unavailable"
        ? t("masterAgentLowStateUnavailable")
        : t("masterAgentLowStateOk");

  const botVaultMeta = t("masterVaultMeta", {
    status: "ready",
    count: overview.vaultSummary.count
  });

  return (
    <DeskSurface dense><section className="card dashboardInsightCard dashboardWalletCard">
      <div className="dashboardWalletHead">
        <div className="dashboardWalletIntro">
          <div className="dashboardWalletTitle">{t("title")}</div>
          <div className="dashboardWalletSubtitle">{t("subtitle")}</div>
        </div>
        <DeskBadge className={`badge ${networkReady ? "badgeOk" : "badgeWarn"}`}>
          {networkReady ? t("networkReady") : t("networkMismatch")}
        </DeskBadge>
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
          <strong className="dashboardWalletValue">{botVaultValue}</strong>
          <span className="dashboardWalletMeta">{botVaultMeta}</span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("fundingWallet")}</span>
          <strong className="dashboardWalletValue">{fundingVaultAddress ? shortAddress(fundingVaultAddress) : "\u2014"}</strong>
          <span className="dashboardWalletMeta">
            {t("fundingWalletBalance", { balance: fundingVaultBalance })} · {fundingVaultMeta}
          </span>
        </div>
        <div className="dashboardWalletTile">
          <span className="dashboardWalletLabel">{t("masterAgentWallet")}</span>
          <strong className="dashboardWalletValue">{shortAddress(agentWallet?.address ?? null)}</strong>
          <span className="dashboardWalletMeta">
            {agentWallet?.hypeBalance ? `${formatToken(agentWallet.hypeBalance, 4)} HYPE · ${masterAgentStateLabel}` : masterAgentStateLabel}
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
        <DeskLink href={walletHref} className="btn btnPrimary">
          <AppIcon name="wallet" />
          {t("open")}
        </DeskLink>
      </div>
    </section></DeskSurface>
  );
}

export default function DashboardWalletCard() {
  return (
    <Web3Providers>
      <DashboardWalletCardContent />
    </Web3Providers>
  );
}

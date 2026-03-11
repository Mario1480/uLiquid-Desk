"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { switchChain } from "wagmi/actions";
import { useLocale, useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { apiGet } from "../../lib/api";
import { wagmiConfig } from "../../lib/web3/config";
import { openWeb3Modal } from "../../lib/web3/modal";
import { buildExplorerAddressUrl, formatDateTime, formatToken, formatUsd, shortAddress } from "../../lib/wallet/format";
import type { WalletActivityResponse, WalletFeatureConfig, WalletOverviewResponse } from "../../lib/wallet/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import { masterVaultAbi as masterVaultRuntimeAbi } from "../../lib/wallet/onchainAbi";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import FundingTransferSection from "../funding/FundingTransferSection";
import MasterVaultDepositCard from "./MasterVaultDepositCard";

function WalletSkeletonCard() {
  return (
    <article className="card walletCard">
      <div className="skeletonLine skeletonLineLg" />
      <div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
      <div className="skeletonLine skeletonLineSm" style={{ marginTop: 18 }} />
    </article>
  );
}

type MasterVaultSummaryResponse = {
  id: string;
  userId: string;
  onchainAddress: string | null;
  freeBalance: number;
  reservedBalance: number;
  withdrawableBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalAllocatedUsd: number;
  totalRealizedNetUsd: number;
  totalProfitShareAccruedUsd: number;
  totalWithdrawnUsd: number;
  availableUsd: number;
  status: string;
  botVaultCount: number;
  updatedAt: string | null;
};

type AuthMeResponse = {
  user?: {
    id: string;
    email: string;
    walletAddress?: string | null;
  };
  walletAddress?: string | null;
};

function normalizeWalletAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export default function WalletDashboardClient({
  config,
  transferConfig
}: {
  config: WalletFeatureConfig;
  transferConfig: TransferFeatureConfig;
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("wallet.dashboard");
  const tCommon = useTranslations("wallet.common");
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);
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
  const meQuery = useQuery({
    queryKey: ["wallet-auth-me"],
    enabled: isConnected,
    queryFn: () => apiGet<AuthMeResponse>("/auth/me")
  });
  const masterVaultQuery = useQuery({
    queryKey: ["wallet-master-vault"],
    enabled: isConnected,
    queryFn: () => apiGet<MasterVaultSummaryResponse>("/vaults/master")
  });
  const networkBalance = useBalance({
    address: address as `0x${string}` | undefined,
    chainId: config.chain.id,
    query: {
      enabled: Boolean(address)
    }
  });

  const chainMismatch = isConnected && chainId !== config.chain.id;
  const explorerAddressUrl = useMemo(
    () => (address ? buildExplorerAddressUrl(config.chain.explorerUrl, address) : null),
    [address, config.chain.explorerUrl]
  );
  const linkedWalletAddress = String(meQuery.data?.walletAddress ?? meQuery.data?.user?.walletAddress ?? "").trim() || null;
  const walletLinkMissing = !linkedWalletAddress;
  const walletLinkMismatch = Boolean(
    linkedWalletAddress
    && address
    && normalizeWalletAddress(linkedWalletAddress) !== normalizeWalletAddress(address)
  );
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

  async function handleCopyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function handleConnect() {
    await openWeb3Modal({ view: "Connect" });
  }

  async function handleSwitchChain() {
    await switchChain(wagmiConfig, { chainId: config.chain.id });
  }

  function handleDisconnect() {
    disconnect();
  }

  return (
    <div className="walletPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
      </div>

      <section className="walletMetricsGrid">
        {overviewQuery.isLoading && isConnected ? (
          <>
            <WalletSkeletonCard />
            <WalletSkeletonCard />
          </>
        ) : (
          <>
            <article className="card walletCard walletMetricCard">
              <span className="walletLabel">{t("connectedWallet")}</span>
              <strong className="walletMetricValue">{shortAddress(address)}</strong>
              <div className="walletMutedText">
                {t("linkedWallet")}: {linkedWalletAddress ? shortAddress(linkedWalletAddress) : t("notLinked")}
              </div>
              <div className="walletCardActions">
                <span className={`badge ${walletLinkMissing || walletLinkMismatch ? "badgeWarn" : "badgeOk"}`}>
                  {walletLinkMissing
                    ? t("linkMissing")
                    : walletLinkMismatch
                      ? t("linkMismatch")
                      : t("linkReady")}
                </span>
              </div>
              <div className="walletActionRow walletCardActions">
                <button type="button" className="btn" onClick={() => void handleCopyAddress()} disabled={!address}>
                  {copied ? tCommon("copied") : tCommon("copyAddress")}
                </button>
                {(walletLinkMissing || walletLinkMismatch) ? (
                  <Link className="btn" href={withLocalePath("/settings", locale)}>
                    {t("openSettings")}
                  </Link>
                ) : null}
                {explorerAddressUrl ? (
                  <a className="btn" href={explorerAddressUrl} target="_blank" rel="noreferrer">
                    {tCommon("explorer")}
                  </a>
                ) : null}
                {isConnected ? (
                  <button type="button" className="btn" onClick={handleDisconnect}>
                    {t("disconnect")}
                  </button>
                ) : null}
              </div>
            </article>

            <article className="card walletCard walletMetricCard">
              <div className="walletSectionHeader">
                <div className="walletSectionIntro">
                  <span className="walletLabel">{t("network")}</span>
                  <strong className="walletMetricValue walletMetricValueSm">{config.chain.name}</strong>
                </div>
                <span className={`badge ${chainMismatch ? "badgeWarn" : isConnected ? "badgeOk" : ""}`}>
                  {!isConnected ? tCommon("disconnected") : chainMismatch ? tCommon("wrongNetwork") : tCommon("connected")}
                </span>
              </div>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("hypeBalance")}</span>
                  <strong className="walletMetricValue">
                    {formatToken(
                      overviewQuery.data?.balances.hype.formatted
                      ?? formatUnits(networkBalance.data?.value ?? BigInt(0), 18),
                      4
                    )} HYPE
                  </strong>
                  <div className="walletMutedText">{t("hypeBalanceHint")}</div>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("usdcBalance")}</span>
                  <strong className="walletMetricValue">{formatToken(overviewQuery.data?.balances.usdc?.formatted ?? "0", 2)} USDC</strong>
                  <div className="walletMutedText">{t("configAddress", { address: shortAddress(config.usdc.address) })}</div>
                </div>
              </div>
            </article>
          </>
        )}
      </section>

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
          <div className="walletTwoColumnGrid">
            <div className="walletStack">
              <section className="card walletCard">
                <div className="walletSectionHeader">
                  <div className="walletSectionIntro">
                    <h3 className="walletSectionTitle">{t("recentActivityTitle")}</h3>
                    <div className="walletMutedText">{t("recentActivitySubtitle")}</div>
                  </div>
                </div>
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
                          <strong>{item.symbol ?? tCommon("asset")}</strong>
                          <div className="walletMutedText">{item.side ?? tCommon("trade")} · {formatToken(item.size, 3)} @ {formatToken(item.price, 4)}</div>
                        </div>
                        <div className="walletActivitySecondary">
                          <strong>{item.closedPnlUsd === null ? "—" : formatUsd(item.closedPnlUsd)}</strong>
                          <div className="walletMutedText">{formatDateTime(item.timestamp)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="walletMutedText">{t("noRecentActivity")}</div>
                )}
              </section>
            </div>

            <div className="walletStack">
              <MasterVaultDepositCard
                config={effectiveDepositConfig}
                onSuccess={() => Promise.all([overviewQuery.refetch(), activityQuery.refetch(), masterVaultQuery.refetch()]).then(() => undefined)}
                disabledHintOverride={depositDisabledHint}
              />
            </div>
          </div>

          <section className="walletEmbeddedSection">
            <div className="walletEmbeddedSectionIntro">
              <h3 className="walletSectionTitle">{t("fundingSectionTitle")}</h3>
              <div className="walletMutedText">{t("fundingSectionSubtitle")}</div>
            </div>
            <FundingTransferSection config={transferConfig} />
          </section>
        </div>
      )}
    </div>
  );
}

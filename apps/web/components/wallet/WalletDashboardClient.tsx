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
import { withLocalePath, type AppLocale } from "../../i18n/config";
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

export default function WalletDashboardClient({ config }: { config: WalletFeatureConfig }) {
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
  const displayedMasterVaultAddress = masterVaultQuery.data?.onchainAddress ?? overviewQuery.data?.masterVault.address ?? config.masterVault.address;

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
        <div className="walletActionRow">
          <Link className="btn" href={withLocalePath("/vaults", locale)}>{t("viewVaults")}</Link>
          {!isConnected ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleConnect()}>
              {t("connectWallet")}
            </button>
          ) : chainMismatch ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleSwitchChain()}>
              {t("switchToChain", { chain: config.chain.name })}
            </button>
          ) : (
            <button type="button" className="btn" onClick={handleDisconnect}>
              {t("disconnect")}
            </button>
          )}
        </div>
      </div>

      <section className="walletMetricsGrid">
        {overviewQuery.isLoading && isConnected ? (
          <>
            <WalletSkeletonCard />
            <WalletSkeletonCard />
            <WalletSkeletonCard />
            <WalletSkeletonCard />
          </>
        ) : (
          <>
            <article className="card walletCard walletMetricCard">
              <span className="walletLabel">{t("connectedWallet")}</span>
              <strong className="walletMetricValue">{shortAddress(address)}</strong>
              <div className="walletActionRow walletCardActions">
                <button type="button" className="btn" onClick={() => void handleCopyAddress()} disabled={!address}>
                  {copied ? tCommon("copied") : tCommon("copyAddress")}
                </button>
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
              <span className="walletLabel">{t("network")}</span>
              <strong className="walletMetricValue walletMetricValueSm">{config.chain.name}</strong>
              <div className="walletCardActions">
                <span className={`badge ${chainMismatch ? "badgeWarn" : isConnected ? "badgeOk" : ""}`}>
                  {!isConnected ? tCommon("disconnected") : chainMismatch ? tCommon("wrongNetwork") : tCommon("connected")}
                </span>
              </div>
            </article>

            <article className="card walletCard walletMetricCard">
              <span className="walletLabel">{t("hypeBalance")}</span>
              <strong className="walletMetricValue">
                {formatToken(
                  overviewQuery.data?.balances.hype.formatted
                  ?? formatUnits(networkBalance.data?.value ?? BigInt(0), 18),
                  4
                )} HYPE
              </strong>
              <div className="walletMutedText walletMetricFoot">{t("hypeBalanceHint")}</div>
            </article>

            <article className="card walletCard walletMetricCard">
              <span className="walletLabel">{t("usdcBalance")}</span>
              <strong className="walletMetricValue">{formatToken(overviewQuery.data?.balances.usdc?.formatted ?? "0", 2)} USDC</strong>
              <div className="walletMutedText walletMetricFoot">{t("configAddress", { address: shortAddress(config.usdc.address) })}</div>
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
        <div className="walletTwoColumnGrid">
          <div className="walletStack">
            <section className="card walletCard">
              <div className="walletSectionHeader">
                <div className="walletSectionIntro">
                  <h3 className="walletSectionTitle">{t("overviewTitle")}</h3>
                  <div className="walletMutedText">{t("overviewSubtitle")}</div>
                </div>
              </div>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("vaultExposures")}</span>
                  <strong>{overviewQuery.data?.vaultSummary.count ?? 0}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("vaultEquity")}</span>
                  <strong>{formatUsd(overviewQuery.data?.vaultSummary.totalEquityUsd ?? 0)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("walletRole")}</span>
                  <strong>{overviewQuery.data?.role ?? "—"}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("lastRefresh")}</span>
                  <strong>{formatDateTime(overviewQuery.data?.updatedAt)}</strong>
                </div>
              </div>
            </section>

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
              config={config}
              onSuccess={() => Promise.all([overviewQuery.refetch(), activityQuery.refetch(), masterVaultQuery.refetch()]).then(() => undefined)}
            />
            <section className="card walletCard">
              <div className="walletSectionHeader">
                <div className="walletSectionIntro">
                  <h3 className="walletSectionTitle">{t("masterVaultStatusTitle")}</h3>
                  <div className="walletMutedText">{t("masterVaultStatusSubtitle")}</div>
                </div>
              </div>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("contract")}</span>
                  <strong>{shortAddress(displayedMasterVaultAddress)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("usdc")}</span>
                  <strong>{shortAddress(config.usdc.address)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("adapter")}</span>
                  <strong>{config.masterVault.adapter}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("writeMode")}</span>
                  <strong>{config.masterVault.writeEnabled ? tCommon("ready") : tCommon("readOnly")}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("walletRole")}</span>
                  <strong>{masterVaultQuery.data?.status ?? "—"}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("vaultExposures")}</span>
                  <strong>{masterVaultQuery.data?.botVaultCount ?? 0}</strong>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

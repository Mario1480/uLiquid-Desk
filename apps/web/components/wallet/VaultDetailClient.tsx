"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { apiGet } from "../../lib/api";
import { buildExplorerAddressUrl, formatDateTime, formatPct, formatUsd, shortAddress } from "../../lib/wallet/format";
import type { VaultDetailResponse, WalletFeatureConfig } from "../../lib/wallet/types";
import { withLocalePath, type AppLocale } from "../../i18n/config";

export default function VaultDetailClient({
  config,
  vaultAddress
}: {
  config: WalletFeatureConfig;
  vaultAddress: string;
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("wallet.detail");
  const tCommon = useTranslations("wallet.common");
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["vault-detail", vaultAddress, address],
    queryFn: () =>
      apiGet<VaultDetailResponse>(
        `/vaults/${vaultAddress}${address ? `?user=${encodeURIComponent(address)}` : ""}`
      )
  });

  const chartData = (query.data?.performance.points ?? []).map((point) => ({
    time: formatDateTime(point.time),
    value: point.value,
    pnl: point.pnl
  }));

  return (
    <div className="walletPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{query.data?.name ?? t("fallbackTitle")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <div className="walletActionRow">
          <a
            className="btn"
            href={buildExplorerAddressUrl(config.chain.explorerUrl, vaultAddress)}
            target="_blank"
            rel="noreferrer"
          >
            {tCommon("explorer")}
          </a>
          <Link className="btn" href={withLocalePath("/vaults", locale)}>{tCommon("backToVaults")}</Link>
        </div>
      </div>

      {query.isLoading ? (
        <div className="walletTwoColumnGrid">
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
        </div>
      ) : query.error ? (
        <div className="walletNotice walletNoticeError">
          {String((query.error as Error)?.message ?? t("loadError"))}
        </div>
      ) : query.data ? (
        <div className="walletStack">
          <section className="card walletCard walletDetailHero">
            <div className="walletSectionHeader">
              <div className="walletSectionIntro">
                <h3 className="walletSectionTitle">{query.data.name ?? t("unnamedVault")}</h3>
                <div className="walletMutedText">{shortAddress(query.data.vaultAddress)}</div>
              </div>
              <span className="badge">{query.data.userRole ?? tCommon("publicRole")}</span>
            </div>
            <p className="walletMutedText walletVaultDescription">{query.data.description ?? t("noDescription")}</p>
            <div className="walletInfoGrid walletDetailSummaryGrid">
              <div className="walletInfoTile">
                <span className="walletLabel">{t("leader")}</span>
                <strong>{shortAddress(query.data.leader)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("updated")}</span>
                <strong>{formatDateTime(query.data.updatedAt)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("yourEquity")}</span>
                <strong>{formatUsd(query.data.userEquityUsd)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("vaultTvl")}</span>
                <strong>{formatUsd(query.data.tvlUsd)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("followers")}</span>
                <strong>{query.data.followerCount ?? "—"}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("apr")}</span>
                <strong>{formatPct(query.data.apr)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("allTimeReturn")}</span>
                <strong>{formatPct(query.data.allTimeReturnPct)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("maxDrawdown")}</span>
                <strong>{formatPct(query.data.maxDrawdownPct)}</strong>
              </div>
            </div>
          </section>

          <section className="card walletCard">
            <div className="walletSectionHeader">
              <div className="walletSectionIntro">
                <h3 className="walletSectionTitle">{t("performanceTitle")}</h3>
                <div className="walletMutedText">{t("performanceSubtitle")}</div>
              </div>
            </div>
            <div className="walletInfoGrid">
              <div className="walletInfoTile">
                <span className="walletLabel">{t("yourEquity")}</span>
                <strong>{formatUsd(query.data.userEquityUsd)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("vaultTvl")}</span>
                <strong>{formatUsd(query.data.tvlUsd)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("apr")}</span>
                <strong>{formatPct(query.data.apr)}</strong>
              </div>
              <div className="walletInfoTile">
                <span className="walletLabel">{t("allTimeReturn")}</span>
                <strong>{formatPct(query.data.allTimeReturnPct)}</strong>
              </div>
            </div>
          </section>

          <section className="card walletCard walletChartCard">
            <div className="walletSectionHeader">
              <div className="walletSectionIntro">
                <h3 className="walletSectionTitle">{t("performanceTitle")}</h3>
                <div className="walletMutedText">{t("performanceSubtitle")}</div>
              </div>
            </div>
            {chartData.length ? (
              <div className="walletChartWrap">
                <ResponsiveContainer>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="vaultEquityGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#ffc107" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#ffc107" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: "rgba(232,238,247,0.75)", fontSize: 12 }} />
                    <YAxis tick={{ fill: "rgba(232,238,247,0.75)", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#101826",
                        border: "1px solid rgba(255,193,7,0.28)",
                        borderRadius: 12
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#ffc107"
                      fill="url(#vaultEquityGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="walletMutedText">{t("noChartData")}</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

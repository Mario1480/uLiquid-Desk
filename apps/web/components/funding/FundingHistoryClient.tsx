"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { apiGet } from "../../lib/api";
import {
  buildExplorerAddressUrl,
  formatDateTime,
  shortAddress
} from "../../lib/wallet/format";
import type { FundingFeatureConfig, FundingHistoryResponse } from "../../lib/funding/types";
import { withLocalePath, type AppLocale } from "../../i18n/config";

type FundingCommonTranslator = (key: string, values?: Record<string, string | number>) => string;

function statusBadgeClass(status: FundingHistoryResponse["items"][number]["status"]): string {
  if (status === "confirmed") return "badgeOk";
  if (status === "failed") return "badgeDanger";
  if (status === "submitted") return "badgeWarn";
  return "";
}

function resolveExplorerUrl(config: FundingFeatureConfig, chainId: number | null, txHash: string | null): string | null {
  if (!txHash) return null;
  const base =
    chainId === config.arbitrum.chainId
      ? config.arbitrum.explorerUrl
      : chainId === config.hyperEvm.id
        ? config.hyperEvm.explorerUrl
        : null;
  return base ? `${base.replace(/\/$/, "")}/tx/${txHash}` : null;
}

function translateLocation(
  tCommon: FundingCommonTranslator,
  value: string | null
): string {
  if (value === "arbitrum") return tCommon("locationArbitrum");
  if (value === "hyperCore") return tCommon("locationHyperCore");
  if (value === "hyperEvm") return tCommon("locationHyperEvm");
  if (value === "masterVault") return tCommon("locationMasterVault");
  return "—";
}

export default function FundingHistoryClient({ config }: { config: FundingFeatureConfig }) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("funding.history");
  const tCommon = useTranslations("funding.common");
  const { address, isConnected } = useAccount();
  const historyQuery = useQuery({
    queryKey: ["funding-history", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<FundingHistoryResponse>(`/funding/${address}/history`)
  });

  return (
    <div className="walletPage fundingPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <div className="walletActionRow">
          <Link className="btn" href={withLocalePath("/funding", locale)}>
            {t("backToFunding")}
          </Link>
        </div>
      </div>

      {!isConnected ? (
        <div className="card walletCard walletEmptyState">
          <h3 style={{ marginTop: 0 }}>{t("connectTitle")}</h3>
          <div className="walletMutedText">{t("connectDescription")}</div>
        </div>
      ) : historyQuery.isLoading ? (
        <div className="walletStack">
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
        </div>
      ) : historyQuery.error ? (
        <div className="walletNotice walletNoticeError">
          {String((historyQuery.error as Error)?.message ?? t("loadError"))}
        </div>
      ) : (
        <div className="walletStack">
          <section className="card walletCard">
            <div className="walletSectionHeader">
              <div className="walletSectionIntro">
                <h3 className="walletSectionTitle">{t("trackingModeTitle")}</h3>
                <div className="walletMutedText">{historyQuery.data?.trackingMode ?? "lightweight"}</div>
              </div>
              {address ? (
                <a className="btn" href={buildExplorerAddressUrl(config.hyperEvm.explorerUrl, address)} target="_blank" rel="noreferrer">
                  {tCommon("hyperEvmExplorer")}
                </a>
              ) : null}
            </div>
            <div className="walletNotice">{historyQuery.data?.note ?? t("trackingNoteFallback")}</div>
          </section>

          {historyQuery.data?.items?.length ? (
            <div className="walletStack">
              {historyQuery.data.items.map((item) => {
                const txUrl = resolveExplorerUrl(config, item.chainId, item.txHash);
                return (
                  <article key={item.id} className="card walletCard">
                    <div className="walletSectionHeader">
                      <div className="walletSectionIntro">
                        <h3 className="walletSectionTitle">{item.title}</h3>
                        <div className="walletMutedText">{item.description}</div>
                      </div>
                      <span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="walletInfoGrid">
                      <div className="walletInfoTile">
                        <span className="walletLabel">{t("from")}</span>
                        <strong>{translateLocation(tCommon, item.locationFrom)}</strong>
                      </div>
                      <div className="walletInfoTile">
                        <span className="walletLabel">{t("to")}</span>
                        <strong>{translateLocation(tCommon, item.locationTo)}</strong>
                      </div>
                      <div className="walletInfoTile">
                        <span className="walletLabel">{t("created")}</span>
                        <strong>{formatDateTime(item.createdAt)}</strong>
                      </div>
                      <div className="walletInfoTile">
                        <span className="walletLabel">{t("txHash")}</span>
                        <strong>{shortAddress(item.txHash)}</strong>
                      </div>
                    </div>
                    <div className="walletActionRow walletCardActions">
                      {txUrl ? (
                        <a className="btn" href={txUrl} target="_blank" rel="noreferrer">
                          {tCommon("explorer")}
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="card walletCard walletEmptyState">
              <h3 style={{ marginTop: 0 }}>{t("emptyTitle")}</h3>
              <div className="walletMutedText">{t("emptyDescription")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

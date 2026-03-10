"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useLocale, useTranslations } from "next-intl";
import { apiGet } from "../../lib/api";
import { formatPct, formatUsd, shortAddress } from "../../lib/wallet/format";
import type { WalletFeatureConfig, WalletVaultsResponse } from "../../lib/wallet/types";
import { withLocalePath, type AppLocale } from "../../i18n/config";

export default function VaultsIndexClient({ _config }: { _config: WalletFeatureConfig }) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("wallet.vaults");
  const tCommon = useTranslations("wallet.common");
  const { address, isConnected } = useAccount();
  const vaultsQuery = useQuery({
    queryKey: ["wallet-vaults", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletVaultsResponse>(`/wallet/${address}/vaults`)
  });

  return (
    <div className="walletPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <Link className="btn" href={withLocalePath("/wallet", locale)}>{tCommon("backToWallet")}</Link>
      </div>

      {!isConnected ? (
        <div className="card walletCard walletEmptyState">
          <h3 style={{ marginTop: 0 }}>{t("connectTitle")}</h3>
          <div className="walletMutedText">{t("connectDescription")}</div>
        </div>
      ) : vaultsQuery.error ? (
        <div className="walletNotice walletNoticeError">
          {String((vaultsQuery.error as Error)?.message ?? t("loadError"))}
        </div>
      ) : vaultsQuery.isLoading ? (
        <div className="walletVaultGrid">
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
          <div className="card walletCard"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
        </div>
      ) : vaultsQuery.data?.items?.length ? (
        <div className="walletVaultGrid">
          {vaultsQuery.data.items.map((vault) => (
            <article key={vault.vaultAddress} className="card walletCard walletVaultCard">
              <div className="walletSectionHeader">
                <div className="walletSectionIntro">
                  <h3 className="walletSectionTitle">{vault.name ?? t("unnamedVault")}</h3>
                  <div className="walletMutedText">{shortAddress(vault.vaultAddress)}</div>
                </div>
                <span className="badge">{vault.userRole ?? tCommon("vaultRole")}</span>
              </div>
              <p className="walletMutedText walletVaultDescription">{vault.description ?? t("noDescription")}</p>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("yourEquity")}</span>
                  <strong>{formatUsd(vault.userEquityUsd)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("apr")}</span>
                  <strong>{formatPct(vault.apr)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("allTimeReturn")}</span>
                  <strong>{formatPct(vault.allTimeReturnPct)}</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("followers")}</span>
                  <strong>{vault.followerCount ?? "—"}</strong>
                </div>
              </div>
              <div className="walletActionRow walletCardActions">
                <Link className="btn btnPrimary" href={withLocalePath(`/vaults/${vault.vaultAddress}`, locale)}>
                  {t("openVault")}
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card walletCard walletEmptyState">
          <h3 style={{ marginTop: 0 }}>{t("emptyTitle")}</h3>
          <div className="walletMutedText">{t("emptyDescription")}</div>
        </div>
      )}
    </div>
  );
}

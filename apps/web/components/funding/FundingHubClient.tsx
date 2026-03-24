"use client";

import { useAccount } from "wagmi";
import { useTranslations } from "next-intl";
import type { FundingFeatureConfig } from "../../lib/funding/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import FundingActionCenter from "./FundingActionCenter";
import { shortAddress } from "../../lib/wallet/format";

export default function FundingHubClient({
  config,
  fundingConfig
}: {
  config: TransferFeatureConfig;
  fundingConfig: FundingFeatureConfig;
}) {
  const t = useTranslations("funding.overview");
  const { address } = useAccount();

  return (
    <div className="walletPage fundingPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
      </div>

      <div className="walletStack">
        <section className="card walletCard fundingHeroCard">
          <div className="walletSectionHeader">
            <div className="walletSectionIntro">
              <h3 className="walletSectionTitle">{t("walletTitle")}</h3>
              <div className="walletMutedText">{t("walletSubtitle")}</div>
            </div>
            <span className="badge">{address ? shortAddress(address) : t("connectTitle")}</span>
          </div>

          <div className="walletInfoGrid fundingHeroGrid">
            <div className="walletInfoTile">
              <span className="walletLabel">{t("calloutDomainsTitle")}</span>
              <strong>{t("hyperCoreCardTitle")} / {t("hyperEvmCardTitle")}</strong>
              <div className="walletMutedText">{t("subtitle")}</div>
            </div>
            <div className="walletInfoTile">
              <span className="walletLabel">{t("calloutCoreGasTitle")}</span>
              <strong>{t("statusLive")}</strong>
              <div className="walletMutedText">{t("calloutCoreGasBody")}</div>
            </div>
            <div className="walletInfoTile">
              <span className="walletLabel">{t("calloutEvmGasTitle")}</span>
              <strong>{t("statusLive")}</strong>
              <div className="walletMutedText">{t("calloutEvmGasBody")}</div>
            </div>
          </div>
        </section>

        <FundingActionCenter fundingConfig={fundingConfig} transferConfig={config} />
      </div>
    </div>
  );
}

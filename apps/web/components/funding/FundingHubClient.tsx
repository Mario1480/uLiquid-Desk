"use client";

import { useTranslations } from "next-intl";
import type { FundingFeatureConfig } from "../../lib/funding/types";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import FundingActionCenter from "./FundingActionCenter";

export default function FundingHubClient({
  config,
  fundingConfig
}: {
  config: TransferFeatureConfig;
  fundingConfig: FundingFeatureConfig;
}) {
  const t = useTranslations("funding.overview");

  return (
    <div className="walletPage fundingPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
      </div>

      <div className="walletStack">
        <FundingActionCenter fundingConfig={fundingConfig} transferConfig={config} />
      </div>
    </div>
  );
}

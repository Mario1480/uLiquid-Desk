"use client";

import { useTranslations } from "next-intl";
import type { TransferFeatureConfig } from "../../lib/transfers/types";
import FundingTransferSection from "./FundingTransferSection";

export default function FundingHubClient({ config }: { config: TransferFeatureConfig }) {
  const t = useTranslations("funding.overview");

  return (
    <div className="walletPage fundingPage">
      <div className="dashboardHeader">
        <div className="walletHeaderIntro">
          <h2 className="walletPageTitle">{t("title")}</h2>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
      </div>

      <FundingTransferSection config={config} />
    </div>
  );
}

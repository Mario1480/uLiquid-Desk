"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import VaultsIndexClient from "../../components/wallet/VaultsIndexClient";
import { getWalletFeatureConfig } from "../../lib/wallet/config";
import { apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap
} from "../../src/access/productFeatureGates";

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

export default function VaultsPage() {
  const locale = useLocale() as AppLocale;
  const tCommon = useTranslations("common");
  const config = useMemo(() => getWalletFeatureConfig(), []);
  const [vaultsEnabled, setVaultsEnabled] = useState(true);

  useEffect(() => {
    void apiGet<SubscriptionFeatureResponse>("/settings/subscription")
      .then((payload) => {
        setVaultsEnabled(isProductFeatureAllowed(payload.featureGates, "vaults"));
      })
      .catch(() => {
        setVaultsEnabled(true);
      });
  }, []);

  if (!vaultsEnabled) {
    return (
      <div className="walletPage">
        <div className="card walletCard walletEmptyState">
          <h2 style={{ marginTop: 0 }}>Vaults</h2>
          <div className="walletMutedText" style={{ marginBottom: 12 }}>
            {tCommon("licenseGate.body", { feature: "Vaults" })}
          </div>
          <Link href={withLocalePath("/settings/subscription", locale)} className="btn btnPrimary">
            {tCommon("licenseGate.cta")}
          </Link>
        </div>
      </div>
    );
  }

  return <VaultsIndexClient _config={config} />;
}

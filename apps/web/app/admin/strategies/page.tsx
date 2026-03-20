"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { apiGet } from "../../../lib/api";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap,
  type ProductFeatureKey
} from "../../../src/access/productFeatureGates";

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

export default function AdminStrategiesIndexPage() {
  const t = useTranslations("admin.strategiesIndex");
  const locale = useLocale() as AppLocale;
  const [featureGates, setFeatureGates] = useState<ProductFeatureGateMap | null>(null);
  const sections = [
    {
      href: "/admin/strategies/local",
      title: t("local"),
      description: t("localDesc"),
      feature: "local_strategies" as ProductFeatureKey
    },
    {
      href: "/admin/strategies/ai",
      title: t("ai"),
      description: t("aiDesc"),
      feature: "ai_predictions" as ProductFeatureKey
    },
    {
      href: "/admin/strategies/ai-generator",
      title: t("aiGenerator"),
      description: t("aiGeneratorDesc"),
      feature: "ai_predictions" as ProductFeatureKey
    },
    {
      href: "/admin/strategies/builder",
      title: t("builder"),
      description: t("builderDesc"),
      feature: "composite_strategies" as ProductFeatureKey
    }
  ];
  const visibleSections = useMemo(
    () =>
      sections.filter((section) =>
        isProductFeatureAllowed(featureGates, section.feature)
      ),
    [featureGates, sections]
  );

  useEffect(() => {
    void apiGet<SubscriptionFeatureResponse>("/settings/subscription")
      .then((payload) => setFeatureGates(payload?.featureGates ?? null))
      .catch(() => setFeatureGates(null));
  }, []);

  return (
    <div className="settingsWrap">
      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
        <p className="settingsMutedText">{t("subtitle")}</p>
      </div>

      <section className="adminStrategiesIndexGrid" style={{ marginBottom: 12 }}>
        {visibleSections.map((section) => (
          <Link
            key={section.href}
            href={withLocalePath(section.href, locale)}
            className="card adminLandingCard adminStrategiesIndexLink"
          >
            <div className="adminStrategiesIndexLinkTitle">{section.title}</div>
            <div className="adminStrategiesIndexLinkDesc">{section.description}</div>
            <div className="adminStrategiesIndexLinkAction">{t("openSection")}</div>
          </Link>
        ))}
      </section>
    </div>
  );
}

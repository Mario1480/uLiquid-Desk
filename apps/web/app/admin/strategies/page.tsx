"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

export default function AdminStrategiesIndexPage() {
  const t = useTranslations("admin.strategiesIndex");
  const locale = useLocale() as AppLocale;
  const sections = [
    {
      href: "/admin/strategies/local",
      title: t("local"),
      description: t("localDesc")
    },
    {
      href: "/admin/strategies/ai",
      title: t("ai"),
      description: t("aiDesc")
    },
    {
      href: "/admin/strategies/ai-generator",
      title: t("aiGenerator"),
      description: t("aiGeneratorDesc")
    },
    {
      href: "/admin/strategies/builder",
      title: t("builder"),
      description: t("builderDesc")
    }
  ];

  return (
    <div className="settingsWrap">
      <div className="adminPageIntro">
        <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
        <p className="settingsMutedText">{t("subtitle")}</p>
      </div>

      <section className="adminStrategiesIndexGrid" style={{ marginBottom: 12 }}>
        {sections.map((section) => (
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

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

const HELP_SECTION_KEYS = [
  { id: "getting-started", key: "gettingStarted", lines: 2 },
  { id: "exchange-keys", key: "exchangeKeys", lines: 3 },
  { id: "predictions", key: "predictions", lines: 3 },
  { id: "strategies", key: "strategies", lines: 3 },
  { id: "manual-trading", key: "manualTrading", lines: 3 },
  { id: "roles", key: "roles", lines: 3 },
  { id: "security", key: "security", lines: 4 },
  { id: "troubleshooting", key: "troubleshooting", lines: 3 }
] as const;

export default function HelpPage() {
  const t = useTranslations("help");
  const sections = HELP_SECTION_KEYS.map((section) => ({
    id: section.id,
    title: t(`sections.${section.key}.title`),
    body: Array.from({ length: section.lines }, (_, index) => t(`sections.${section.key}.line${index + 1}`))
  }));

  return (
    <div className="helpPage">
      <div className="dashboardHeader">
        <div>
          <h2 className="authHeading">{t("title")}</h2>
          <div className="helpLead">{t("subtitle")}</div>
        </div>
      </div>

      <section className="card authCard">
        <h3 className="authHeading">{t("quickLinks")}</h3>
        <div className="helpQuickLinks">
          {sections.map((s) => (
            <a key={s.id} className="btn" href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </div>
      </section>

      <section className="card authCard">
        <div className="helpSectionList">
          {sections.map((section) => (
            <details key={section.id} id={section.id} className="helpDetailCard">
              <summary className="helpDetailSummary">{section.title}</summary>
              <div className="helpDetailBody">
                {section.body.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="card authCard">
        <h3 className="authHeading">{t("contactTitle")}</h3>
        <div className="helpContactCopy">{t("contactBody")}</div>
        <div>
          <a className="btn btnPrimary" href="mailto:support@uliquid.vip">
            support@uliquid.vip
          </a>
        </div>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { AppIcon } from "./AppIcon";

export const LEGAL_ACKNOWLEDGEMENT_VERSION = "2026-05-17";

type LegalRiskNoticeProps = {
  compact?: boolean;
};

export default function LegalRiskNotice({ compact = false }: LegalRiskNoticeProps) {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const points = [
    t("legal.points.documents"),
    t("legal.points.nonCustodial"),
    t("legal.points.noAdvice"),
    t("legal.points.marketRisk"),
    t("legal.points.userResponsibility"),
    t("legal.points.noGuarantees"),
    t("legal.points.ownRisk")
  ];

  return (
    <section className={compact ? "authLegalNotice authLegalNoticeCompact" : "authLegalNotice"} aria-labelledby="legal-risk-notice-title">
      <div className="authLegalNoticeHeader">
        <div className="authLegalNoticeTitleRow">
          <AppIcon name="shield" />
          <h2 id="legal-risk-notice-title">{t("legal.title")}</h2>
        </div>
        <span className="authLegalNoticeVersion">{t("legal.version", { version: LEGAL_ACKNOWLEDGEMENT_VERSION })}</span>
      </div>
      <ul className="authLegalNoticeList">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="authLegalLinks" aria-label={t("legal.documents.label")}>
        <Link href={withLocalePath("/terms", locale)}>{t("legal.documents.terms")}</Link>
        <Link href={withLocalePath("/privacy", locale)}>{t("legal.documents.privacy")}</Link>
        <Link href={withLocalePath("/risk-disclosure", locale)}>{t("legal.documents.risk")}</Link>
      </div>
    </section>
  );
}

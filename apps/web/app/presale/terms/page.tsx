import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withLocalePath } from "../../../i18n/config";
import { resolveRequestLocale } from "../../../i18n/request";
import { isUliqPublicPresaleWebEnabled } from "../../../lib/uliqPublicPresale";
import { AppIcon } from "../../components/AppIcon";

export const metadata: Metadata = {
  title: "ULIQ Presale Terms | uLiquid Desk",
  description: "Dedicated versioned terms for participation in the ULIQ presale.",
  alternates: { canonical: "/presale/terms" },
  robots: { index: false, follow: true }
};

export default async function PublicPresaleTermsPage() {
  if (!isUliqPublicPresaleWebEnabled()) notFound();
  const locale = await resolveRequestLocale();
  const t = await getTranslations("presale");

  return (
    <div className="publicPresalePage publicPresaleTermsPage">
      <header className="uiPageHeader publicPresaleHero">
        <div className="uiPageHeaderCopy">
          <span className="uliqSectionEyebrow">{t("terms.eyebrow")}</span>
          <h1>{t("terms.title")}</h1>
          <p>{t("terms.description")}</p>
        </div>
        <Link className="btn" href={withLocalePath("/presale", locale)}>
          <AppIcon name="back" />
          {t("tabs.presale")}
        </Link>
      </header>

      <section className="uiSection publicPresaleLegalPending">
        <span className="uliqSummaryIcon"><AppIcon name="detail" /></span>
        <div>
          <h2 className="uiSectionTitle">{t("terms.pendingTitle")}</h2>
          <p className="uiSectionDescription">{t("terms.pendingDescription")}</p>
        </div>
      </section>

      <nav className="publicPresaleLegalLinks" aria-label={t("terms.eyebrow")}>
        <Link className="btn" href={withLocalePath("/terms", locale)}>{t("terms.platformTerms")}</Link>
        <Link className="btn" href={withLocalePath("/privacy", locale)}>{t("terms.privacy")}</Link>
        <Link className="btn" href={withLocalePath("/risk-disclosure", locale)}>{t("terms.risk")}</Link>
      </nav>
    </div>
  );
}

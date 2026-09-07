import { DeskLink } from "@/components/desk/DeskLink";
import { DeskSurface } from "@/components/desk/DeskSurface";
import type { Metadata } from "next";
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
        <DeskLink className="btn" href={withLocalePath("/presale", locale)}>
          <AppIcon name="back" />
          {t("tabs.presale")}
        </DeskLink>
      </header>

      <DeskSurface>
        <article className="uiSection publicPresaleTermsContent" aria-label={t("terms.title")}>
          {(["seller", "token", "rounds", "purchase", "withdrawal", "finalization", "vesting", "listing", "fees", "risks", "version"] as const).map((section) => (
            <section key={section} aria-labelledby={`terms-${section}`}>
              <h2 id={`terms-${section}`} className="uiSectionTitle">{t(`terms.sections.${section}.title`)}</h2>
              <p>{t(`terms.sections.${section}.body`)}</p>
            </section>
          ))}
        </article>
      </DeskSurface>

      <nav className="publicPresaleLegalLinks" aria-label={t("terms.eyebrow")}>
        <DeskLink className="btn" href={withLocalePath("/terms", locale)}>{t("terms.platformTerms")}</DeskLink>
        <DeskLink className="btn" href={withLocalePath("/privacy", locale)}>{t("terms.privacy")}</DeskLink>
        <DeskLink className="btn" href={withLocalePath("/risk-disclosure", locale)}>{t("terms.risk")}</DeskLink>
      </nav>
    </div>
  );
}

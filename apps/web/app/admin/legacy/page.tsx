"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminPageHeader from "../_components/AdminPageHeader";

const LEGACY_LINKS = [
  "/admin/legacy/access-section",
  "/admin/legacy/api-keys",
  "/admin/legacy/billing",
  "/admin/legacy/exchanges",
  "/admin/legacy/server-info",
  "/admin/legacy/smtp",
  "/admin/legacy/telegram",
  "/admin/legacy/vault-execution",
  "/admin/legacy/vault-operations",
  "/admin/legacy/vault-safety",
  "/admin/legacy/indicator-settings",
  "/admin/legacy/grid-templates",
  "/admin/legacy/strategies",
  "/admin/legacy/prediction-refresh",
  "/admin/legacy/prediction-defaults",
  "/admin/legacy/ai-trace",
  "/admin/legacy/ai-prompts",
  "/admin/legacy/grid-hyperliquid-pilot"
];

export default function AdminLegacyIndexPage() {
  const locale = useLocale() as AppLocale;
  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Legacy Tools" description="Temporary landing page for older superadmin tools that still run under the legacy path." />
      <div className="adminLegacyLinkGrid">
        {LEGACY_LINKS.map((href) => (
          <Link key={href} href={withLocalePath(href, locale)} className="adminLegacyLink">
            {href.replace("/admin/legacy/", "")}
          </Link>
        ))}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminPageHeader from "../_components/AdminPageHeader";

const LEGACY_LINKS = [
  "/admin/system",
  "/admin/licenses/packages",
  "/admin/system/ai/grid-templates"
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

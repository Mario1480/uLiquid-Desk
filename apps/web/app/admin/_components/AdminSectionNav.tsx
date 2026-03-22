"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { extractLocaleFromPathname, withLocalePath, type AppLocale } from "../../../i18n/config";
import type { AdminSectionNavItem } from "./admin-sections";

function isActivePath(currentPath: string, href: string): boolean {
  if (currentPath === href) return true;
  if (href === "/admin/system" || href === "/admin/licenses" || href === "/admin/users") {
    return currentPath === href;
  }
  return currentPath.startsWith(`${href}/`);
}

export default function AdminSectionNav({
  items,
  ariaLabel
}: {
  items: AdminSectionNavItem[];
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const locale = useLocale() as AppLocale;
  const currentPath = extractLocaleFromPathname(pathname).pathnameWithoutLocale;

  return (
    <nav className="adminSectionNav" aria-label={ariaLabel}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={withLocalePath(item.href, locale)}
          className={`adminSectionNavLink ${isActivePath(currentPath, item.href) ? "adminSectionNavLinkActive" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

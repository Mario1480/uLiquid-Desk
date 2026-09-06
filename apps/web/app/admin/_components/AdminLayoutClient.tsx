"use client";

import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskButton } from "@/components/desk/DeskButton";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { extractLocaleFromPathname, withLocalePath, type AppLocale } from "../../../i18n/config";
import { AppIcon } from "../../components/AppIcon";
import { ADMIN_NAV_ITEMS, type AdminNavItem } from "./admin-nav";

function isActivePath(currentPath: string, item: AdminNavItem): boolean {
  const hasCustomRules = Boolean(item.activeExact?.length || item.activePrefixes?.length);
  if (item.activeExact?.includes(currentPath)) return true;
  if (item.activePrefixes?.some((prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`))) {
    return true;
  }
  if (hasCustomRules) return false;
  if (item.href === "/admin") return currentPath === "/admin";
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const locale = useLocale() as AppLocale;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentPath = extractLocaleFromPathname(pathname).pathnameWithoutLocale;

  const navItems = useMemo(
    () =>
      ADMIN_NAV_ITEMS.map((item) => ({
        ...item,
        localizedHref: withLocalePath(item.href, locale),
        active: isActivePath(currentPath, item)
      })),
    [currentPath, locale]
  );

  return (
    <div className="adminShell">
      <DeskButton
        type="button"
        className="btn adminSidebarToggle"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <AppIcon name={sidebarOpen ? "close" : "menu"} />
        {sidebarOpen ? "Close admin menu" : "Open admin menu"}
      </DeskButton>

      <aside className={`adminSidebarPanel ${sidebarOpen ? "adminSidebarPanelOpen" : ""}`}>
        <DeskSurface><div className="adminSidebarPanelInner">
          <div className="adminSidebarBrand">
            <div className="adminSidebarEyebrow">uLiquid Desk</div>
            <div className="adminSidebarTitle">Platform Admin</div>
            <div className="adminSidebarCopy">Strict superadmin operations area</div>
          </div>

          <nav className="adminSidebarNav" aria-label="Admin navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.localizedHref}
                className={`adminSidebarLink ${item.active ? "adminSidebarLinkActive" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="adminSidebarLinkLabel">
                  <AppIcon name={item.icon} />
                  {item.shortLabel ?? item.label}
                </span>
                <AppIcon name="chevronRight" className="adminSidebarLinkChevron" />
              </Link>
            ))}
          </nav>
        </div></DeskSurface>
      </aside>

      <div className="adminShellContent">{children}</div>

      {sidebarOpen ? (
        <DeskButton
          type="button"
          className="adminSidebarBackdrop"
          aria-label="Close admin menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
    </div>
  );
}

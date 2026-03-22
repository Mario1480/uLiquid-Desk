"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { extractLocaleFromPathname, withLocalePath, type AppLocale } from "../../../i18n/config";
import { ADMIN_NAV_ITEMS } from "./admin-nav";

function isActivePath(currentPath: string, href: string): boolean {
  if (href === "/admin") return currentPath === "/admin";
  return currentPath === href || currentPath.startsWith(`${href}/`);
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
        active: isActivePath(currentPath, item.href)
      })),
    [currentPath, locale]
  );

  return (
    <div className="adminShell">
      <button
        type="button"
        className="btn adminSidebarToggle"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? "Close admin menu" : "Open admin menu"}
      </button>

      <aside className={`adminSidebarPanel ${sidebarOpen ? "adminSidebarPanelOpen" : ""}`}>
        <div className="adminSidebarPanelInner">
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
                {item.shortLabel ?? item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <div className="adminShellContent">{children}</div>

      {sidebarOpen ? (
        <button
          type="button"
          className="adminSidebarBackdrop"
          aria-label="Close admin menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
    </div>
  );
}

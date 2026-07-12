"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractLocaleFromPathname,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";
import { apiGet, apiPost } from "../../lib/api";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../../src/access/accessSection";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap
} from "../../src/access/productFeatureGates";
import { getAppReleaseVersion } from "../../src/appRelease";
import { AppIcon, type AppIconName } from "./AppIcon";

type SidebarItem = {
  key: string;
  label: string;
  href: string;
  icon: AppIconName;
  active: boolean;
};

type SidebarGroup = {
  key: string;
  title: string;
  items: SidebarItem[];
};

type SidebarDashboardOverviewAccount = {
  bots?: {
    running?: number;
    runningStandard?: number;
    runningGrid?: number;
    error?: number;
  } | null;
  runningPredictions?: number;
};

type SidebarDashboardOverviewResponse = {
  accounts?: SidebarDashboardOverviewAccount[];
};

type SidebarSnapshot = {
  accounts: number;
  runningStandard: number;
  runningGrid: number;
  runningPredictions: number;
  errors: number;
};

type MeResponse = {
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
};

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

export default function AppSidebar({
  isOpen,
  mobileMode,
  onClose
}: {
  isOpen: boolean;
  mobileMode: boolean;
  onClose: () => void;
}) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tSidebar = useTranslations("nav.sidebar");
  const tDashboard = useTranslations("dashboard");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const [featureGates, setFeatureGates] = useState<ProductFeatureGateMap>({});
  const [hasPlatformAdminAccess, setHasPlatformAdminAccess] = useState(false);
  const [snapshot, setSnapshot] = useState<SidebarSnapshot>({
    accounts: 0,
    runningStandard: 0,
    runningGrid: 0,
    runningPredictions: 0,
    errors: 0
  });
  const [snapshotReady, setSnapshotReady] = useState(false);
  const snapshotPollInFlightRef = useRef(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const appReleaseVersion = getAppReleaseVersion();

  function hrefFor(path: string): string {
    return withLocalePath(path, locale);
  }

  async function handleLogout() {
    setLogoutLoading(true);
    try {
      await apiPost("/auth/logout");
    } finally {
      onClose();
      router.push(hrefFor("/login"));
      setLogoutLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadAccessVisibility() {
      try {
      const [accessResult, meResult, subscriptionResult] = await Promise.allSettled([
        apiGet<{ visibility?: AccessSectionVisibility }>("/settings/access-section"),
        apiGet<MeResponse>("/auth/me"),
        apiGet<SubscriptionFeatureResponse>("/settings/subscription")
      ]);
        if (!mounted) return;

        if (accessResult.status === "fulfilled" && accessResult.value?.visibility) {
          setVisibility({
            tradingDesk: accessResult.value.visibility.tradingDesk !== false,
            bots: accessResult.value.visibility.bots !== false,
            gridBots: accessResult.value.visibility.gridBots !== false,
            predictionsDashboard: accessResult.value.visibility.predictionsDashboard !== false,
            economicCalendar: accessResult.value.visibility.economicCalendar !== false,
            news: accessResult.value.visibility.news !== false,
            strategy: accessResult.value.visibility.strategy !== false
          });
      } else {
        setVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
      }

      if (subscriptionResult.status === "fulfilled" && subscriptionResult.value?.featureGates) {
        setFeatureGates(subscriptionResult.value.featureGates);
      } else {
        setFeatureGates({});
      }

        if (meResult.status === "fulfilled") {
          setHasPlatformAdminAccess(Boolean(meResult.value?.isSuperadmin));
        }
      } catch {
        if (!mounted) return;
        setVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
        setHasPlatformAdminAccess(false);
      }
    }

    void loadAccessVisibility();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSnapshot(background = false) {
      if (background) {
        if (typeof document !== "undefined" && document.hidden) return;
        if (snapshotPollInFlightRef.current) return;
        snapshotPollInFlightRef.current = true;
      }
      try {
        const payload = await apiGet<SidebarDashboardOverviewResponse | SidebarDashboardOverviewAccount[]>(
          "/dashboard/overview"
        );
        if (!mounted) return;

        const accounts = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.accounts)
            ? payload.accounts
            : [];
        const reduced = accounts.reduce<SidebarSnapshot>(
          (acc, row) => {
            acc.accounts += 1;
            acc.runningStandard += Number(row?.bots?.runningStandard ?? 0) || 0;
            acc.runningGrid += Number(row?.bots?.runningGrid ?? 0) || 0;
            acc.runningPredictions += Number(row?.runningPredictions ?? 0) || 0;
            acc.errors += Number(row?.bots?.error ?? 0) || 0;
            return acc;
          },
          { accounts: 0, runningStandard: 0, runningGrid: 0, runningPredictions: 0, errors: 0 }
        );
        setSnapshot(reduced);
        setSnapshotReady(true);
      } catch {
        if (!mounted) return;
        setSnapshotReady(true);
      } finally {
        if (background) {
          snapshotPollInFlightRef.current = false;
        }
      }
    }

    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot(true);
    }, 60_000);

    return () => {
      mounted = false;
      snapshotPollInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const navigationGroups = useMemo<SidebarGroup[]>(() => {
    const deskItems: SidebarItem[] = [];
    const automationItems: SidebarItem[] = [];
    const capitalItems: SidebarItem[] = [];
    const operationsItems: SidebarItem[] = [];
    const gridEnabled = isProductFeatureAllowed(featureGates, "grid_bots") || hasPlatformAdminAccess;
    const adminEnabled = isProductFeatureAllowed(featureGates, "admin_advanced");

    deskItems.push({
      key: "dashboard",
      label: tNav("dashboard"),
      href: hrefFor("/dashboard"),
      icon: "dashboard",
      active: pathnameWithoutLocale === "/" || pathnameWithoutLocale === "/dashboard"
    });

    if (visibility.tradingDesk) {
      deskItems.push({
        key: "manualTrading",
        label: tNav("manualTrading"),
        href: hrefFor("/trade"),
        icon: "manualTrading",
        active: pathnameWithoutLocale.startsWith("/trade") || pathnameWithoutLocale.startsWith("/trading-desk")
      });
    }

    if (visibility.bots) {
      automationItems.push({
        key: "bots",
        label: tNav("bots"),
        href: hrefFor("/bots"),
        icon: "bots",
        active: pathnameWithoutLocale.startsWith("/bots")
          && !pathnameWithoutLocale.startsWith("/bots/grid")
          && !pathnameWithoutLocale.startsWith("/bots/catalog")
      });
    }

    if (visibility.gridBots && gridEnabled) {
      automationItems.push({
        key: "grid-bots",
        label: tNav("gridBots"),
        href: hrefFor("/bots/grid"),
        icon: "grid",
        active: pathnameWithoutLocale.startsWith("/bots/grid") || pathnameWithoutLocale.startsWith("/bots/catalog")
      });
    }

    if (visibility.predictionsDashboard) {
      automationItems.push({
        key: "predictions",
        label: tNav("predictions"),
        href: hrefFor("/predictions"),
        icon: "predictions",
        active: pathnameWithoutLocale.startsWith("/predictions")
      });
    }

    if (visibility.economicCalendar) {
      deskItems.push({
        key: "calendar",
        label: tSidebar("calendarShort"),
        href: hrefFor("/calendar"),
        icon: "calendar",
        active: pathnameWithoutLocale.startsWith("/calendar")
      });
    }

    if (visibility.news) {
      deskItems.push({
        key: "news",
        label: tNav("news"),
        href: hrefFor("/news"),
        icon: "news",
        active: pathnameWithoutLocale.startsWith("/news")
      });
    }

    capitalItems.push({
      key: "accounts",
      label: tNav("accounts"),
      href: hrefFor("/accounts"),
      icon: "accounts",
      active: pathnameWithoutLocale.startsWith("/accounts")
    });

    capitalItems.push({
      key: "wallet",
      label: tNav("wallet"),
      href: hrefFor("/wallet"),
      icon: "wallet",
      active: pathnameWithoutLocale.startsWith("/wallet") || pathnameWithoutLocale.startsWith("/funding")
    });

    capitalItems.push({
      key: "vaults",
      label: tNav("vaults"),
      href: hrefFor("/vaults"),
      icon: "vaults",
      active: pathnameWithoutLocale.startsWith("/vaults")
    });

    operationsItems.push({
      key: "settings",
      label: tNav("settings"),
      href: hrefFor("/settings"),
      icon: "settings",
      active: pathnameWithoutLocale.startsWith("/settings")
    });

    if (hasPlatformAdminAccess && adminEnabled) {
      operationsItems.push({
        key: "admin",
        label: tNav("admin"),
        href: hrefFor("/admin"),
        icon: "admin",
        active: pathnameWithoutLocale.startsWith("/admin")
      });
    }

    operationsItems.push({
      key: "help",
      label: tNav("help"),
      href: hrefFor("/help"),
      icon: "help",
      active: pathnameWithoutLocale.startsWith("/help")
    });

    return [
      { key: "desk", title: tSidebar("deskTitle"), items: deskItems },
      { key: "automation", title: tSidebar("automationTitle"), items: automationItems },
      { key: "capital", title: tSidebar("capitalTitle"), items: capitalItems },
      { key: "operations", title: tSidebar("operationsTitle"), items: operationsItems }
    ].filter((group) => group.items.length > 0);
  }, [featureGates, hasPlatformAdminAccess, hrefFor, pathnameWithoutLocale, tNav, tSidebar, visibility]);

  return (
    <aside
      id="appSidebar"
      className={`appSidebar ${isOpen ? "appSidebarDrawer" : ""}`}
      role={mobileMode ? "dialog" : undefined}
      aria-modal={mobileMode && isOpen ? true : undefined}
      aria-label={mobileMode ? "uLiquid Desk" : undefined}
    >
      <div className="appSidebarInner">
        <div className="appSidebarTop">
          <Link href={hrefFor("/")} className="appSidebarLogo" aria-label="uLiquid Desk" onClick={onClose}>
            <img src="/images/logo-256.png" alt="uLiquid Desk logo" className="appSidebarLogoMark" />
            <span className="appSidebarBrandCopy">
              <strong className="appSidebarBrandName">uLiquid Desk</strong>
              <span className="appSidebarLogoText">{tCommon("betaLabel", { version: appReleaseVersion })}</span>
            </span>
          </Link>
          <button
            type="button"
            className="appSidebarClose"
            onClick={onClose}
            aria-label={tSidebar("close")}
            title={tSidebar("close")}
          >
            <AppIcon name="close" />
          </button>
        </div>

        {navigationGroups.map((group) => (
          <section key={group.key} className="appSidebarSection" aria-label={group.title}>
            <div className="appSidebarSectionTitle">{group.title}</div>
            <nav className="appSidebarNav">
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`appSidebarLink ${item.active ? "appSidebarLinkActive" : ""}`}
                  onClick={onClose}
                  aria-current={item.active ? "page" : undefined}
                >
                  <span className="appSidebarLinkIcon" aria-hidden><AppIcon name={item.icon} className="appSidebarGlyph" /></span>
                  <span className="appSidebarLinkLabel">{item.label}</span>
                </Link>
              ))}
            </nav>
          </section>
        ))}

        <section className="appSidebarSection appSidebarSnapshot" aria-label={tSidebar("snapshotTitle")}>
          <div className="appSidebarSectionTitle">{tSidebar("snapshotTitle")}</div>
          <div className="appSidebarSnapshotGrid">
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.exchangeAccounts")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.accounts : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.runningBots")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.runningStandard : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.runningGridBots")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.runningGrid : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.runningPredictions")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.runningPredictions : "…"}</strong>
            </div>
            <div className="appSidebarSnapshotItem">
              <span className="appSidebarSnapshotLabel">{tDashboard("stats.botsInError")}</span>
              <strong className="appSidebarSnapshotValue">{snapshotReady ? snapshot.errors : "…"}</strong>
            </div>
          </div>
        </section>

        <div className="appSidebarFooter">
          <button
            type="button"
            className="appSidebarLink appSidebarLogoutButton"
            onClick={() => void handleLogout()}
            disabled={logoutLoading}
          >
            <span className="appSidebarLinkIcon" aria-hidden><AppIcon name="logout" className="appSidebarGlyph" /></span>
            <span className="appSidebarLinkLabel">
              {logoutLoading ? tNav("loggingOut") : tNav("logout")}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}

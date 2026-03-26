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

type SidebarIconName =
  | "dashboard"
  | "manualTrading"
  | "bots"
  | "grid"
  | "strategies"
  | "predictions"
  | "calendar"
  | "news"
  | "settings"
  | "admin"
  | "help"
  | "logout"
  | "overview"
  | "riskAlerts"
  | "marketContext"
  | "accounts"
  | "wallet"
  | "funding"
  | "vaults";

type SidebarItem = {
  key: string;
  label: string;
  href: string;
  icon: SidebarIconName;
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

function SidebarGlyph({ icon }: { icon: SidebarIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "appSidebarGlyph"
  };

  switch (icon) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "manualTrading":
      return (
        <svg {...common}>
          <path d="M4 16l5-5 4 3 7-7" />
          <path d="M20 10V6h-4" />
          <path d="M4 20h16" />
        </svg>
      );
    case "bots":
      return (
        <svg {...common}>
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M9 8V5h6v3" />
          <circle cx="10" cy="13" r="1" />
          <circle cx="14" cy="13" r="1" />
          <path d="M8 17h8" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
        </svg>
      );
    case "strategies":
      return (
        <svg {...common}>
          <path d="M5 7h6v6H5z" />
          <path d="M13 5h6v6h-6z" />
          <path d="M9 13h6v6H9z" />
          <path d="M11 10h2M15 11v2" />
        </svg>
      );
    case "predictions":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M7 14l3-3 3 2 4-5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
          <path d="M8 14h3M8 18h5" />
        </svg>
      );
    case "news":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path d="M12 3l7 4v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V7z" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-.7.7-1.8 1.3-1.8 2.7" />
          <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
          <path d="M14 8l4 4-4 4" />
          <path d="M18 12H9" />
        </svg>
      );
    case "overview":
      return (
        <svg {...common}>
          <path d="M4 13h6V4H4z" />
          <path d="M14 9h6V4h-6z" />
          <path d="M14 20h6v-9h-6z" />
          <path d="M4 20h6v-5H4z" />
        </svg>
      );
    case "riskAlerts":
      return (
        <svg {...common}>
          <path d="M12 4l9 15H3z" />
          <path d="M12 9v5" />
          <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "marketContext":
      return (
        <svg {...common}>
          <path d="M3 7h18" />
          <path d="M3 12h18" />
          <path d="M3 17h18" />
          <circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="11" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <path d="M15 9h6M18 6v6" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
          <path d="M16 12h.01" />
        </svg>
      );
    case "funding":
      return (
        <svg {...common}>
          <path d="M4 7h10" />
          <path d="M10 3l4 4-4 4" />
          <path d="M20 17H10" />
          <path d="M14 13l-4 4 4 4" />
        </svg>
      );
    case "vaults":
      return (
        <svg {...common}>
          <path d="M6 7h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
          <path d="M9 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      );
    default:
      return null;
  }
}

export default function AppSidebar({
  isOpen,
  onClose
}: {
  isOpen: boolean;
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
      key: "wallet",
      label: tNav("wallet"),
      href: hrefFor("/wallet"),
      icon: "wallet",
      active: pathnameWithoutLocale.startsWith("/wallet") || pathnameWithoutLocale.startsWith("/funding")
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
    <aside id="appSidebar" className={`appSidebar ${isOpen ? "appSidebarDrawer" : ""}`}>
      <div className="appSidebarInner">
        <div className="appSidebarTop">
          <Link href={hrefFor("/")} className="appSidebarLogo" aria-label="uLiquid Desk" onClick={onClose}>
            <img src="/images/logo.png" alt="uLiquid Desk logo" className="appSidebarLogoMark" />
            <span className="appSidebarLogoText">{tCommon("betaLabel")}</span>
          </Link>
          <button
            type="button"
            className="appSidebarClose"
            onClick={onClose}
            aria-label={tSidebar("close")}
          >
            {tSidebar("close")}
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
                  <span className="appSidebarLinkIcon" aria-hidden><SidebarGlyph icon={item.icon} /></span>
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
            <span className="appSidebarLinkIcon" aria-hidden><SidebarGlyph icon="logout" /></span>
            <span className="appSidebarLinkLabel">
              {logoutLoading ? tNav("loggingOut") : tNav("logout")}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}

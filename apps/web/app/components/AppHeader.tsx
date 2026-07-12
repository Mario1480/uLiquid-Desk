"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardAlert } from "../../components/dashboard/AlertsFeed";
import { apiGet, apiPost } from "../../lib/api";
import {
  LOCALE_COOKIE_NAME,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../../src/access/accessSection";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap
} from "../../src/access/productFeatureGates";
import ClientErrorBoundary from "./ClientErrorBoundary";
import { AppIcon } from "./AppIcon";

const WalletConnectionWidget = dynamic(() => import("./WalletConnectionWidget"), {
  ssr: false
});

type MeResponse = {
  walletAddress?: string | null;
  email?: string;
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
  maintenance?: {
    enabled?: boolean;
    activeForUser?: boolean;
  };
  user?: {
    email?: string;
    walletAddress?: string | null;
  };
};

type HeaderSearchItem = {
  key: string;
  label: string;
  href: string;
};

type DashboardAlertsResponse = {
  items?: DashboardAlert[];
};

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

type OpenMenu = "language" | "alerts" | "user" | null;

const LANGUAGE_OPTIONS: Array<{ locale: AppLocale; label: string }> = [
  { locale: "en", label: "EN" },
  { locale: "de", label: "DE" }
];

function buildLocalizedHref(href: string, locale: AppLocale): string {
  if (!href.startsWith("/")) return href;
  const [pathAndQuery, hash = ""] = href.split("#");
  const [pathOnly, query = ""] = pathAndQuery.split("?");
  let localized = withLocalePath(pathOnly || "/", locale);
  if (query) localized += `?${query}`;
  if (hash) localized += `#${hash}`;
  return localized;
}

function formatRelativeTime(iso: string, locale: AppLocale): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "n/a";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === "de" ? "de-DE" : "en-US", { numeric: "auto" });
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return rtf.format(-diffHr, "hour");
  const diffDay = Math.floor(diffHr / 24);
  return rtf.format(-diffDay, "day");
}

function getUserInitials(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "U";
  const parts = normalized.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export default function AppHeader({
  sidebarOpen,
  onToggleSidebar
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const tNav = useTranslations("nav");
  const tHeader = useTranslations("nav.header");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userWalletAddress, setUserWalletAddress] = useState("");
  const [hasPlatformAdminAccess, setHasPlatformAdminAccess] = useState(false);
  const [showMaintenanceHint, setShowMaintenanceHint] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const [featureGates, setFeatureGates] = useState<ProductFeatureGateMap>({});
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const alertsMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const alertsPollInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadHeaderData() {
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
        const email = String(meResult.value?.email ?? meResult.value?.user?.email ?? "").trim();
        const walletAddress = String(
          meResult.value?.walletAddress ?? meResult.value?.user?.walletAddress ?? ""
        ).trim();
        const isAdminViewer = Boolean(
          meResult.value?.isSuperadmin || meResult.value?.hasAdminBackendAccess
        );
        const isPlatformAdminViewer = Boolean(meResult.value?.isSuperadmin);
        setUserEmail(email);
        setUserWalletAddress(walletAddress);
        setHasPlatformAdminAccess(isPlatformAdminViewer);
        setShowMaintenanceHint(Boolean(meResult.value?.maintenance?.enabled) && isAdminViewer);
      } else {
        setUserEmail("");
        setUserWalletAddress("");
        setHasPlatformAdminAccess(false);
        setShowMaintenanceHint(false);
      }
    }

    void loadHeaderData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadAlerts(background = false) {
      if (background) {
        if (typeof document !== "undefined" && document.hidden) return;
        if (alertsPollInFlightRef.current) return;
        alertsPollInFlightRef.current = true;
      }
      if (!background) setAlertsLoading(true);
      try {
        const payload = await apiGet<DashboardAlertsResponse>("/dashboard/alerts?limit=6");
        if (!mounted) return;
        const relevant = Array.isArray(payload?.items)
          ? payload.items.filter((item) => item.severity === "critical" || item.severity === "warning")
          : [];
        setAlerts(relevant);
      } catch {
        if (!mounted) return;
        if (!background) setAlerts([]);
      } finally {
        if (background) alertsPollInFlightRef.current = false;
        if (mounted && !background) setAlertsLoading(false);
      }
    }

    void loadAlerts();
    const timer = window.setInterval(() => {
      void loadAlerts(true);
    }, 60_000);

    return () => {
      mounted = false;
      alertsPollInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const searchItems = useMemo<HeaderSearchItem[]>(() => {
    const items: HeaderSearchItem[] = [
      { key: "dashboard", label: tNav("dashboard"), href: withLocalePath("/dashboard", locale) }
    ];
    const gridEnabled = isProductFeatureAllowed(featureGates, "grid_bots") || hasPlatformAdminAccess;
    const adminEnabled = isProductFeatureAllowed(featureGates, "admin_advanced");

    if (visibility.tradingDesk) {
      items.push({ key: "trade", label: tNav("manualTrading"), href: withLocalePath("/trade", locale) });
    }
    if (visibility.bots) {
      items.push({ key: "bots", label: tNav("bots"), href: withLocalePath("/bots", locale) });
    }
    if (visibility.gridBots && gridEnabled) {
      items.push({ key: "grid-bots", label: tNav("gridBots"), href: withLocalePath("/bots/grid", locale) });
    }
    if (visibility.predictionsDashboard) {
      items.push({ key: "predictions", label: tNav("predictions"), href: withLocalePath("/predictions", locale) });
    }
    if (visibility.economicCalendar) {
      items.push({ key: "calendar", label: tNav("calendar"), href: withLocalePath("/calendar", locale) });
    }
    if (visibility.news) {
      items.push({ key: "news", label: tNav("news"), href: withLocalePath("/news", locale) });
    }

    items.push({ key: "accounts", label: tNav("accounts"), href: withLocalePath("/accounts", locale) });
    items.push({ key: "wallet", label: tNav("wallet"), href: withLocalePath("/wallet", locale) });
    items.push({ key: "vaults", label: tNav("vaults"), href: withLocalePath("/vaults", locale) });
    items.push({ key: "settings", label: tNav("settings"), href: withLocalePath("/settings", locale) });
    if (hasPlatformAdminAccess && adminEnabled) {
      items.push({ key: "admin", label: tNav("admin"), href: withLocalePath("/admin", locale) });
    }
    items.push({ key: "help", label: tNav("help"), href: withLocalePath("/help", locale) });
    return items;
  }, [featureGates, hasPlatformAdminAccess, locale, tNav, visibility]);

  const username = useMemo(() => {
    const wallet = userWalletAddress.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }
    const email = userEmail.trim();
    if (!email) return tHeader("userFallback");
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }, [tHeader, userEmail, userWalletAddress]);

  const userSubtitle = useMemo(() => {
    if (userEmail.trim()) return userEmail.trim();
    if (userWalletAddress.trim()) return userWalletAddress.trim();
    return tHeader("userFallback");
  }, [tHeader, userEmail, userWalletAddress]);

  const userInitials = useMemo(() => getUserInitials(username), [username]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return searchItems.filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 8);
  }, [query, searchItems]);

  const showSearchResults = isSearchFocused && query.trim().length > 0 && filteredItems.length > 0;
  const currentLanguage = LANGUAGE_OPTIONS.find((item) => item.locale === locale) ?? LANGUAGE_OPTIONS[0];
  const alertCount = alerts.length;
  const searchQueryString = searchParams.toString();

  useEffect(() => {
    if (!showSearchResults) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((previous) => Math.min(previous, filteredItems.length - 1));
  }, [filteredItems.length, showSearchResults]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setOpenMenu(null);
      }
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => {
      window.removeEventListener("keydown", handleSearchShortcut);
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;

    const refs = [languageMenuRef.current, alertsMenuRef.current, userMenuRef.current];
    const activeMenuRef = openMenu === "language"
      ? languageMenuRef.current
      : openMenu === "alerts"
        ? alertsMenuRef.current
        : userMenuRef.current;
    const activeTrigger = activeMenuRef?.querySelector<HTMLButtonElement>("button");
    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus = openMenu === "alerts"
        ? activeMenuRef?.querySelector<HTMLElement>("[role='dialog']")
        : activeMenuRef?.querySelector<HTMLElement>("[role='menuitem']");
      initialFocus?.focus();
    });
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const clickedInside = refs.some((ref) => ref?.contains(target));
      if (!clickedInside) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenMenu(null);
      activeTrigger?.focus();
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  function handleMenuNavigation(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']"));
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowUp"
          ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  function navigateToHref(href: string) {
    router.push(href);
    setQuery("");
    setActiveIndex(-1);
    setIsSearchFocused(false);
    setOpenMenu(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeItem = activeIndex >= 0 ? filteredItems[activeIndex] : null;
    if (activeItem) {
      navigateToHref(activeItem.href);
      return;
    }

    const normalized = query.trim().toLowerCase();
    if (!normalized) return;

    const exact = searchItems.find((item) => item.label.toLowerCase() === normalized);
    const startsWith = searchItems.find((item) => item.label.toLowerCase().startsWith(normalized));
    const includes = searchItems.find((item) => item.label.toLowerCase().includes(normalized));
    const match = exact ?? startsWith ?? includes;

    if (match) {
      navigateToHref(match.href);
      return;
    }

    if (normalized.startsWith("/")) {
      navigateToHref(withLocalePath(normalized, locale));
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSearchResults && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((previous) => (previous + 1) % filteredItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((previous) => (previous <= 0 ? filteredItems.length - 1 : previous - 1));
      return;
    }

    if (event.key === "Escape") {
      setIsSearchFocused(false);
      setActiveIndex(-1);
    }
  }

  function switchLocalePath(targetLocale: AppLocale): string {
    const targetPath = withLocalePath(pathname, targetLocale);
    if (!searchQueryString) return targetPath;
    return `${targetPath}?${searchQueryString}`;
  }

  function handleLocaleSwitch(targetLocale: AppLocale) {
    if (targetLocale === locale) {
      setOpenMenu(null);
      return;
    }
    document.cookie = `${LOCALE_COOKIE_NAME}=${targetLocale}; path=/; max-age=31536000`;
    window.location.assign(switchLocalePath(targetLocale));
  }

  async function handleLogout() {
    setLogoutLoading(true);
    setOpenMenu(null);
    try {
      await apiPost("/auth/logout");
    } finally {
      router.push(withLocalePath("/login", locale));
      setLogoutLoading(false);
    }
  }

  return (
    <header className="appHeader appHeaderCompact">
      <div className="container appHeaderInner">
        <div className="appHeaderMobileStart">
          <button
            id="appSidebarToggle"
            className="appBurger appBurgerVisible"
            aria-label={tNav("toggleMenu")}
            aria-expanded={sidebarOpen}
            aria-controls="appSidebar"
            onClick={onToggleSidebar}
            type="button"
          >
            <AppIcon name={sidebarOpen ? "close" : "menu"} />
          </button>
          <Link href={withLocalePath("/", locale)} className="appLogo appHeaderMobileLogo" aria-label="uLiquid Desk">
            <img src="/images/logo-256.png" alt="uLiquid Desk logo" className="appLogoMark" />
            <span className="appHeaderBrandName">uLiquid</span>
          </Link>
        </div>

        <form className="appHeaderSearch" onSubmit={handleSubmit}>
          <div className="appHeaderSearchWrap">
            <span className="appHeaderSearchIcon" aria-hidden="true">
              <AppIcon name="search" />
            </span>
            <input
              ref={searchInputRef}
              className="input appHeaderSearchInput"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                if (blurTimeoutRef.current !== null) {
                  window.clearTimeout(blurTimeoutRef.current);
                  blurTimeoutRef.current = null;
                }
                setIsSearchFocused(true);
              }}
              onBlur={() => {
                blurTimeoutRef.current = window.setTimeout(() => {
                  setIsSearchFocused(false);
                  setActiveIndex(-1);
                }, 120);
              }}
              placeholder={tHeader("searchPlaceholder")}
              aria-label={tHeader("searchPlaceholder")}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSearchResults}
              aria-controls="appHeaderSearchResults"
              aria-activedescendant={
                activeIndex >= 0 ? `appHeaderSearchResult-${filteredItems[activeIndex]?.key}` : undefined
              }
            />
            <button type="submit" className="appHeaderSearchSubmit" aria-label={tHeader("searchButton")}>
              <span className="appHeaderSearchShortcut" aria-hidden="true">
                <kbd>Ctrl/⌘</kbd><kbd>K</kbd>
              </span>
              <span className="appHeaderSearchSubmitIcon" aria-hidden="true"><AppIcon name="search" /></span>
            </button>
            {showSearchResults ? (
              <div id="appHeaderSearchResults" className="appHeaderSearchResults" role="listbox">
                {filteredItems.map((item, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={item.key}
                      id={`appHeaderSearchResult-${item.key}`}
                      type="button"
                      className={`appHeaderSearchResult ${isActive ? "appHeaderSearchResultActive" : ""}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => navigateToHref(item.href)}
                    >
                      <span className="appHeaderSearchResultLabel">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </form>

        <div className="appHeaderToolbar">
          <div ref={languageMenuRef} className="appHeaderMenuAnchor">
            <button
              type="button"
              className={`appHeaderPillButton ${openMenu === "language" ? "appHeaderPillButtonOpen" : ""}`}
              onClick={() => setOpenMenu((current) => (current === "language" ? null : "language"))}
              aria-haspopup="menu"
              aria-expanded={openMenu === "language"}
              aria-label={tHeader("languageMenu")}
            >
              <span className="appHeaderLanguageIcon" aria-hidden="true"><AppIcon name="exchange" /></span>
              <span className="appHeaderLanguageCode">{currentLanguage.label}</span>
              <span className="appHeaderChevron" aria-hidden="true"><AppIcon name="chevronDown" /></span>
            </button>
            {openMenu === "language" ? (
              <div
                className="appHeaderMenuPanel appHeaderMenuPanelCompact"
                role="menu"
                onKeyDown={handleMenuNavigation}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.locale}
                    type="button"
                    className={`appHeaderMenuLink ${option.locale === locale ? "appHeaderMenuLinkActive" : ""}`}
                    onClick={() => handleLocaleSwitch(option.locale)}
                    role="menuitem"
                  >
                    <span className="appHeaderMenuIcon appHeaderLanguageFlag" aria-hidden="true">{option.label}</span>
                    <span>{tHeader(`language.${option.locale}`)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {showMaintenanceHint ? (
            <Link
              href={withLocalePath("/admin/system/access", locale)}
              className="appHeaderStatusPill appHeaderStatusPillLink"
              title={tHeader("maintenanceHint")}
            >
              <span className="appHeaderStatusDot" aria-hidden="true" />
              <span>{tHeader("maintenanceActive")}</span>
            </Link>
          ) : null}

          <ClientErrorBoundary fallback={<button className="btn" type="button" disabled>Wallet unavailable</button>}>
            <WalletConnectionWidget />
          </ClientErrorBoundary>

          <div ref={alertsMenuRef} className="appHeaderMenuAnchor">
            <button
              type="button"
              className={`appHeaderIconButton ${openMenu === "alerts" ? "appHeaderIconButtonOpen" : ""}`}
              onClick={() => setOpenMenu((current) => (current === "alerts" ? null : "alerts"))}
              aria-haspopup="dialog"
              aria-expanded={openMenu === "alerts"}
              aria-label={tHeader("alertsMenu")}
            >
              <AppIcon name="alerts" />
              {alertCount > 0 ? <span className="appHeaderBellBadge">{alertCount}</span> : null}
            </button>
            {openMenu === "alerts" ? (
              <div
                className="appHeaderMenuPanel appHeaderAlertsPanel"
                role="dialog"
                aria-label={tHeader("alerts.title")}
                tabIndex={-1}
              >
                <div className="appHeaderMenuTitleRow">
                  <div className="appHeaderMenuTitle">{tHeader("alerts.title")}</div>
                  {alertCount > 0 ? <span className="appHeaderAlertsCount">{alertCount}</span> : null}
                </div>
                {alertsLoading ? (
                  <div className="appHeaderMenuState">{tHeader("alerts.loading")}</div>
                ) : alerts.length === 0 ? (
                  <div className="appHeaderMenuState">{tHeader("alerts.empty")}</div>
                ) : (
                  <div className="appHeaderAlertsList">
                    {alerts.map((alert) => (
                      <Link
                        key={alert.id}
                        href={buildLocalizedHref(alert.link || "/dashboard", locale)}
                        className="appHeaderAlertLink"
                        onClick={() => setOpenMenu(null)}
                      >
                        <div className="appHeaderAlertMeta">
                          <span className={`appHeaderAlertSeverity appHeaderAlertSeverity-${alert.severity}`}>
                            {alert.severity.toUpperCase()}
                          </span>
                          <span className="appHeaderAlertTime" title={new Date(alert.ts).toLocaleString()}>
                            {formatRelativeTime(alert.ts, locale)}
                          </span>
                        </div>
                        <div className="appHeaderAlertTitle">{alert.title}</div>
                        {alert.message ? <div className="appHeaderAlertMessage">{alert.message}</div> : null}
                      </Link>
                    ))}
                  </div>
                )}
                <Link
                  href={withLocalePath("/dashboard", locale)}
                  className="appHeaderMenuFooterLink"
                  onClick={() => setOpenMenu(null)}
                >
                  {tHeader("alerts.viewAll")}
                </Link>
              </div>
            ) : null}
          </div>

          <div ref={userMenuRef} className="appHeaderMenuAnchor">
            <button
              type="button"
              className={`appHeaderUserTrigger ${openMenu === "user" ? "appHeaderUserTriggerOpen" : ""}`}
              onClick={() => setOpenMenu((current) => (current === "user" ? null : "user"))}
              aria-haspopup="menu"
              aria-expanded={openMenu === "user"}
              aria-label={tHeader("userMenu")}
            >
              <span className="appHeaderAvatar" aria-hidden="true">{userInitials}</span>
              <span className="appHeaderUserTriggerMeta">
                <span className="appHeaderUserTriggerName">{username}</span>
              </span>
              <span className="appHeaderChevron" aria-hidden="true"><AppIcon name="chevronDown" /></span>
            </button>
            {openMenu === "user" ? (
              <div
                className="appHeaderMenuPanel appHeaderUserPanel"
                role="menu"
                onKeyDown={handleMenuNavigation}
              >
                <div className="appHeaderUserPanelHeader">
                  <span className="appHeaderAvatar appHeaderAvatarLarge" aria-hidden="true">{userInitials}</span>
                  <div className="appHeaderUserPanelText">
                    <div className="appHeaderUserPanelName">{username}</div>
                    <div className="appHeaderUserPanelSubtext" title={userSubtitle}>{userSubtitle}</div>
                  </div>
                </div>
                <Link
                  href={withLocalePath("/settings", locale)}
                  className="appHeaderMenuLink"
                  onClick={() => setOpenMenu(null)}
                  role="menuitem"
                >
                  <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="users" /></span>
                  <span>{tHeader("user.profile")}</span>
                </Link>
                <Link
                  href={withLocalePath("/settings", locale)}
                  className="appHeaderMenuLink"
                  onClick={() => setOpenMenu(null)}
                  role="menuitem"
                >
                  <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="settings" /></span>
                  <span>{tHeader("user.settings")}</span>
                </Link>
                <button
                  type="button"
                  className="appHeaderMenuLink appHeaderMenuLinkDanger"
                  onClick={() => void handleLogout()}
                  disabled={logoutLoading}
                  role="menuitem"
                >
                  <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="logout" /></span>
                  <span>{logoutLoading ? tNav("loggingOut") : tNav("logout")}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  extractLocaleFromPathname,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";

type BreadcrumbItem = {
  label: string;
  href?: string;
  icon: BreadcrumbIconKey;
  tone?: "default" | "settings" | "admin";
};

type BreadcrumbIconKey =
  | "dashboard"
  | "trade"
  | "bots"
  | "grid"
  | "predictions"
  | "calendar"
  | "news"
  | "settings"
  | "help"
  | "admin"
  | "detail"
  | "plus"
  | "risk"
  | "users"
  | "audit"
  | "subscription"
  | "billing"
  | "server"
  | "telegram"
  | "ai"
  | "exchange"
  | "template"
  | "vault"
  | "wallet"
  | "funding"
  | "generic";

function humanizeSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "ai") return "AI";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function withLinks(
  items: Array<{ label: string; path: string | null; icon: BreadcrumbIconKey }>,
  locale: AppLocale
): BreadcrumbItem[] {
  return items.map((item, index) => ({
    label: item.label,
    href: item.path && index < items.length - 1 ? withLocalePath(item.path, locale) : undefined,
    icon: item.icon,
    tone:
      item.path?.startsWith("/admin")
        ? "admin"
        : item.path?.startsWith("/settings")
          ? "settings"
          : "default"
  }));
}

function prependDashboardRoot(
  items: Array<{ label: string; path: string | null; icon: BreadcrumbIconKey }>,
  dashboard: { label: string; icon: BreadcrumbIconKey }
) {
  if (items.length === 0) return items;
  if (items[0]?.path === "/dashboard") return items;
  return [{ label: dashboard.label, path: "/dashboard", icon: dashboard.icon }, ...items];
}

function iconForSegment(segment: string): BreadcrumbIconKey {
  const normalized = segment.trim().toLowerCase();
  if (normalized === "dashboard") return "dashboard";
  if (normalized === "trade" || normalized === "trading-desk") return "trade";
  if (normalized === "bots") return "bots";
  if (normalized === "grid") return "grid";
  if (normalized === "predictions") return "predictions";
  if (normalized === "calendar") return "calendar";
  if (normalized === "news") return "news";
  if (normalized === "funding") return "funding";
  if (normalized === "settings") return "settings";
  if (normalized === "help") return "help";
  if (normalized === "admin") return "admin";
  return "generic";
}

function BreadcrumbIcon({ icon }: { icon: BreadcrumbIconKey }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  switch (icon) {
    case "dashboard":
      return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></svg>;
    case "trade":
      return <svg {...common}><path d="M4 16l5-5 4 3 7-7" /><path d="M20 10V6h-4" /><path d="M4 20h16" /></svg>;
    case "bots":
      return <svg {...common}><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M9 8V5h6v3" /><circle cx="10" cy="13" r="1" /><circle cx="14" cy="13" r="1" /><path d="M8 17h8" /></svg>;
    case "grid":
      return <svg {...common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>;
    case "predictions":
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M7 14l3-3 3 2 4-5" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
    case "news":
      return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>;
    case "help":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-.7.7-1.8 1.3-1.8 2.7" /><circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" /></svg>;
    case "admin":
      return <svg {...common}><path d="M12 3l7 4v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V7z" /><path d="M12 9v6M9 12h6" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "risk":
      return <svg {...common}><path d="M12 4l9 15H3z" /><path d="M12 9v5" /><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="10" r="3" /><path d="M4 19a5 5 0 0 1 10 0" /><path d="M17 8h3M18.5 6.5v3" /></svg>;
    case "audit":
      return <svg {...common}><path d="M8 7h8M8 12h8M8 17h5" /><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
    case "subscription":
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
    case "billing":
      return <svg {...common}><path d="M12 3v18" /><path d="M16.5 7.5c0-1.9-1.8-3.5-4.5-3.5S7.5 5.3 7.5 7.2 9 10 12 10s4.5 1.4 4.5 3.3-1.8 3.7-4.5 3.7-4.5-1.6-4.5-3.5" /></svg>;
    case "server":
      return <svg {...common}><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7h.01M8 17h.01" /></svg>;
    case "telegram":
      return <svg {...common}><path d="M21 4L3 11l6 2 2 6 10-15z" /><path d="M9 13l4 3" /></svg>;
    case "ai":
      return <svg {...common}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" /></svg>;
    case "exchange":
      return <svg {...common}><path d="M3 12h18" /><path d="M12 3a9 9 0 1 1 0 18" /><path d="M12 3a9 9 0 0 0 0 18" /></svg>;
    case "template":
      return <svg {...common}><path d="M7 4h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M14 4v5h5" /></svg>;
    case "vault":
      return <svg {...common}><path d="M5 7h14l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>;
    case "wallet":
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /><path d="M16 12h.01" /></svg>;
    case "funding":
      return <svg {...common}><path d="M4 7h10" /><path d="M10 3l4 4-4 4" /><path d="M20 17H10" /><path d="M14 13l-4 4 4 4" /></svg>;
    case "detail":
      return <svg {...common}><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h6" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

function BreadcrumbChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AppBreadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale() as AppLocale;
  const tNav = useTranslations("nav");
  const tCrumbs = useTranslations("nav.breadcrumbs");
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const settingsSection = searchParams.get("section");

  const items = useMemo<BreadcrumbItem[]>(() => {
    const normalizedPath = pathnameWithoutLocale === "/" ? "/dashboard" : pathnameWithoutLocale;

    const root = {
      dashboard: { label: tNav("dashboard"), icon: "dashboard" as BreadcrumbIconKey },
      trade: { label: tNav("manualTrading"), icon: "trade" as BreadcrumbIconKey },
      bots: { label: tNav("bots"), icon: "bots" as BreadcrumbIconKey },
      gridBots: { label: tNav("gridBots"), icon: "grid" as BreadcrumbIconKey },
      predictions: { label: tNav("predictions"), icon: "predictions" as BreadcrumbIconKey },
      calendar: { label: tNav("calendar"), icon: "calendar" as BreadcrumbIconKey },
      news: { label: tNav("news"), icon: "news" as BreadcrumbIconKey },
      wallet: { label: tNav("wallet"), icon: "wallet" as BreadcrumbIconKey },
      funding: { label: tNav("funding"), icon: "funding" as BreadcrumbIconKey },
      vaults: { label: tNav("vaults"), icon: "vault" as BreadcrumbIconKey },
      settings: { label: tNav("settings"), icon: "settings" as BreadcrumbIconKey },
      help: { label: tNav("help"), icon: "help" as BreadcrumbIconKey },
      admin: { label: tCrumbs("admin"), icon: "admin" as BreadcrumbIconKey },
      botDetails: { label: tCrumbs("botDetails"), icon: "detail" as BreadcrumbIconKey },
      botSettings: { label: tCrumbs("botSettings"), icon: "settings" as BreadcrumbIconKey },
      newBot: { label: tCrumbs("newBot"), icon: "plus" as BreadcrumbIconKey },
      newInstance: { label: tCrumbs("newInstance"), icon: "plus" as BreadcrumbIconKey },
      gridInstance: { label: tCrumbs("gridInstance"), icon: "detail" as BreadcrumbIconKey },
      priceSupport: { label: tCrumbs("priceSupport"), icon: "detail" as BreadcrumbIconKey },
      notifications: { label: tCrumbs("notifications"), icon: "telegram" as BreadcrumbIconKey },
      risk: { label: tCrumbs("risk"), icon: "risk" as BreadcrumbIconKey },
      setup: { label: tCrumbs("setup"), icon: "plus" as BreadcrumbIconKey },
      users: { label: tCrumbs("users"), icon: "users" as BreadcrumbIconKey },
      roles: { label: tCrumbs("roles"), icon: "users" as BreadcrumbIconKey },
      audit: { label: tCrumbs("audit"), icon: "audit" as BreadcrumbIconKey },
      subscription: { label: tCrumbs("subscription"), icon: "subscription" as BreadcrumbIconKey },
      subscriptionOrder: { label: tCrumbs("subscriptionOrder"), icon: "billing" as BreadcrumbIconKey },
      globalDefaults: { label: tCrumbs("globalDefaults"), icon: "settings" as BreadcrumbIconKey },
      billing: { label: tCrumbs("billing"), icon: "billing" as BreadcrumbIconKey },
      apiKeys: { label: tCrumbs("apiKeys"), icon: "settings" as BreadcrumbIconKey },
      serverInfo: { label: tCrumbs("serverInfo"), icon: "server" as BreadcrumbIconKey },
      predictionDefaults: { label: tCrumbs("predictionDefaults"), icon: "predictions" as BreadcrumbIconKey },
      accessSection: { label: tCrumbs("accessSection"), icon: "settings" as BreadcrumbIconKey },
      smtp: { label: tCrumbs("smtp"), icon: "server" as BreadcrumbIconKey },
      predictionRefresh: { label: tCrumbs("predictionRefresh"), icon: "predictions" as BreadcrumbIconKey },
      telegram: { label: tCrumbs("telegram"), icon: "telegram" as BreadcrumbIconKey },
      aiPrompts: { label: tCrumbs("aiPrompts"), icon: "ai" as BreadcrumbIconKey },
      aiStrategies: { label: tCrumbs("aiStrategies"), icon: "ai" as BreadcrumbIconKey },
      indicatorSettings: { label: tCrumbs("indicatorSettings"), icon: "settings" as BreadcrumbIconKey },
      aiTrace: { label: tCrumbs("aiTrace"), icon: "ai" as BreadcrumbIconKey },
      exchanges: { label: tCrumbs("exchanges"), icon: "exchange" as BreadcrumbIconKey },
      strategies: { label: tCrumbs("strategies"), icon: "ai" as BreadcrumbIconKey },
      localStrategies: { label: tCrumbs("localStrategies"), icon: "ai" as BreadcrumbIconKey },
      strategyBuilder: { label: tCrumbs("strategyBuilder"), icon: "ai" as BreadcrumbIconKey },
      aiGenerator: { label: tCrumbs("aiGenerator"), icon: "ai" as BreadcrumbIconKey },
      gridTemplates: { label: tCrumbs("gridTemplates"), icon: "template" as BreadcrumbIconKey },
      gridHyperliquidPilot: { label: tCrumbs("gridHyperliquidPilot"), icon: "vault" as BreadcrumbIconKey },
      templateDetails: { label: tCrumbs("templateDetails"), icon: "detail" as BreadcrumbIconKey },
      vaultExecution: { label: tCrumbs("vaultExecution"), icon: "vault" as BreadcrumbIconKey },
      walletPage: { label: tCrumbs("wallet"), icon: "wallet" as BreadcrumbIconKey },
      fundingHistoryPage: { label: tCrumbs("fundingHistory"), icon: "detail" as BreadcrumbIconKey },
      vaultsPage: { label: tCrumbs("vaults"), icon: "vault" as BreadcrumbIconKey },
      vaultDetailPage: { label: tCrumbs("vaultDetail"), icon: "detail" as BreadcrumbIconKey }
    };

    if (normalizedPath === "/settings" && settingsSection === "strategy") {
      return withLinks(prependDashboardRoot([
        { label: root.settings.label, path: "/settings", icon: root.settings.icon },
        { label: root.strategies.label, path: null, icon: root.strategies.icon }
      ], root.dashboard), locale);
    }

    const botSettingsMatch = normalizedPath.match(/^\/bots\/([^/]+)\/settings$/);
    if (botSettingsMatch) {
      const botPath = `/bots/${botSettingsMatch[1]}`;
      return withLinks(
        prependDashboardRoot([
          { label: root.bots.label, path: "/bots", icon: root.bots.icon },
          { label: root.botDetails.label, path: botPath, icon: root.botDetails.icon },
          { label: root.botSettings.label, path: null, icon: root.botSettings.icon }
        ], root.dashboard),
        locale
      );
    }

    const botPriceSupportMatch = normalizedPath.match(/^\/bots\/([^/]+)\/price-support$/);
    if (botPriceSupportMatch) {
      const botPath = `/bots/${botPriceSupportMatch[1]}`;
      return withLinks(
        prependDashboardRoot([
          { label: root.bots.label, path: "/bots", icon: root.bots.icon },
          { label: root.botDetails.label, path: botPath, icon: root.botDetails.icon },
          { label: root.priceSupport.label, path: null, icon: root.priceSupport.icon }
        ], root.dashboard),
        locale
      );
    }

    const exactDefinitions: Array<{
      test: RegExp;
      items: Array<{ label: string; path: string | null; icon: BreadcrumbIconKey }>;
    }> = [
      {
        test: /^\/dashboard$/,
        items: [{ label: root.dashboard.label, path: "/dashboard", icon: root.dashboard.icon }]
      },
      {
        test: /^\/trading-desk$/,
        items: [{ label: root.trade.label, path: "/trade", icon: root.trade.icon }]
      },
      {
        test: /^\/trade$/,
        items: [{ label: root.trade.label, path: "/trade", icon: root.trade.icon }]
      },
      {
        test: /^\/predictions$/,
        items: [{ label: root.predictions.label, path: "/predictions", icon: root.predictions.icon }]
      },
      {
        test: /^\/calendar$/,
        items: [{ label: root.calendar.label, path: "/calendar", icon: root.calendar.icon }]
      },
      {
        test: /^\/news$/,
        items: [{ label: root.news.label, path: "/news", icon: root.news.icon }]
      },
      {
        test: /^\/wallet$/,
        items: [{ label: root.walletPage.label, path: "/wallet", icon: root.walletPage.icon }]
      },
      {
        test: /^\/wallet\/history$/,
        items: [
          { label: root.walletPage.label, path: "/wallet", icon: root.walletPage.icon },
          { label: root.fundingHistoryPage.label, path: null, icon: root.fundingHistoryPage.icon }
        ]
      },
      {
        test: /^\/vaults$/,
        items: [{ label: root.vaultsPage.label, path: "/vaults", icon: root.vaultsPage.icon }]
      },
      {
        test: /^\/vaults\/[^/]+$/,
        items: [
          { label: root.vaultsPage.label, path: "/vaults", icon: root.vaultsPage.icon },
          { label: root.vaultDetailPage.label, path: null, icon: root.vaultDetailPage.icon }
        ]
      },
      {
        test: /^\/help$/,
        items: [{ label: root.help.label, path: "/help", icon: root.help.icon }]
      },
      {
        test: /^\/bots$/,
        items: [{ label: root.bots.label, path: "/bots", icon: root.bots.icon }]
      },
      {
        test: /^\/bots\/new$/,
        items: [
          { label: root.bots.label, path: "/bots", icon: root.bots.icon },
          { label: root.newBot.label, path: "/bots/new", icon: root.newBot.icon }
        ]
      },
      {
        test: /^\/bots\/catalog$/,
        items: [
          { label: root.gridBots.label, path: "/bots/catalog", icon: root.gridBots.icon }
        ]
      },
      {
        test: /^\/bots\/grid$/,
        items: [
          { label: root.gridBots.label, path: "/bots/catalog", icon: root.gridBots.icon }
        ]
      },
      {
        test: /^\/bots\/grid\/new$/,
        items: [
          { label: root.gridBots.label, path: "/bots/catalog", icon: root.gridBots.icon },
          { label: root.newInstance.label, path: "/bots/grid/new", icon: root.newInstance.icon }
        ]
      },
      {
        test: /^\/bots\/grid\/[^/]+$/,
        items: [
          { label: root.gridBots.label, path: "/bots/catalog", icon: root.gridBots.icon },
          { label: root.gridInstance.label, path: null, icon: root.gridInstance.icon }
        ]
      },
      {
        test: /^\/bots\/[^/]+$/,
        items: [
          { label: root.bots.label, path: "/bots", icon: root.bots.icon },
          { label: root.botDetails.label, path: null, icon: root.botDetails.icon }
        ]
      },
      {
        test: /^\/settings$/,
        items: [{ label: root.settings.label, path: "/settings", icon: root.settings.icon }]
      },
      {
        test: /^\/settings\/notifications$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.notifications.label, path: null, icon: root.notifications.icon }
        ]
      },
      {
        test: /^\/settings\/risk$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.risk.label, path: null, icon: root.risk.icon }
        ]
      },
      {
        test: /^\/settings\/setup$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.setup.label, path: null, icon: root.setup.icon }
        ]
      },
      {
        test: /^\/settings\/users$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.users.label, path: null, icon: root.users.icon }
        ]
      },
      {
        test: /^\/settings\/roles$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.roles.label, path: null, icon: root.roles.icon }
        ]
      },
      {
        test: /^\/settings\/audit$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.audit.label, path: null, icon: root.audit.icon }
        ]
      },
      {
        test: /^\/settings\/subscription\/order$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.subscription.label, path: "/settings/subscription", icon: root.subscription.icon },
          { label: root.subscriptionOrder.label, path: null, icon: root.subscriptionOrder.icon }
        ]
      },
      {
        test: /^\/settings\/subscription$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.subscription.label, path: null, icon: root.subscription.icon }
        ]
      },
      {
        test: /^\/settings\/global-defaults$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.globalDefaults.label, path: null, icon: root.globalDefaults.icon }
        ]
      },
      {
        test: /^\/admin$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: null, icon: root.admin.icon }
        ]
      },
      {
        test: /^\/admin\/billing$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.billing.label, path: null, icon: root.billing.icon }
        ]
      },
      {
        test: /^\/admin\/api-keys$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.apiKeys.label, path: null, icon: root.apiKeys.icon }
        ]
      },
      {
        test: /^\/admin\/server-info$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.serverInfo.label, path: null, icon: root.serverInfo.icon }
        ]
      },
      {
        test: /^\/admin\/prediction-defaults$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.predictionDefaults.label, path: null, icon: root.predictionDefaults.icon }
        ]
      },
      {
        test: /^\/admin\/access-section$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.accessSection.label, path: null, icon: root.accessSection.icon }
        ]
      },
      {
        test: /^\/admin\/users$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.users.label, path: null, icon: root.users.icon }
        ]
      },
      {
        test: /^\/admin\/smtp$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.smtp.label, path: null, icon: root.smtp.icon }
        ]
      },
      {
        test: /^\/admin\/prediction-refresh$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.predictionRefresh.label, path: null, icon: root.predictionRefresh.icon }
        ]
      },
      {
        test: /^\/admin\/telegram$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.telegram.label, path: null, icon: root.telegram.icon }
        ]
      },
      {
        test: /^\/admin\/ai-prompts$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.aiPrompts.label, path: null, icon: root.aiPrompts.icon }
        ]
      },
      {
        test: /^\/admin\/indicator-settings$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.indicatorSettings.label, path: null, icon: root.indicatorSettings.icon }
        ]
      },
      {
        test: /^\/admin\/ai-trace$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.aiTrace.label, path: null, icon: root.aiTrace.icon }
        ]
      },
      {
        test: /^\/admin\/exchanges$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.exchanges.label, path: null, icon: root.exchanges.icon }
        ]
      },
      {
        test: /^\/admin\/vault-execution$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.vaultExecution.label, path: null, icon: root.vaultExecution.icon }
        ]
      },
      {
        test: /^\/admin\/grid-hyperliquid-pilot$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.gridHyperliquidPilot.label, path: null, icon: root.gridHyperliquidPilot.icon }
        ]
      },
      {
        test: /^\/admin\/strategies$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategies.label, path: null, icon: root.strategies.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/local$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategies.label, path: "/admin/strategies", icon: root.strategies.icon },
          { label: root.localStrategies.label, path: null, icon: root.localStrategies.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/builder$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategies.label, path: "/admin/strategies", icon: root.strategies.icon },
          { label: root.strategyBuilder.label, path: null, icon: root.strategyBuilder.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/ai$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategies.label, path: "/admin/strategies", icon: root.strategies.icon },
          { label: root.aiStrategies.label, path: null, icon: root.aiStrategies.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/ai-generator$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategies.label, path: "/admin/strategies", icon: root.strategies.icon },
          { label: root.aiGenerator.label, path: null, icon: root.aiGenerator.icon }
        ]
      },
      {
        test: /^\/admin\/grid-templates$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.gridTemplates.label, path: null, icon: root.gridTemplates.icon }
        ]
      },
      {
        test: /^\/admin\/grid-templates\/[^/]+$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.gridTemplates.label, path: "/admin/grid-templates", icon: root.gridTemplates.icon },
          { label: root.templateDetails.label, path: null, icon: root.templateDetails.icon }
        ]
      }
    ];

    const exact = exactDefinitions.find((definition) => definition.test.test(normalizedPath));
    if (exact) {
      return withLinks(prependDashboardRoot(exact.items, root.dashboard), locale);
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments.length === 0) {
      return [{ label: root.dashboard.label, icon: root.dashboard.icon }];
    }

    const fallbackItems: Array<{ label: string; path: string | null; icon: BreadcrumbIconKey }> = [];
    let accumulatedPath = "";
    for (const segment of segments) {
      accumulatedPath += `/${segment}`;
      fallbackItems.push({
        label: humanizeSegment(segment),
        path: accumulatedPath,
        icon: iconForSegment(segment)
      });
    }

    return withLinks(prependDashboardRoot(fallbackItems, root.dashboard), locale);
  }, [locale, pathnameWithoutLocale, settingsSection, tCrumbs, tNav]);

  if (items.length === 0) return null;

  return (
    <nav className="appBreadcrumbs" aria-label={tCrumbs("ariaLabel")}>
      <div className="container appBreadcrumbsInner">
        <ol className="appBreadcrumbsList">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const isFirst = index === 0;
            const hideOnMobile = items.length > 3 && index > 0 && index < items.length - 2;
            return (
              <li
                key={`${item.label}-${index}`}
                className={`appBreadcrumbsItem ${hideOnMobile ? "appBreadcrumbsItemMobileHidden" : ""} ${isLast ? "appBreadcrumbsItemCurrent" : ""}`}
              >
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className={`appBreadcrumbsLink appBreadcrumbsTone-${item.tone ?? "default"} ${isFirst ? "appBreadcrumbsLinkHome" : ""}`}
                    aria-label={isFirst ? item.label : undefined}
                    title={item.label}
                  >
                    <span
                      className={`appBreadcrumbsIcon ${isFirst ? "appBreadcrumbsIconHome" : ""}`}
                      aria-hidden="true"
                    >
                      <BreadcrumbIcon icon={item.icon} />
                    </span>
                    {!isFirst ? <span className="appBreadcrumbsLabel">{item.label}</span> : null}
                  </Link>
                ) : (
                  <span
                    className={`appBreadcrumbsCurrent appBreadcrumbsTone-${item.tone ?? "default"} ${isFirst ? "appBreadcrumbsCurrentHome" : ""}`}
                    aria-current="page"
                  >
                    <span
                      className={`appBreadcrumbsIcon appBreadcrumbsIconCurrent ${isFirst ? "appBreadcrumbsIconHome" : ""}`}
                      aria-hidden="true"
                    >
                      <BreadcrumbIcon icon={item.icon} />
                    </span>
                    {!isFirst ? <span className="appBreadcrumbsLabel">{item.label}</span> : null}
                  </span>
                )}
                {!isLast ? (
                  <span className="appBreadcrumbsSeparator" aria-hidden="true">
                    {hideOnMobile ? "..." : <BreadcrumbChevron />}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

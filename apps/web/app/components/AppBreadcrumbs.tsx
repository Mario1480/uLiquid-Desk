"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import {
  extractLocaleFromPathname,
  withLocalePath,
  type AppLocale
} from "../../i18n/config";
import { AppIcon, type AppIconName } from "./AppIcon";

type BreadcrumbItem = {
  label: string;
  href?: string;
  icon: BreadcrumbIconKey;
  tone?: "default" | "settings" | "admin";
};

type BreadcrumbIconKey = AppIconName;

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
  if (normalized === "accounts") return "accounts";
  if (normalized === "funding") return "funding";
  if (normalized === "settings") return "settings";
  if (normalized === "help") return "help";
  if (normalized === "admin") return "admin";
  return "generic";
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
      accounts: { label: tNav("accounts"), icon: "accounts" as BreadcrumbIconKey },
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
      newTemplate: { label: tCrumbs("newTemplate"), icon: "plus" as BreadcrumbIconKey },
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
        test: /^\/accounts$/,
        items: [{ label: root.accounts.label, path: "/accounts", icon: root.accounts.icon }]
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
        test: /^\/bots\/catalog\/new$/,
        items: [
          { label: root.gridBots.label, path: "/bots/catalog", icon: root.gridBots.icon },
          { label: root.newTemplate.label, path: null, icon: root.newTemplate.icon }
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
          { label: root.localStrategies.label, path: null, icon: root.localStrategies.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/builder$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.strategyBuilder.label, path: null, icon: root.strategyBuilder.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/ai$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
          { label: root.aiStrategies.label, path: null, icon: root.aiStrategies.icon }
        ]
      },
      {
        test: /^\/admin\/strategies\/ai-generator$/,
        items: [
          { label: root.settings.label, path: "/settings", icon: root.settings.icon },
          { label: root.admin.label, path: "/admin", icon: root.admin.icon },
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
              <Fragment key={`${item.label}-${index}`}>
                <li
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
                        <AppIcon name={item.icon} />
                      </span>
                      {!isFirst || isLast ? <span className="appBreadcrumbsLabel">{item.label}</span> : null}
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
                        <AppIcon name={item.icon} />
                      </span>
                      {!isFirst || isLast ? <span className="appBreadcrumbsLabel">{item.label}</span> : null}
                    </span>
                  )}
                  {!isLast ? (
                    <span className="appBreadcrumbsSeparator" aria-hidden="true">
                      <AppIcon name="chevronRight" />
                    </span>
                  ) : null}
                </li>
                {hideOnMobile && index === items.length - 3 ? (
                  <li className="appBreadcrumbsMobileEllipsis" aria-hidden="true">…</li>
                ) : null}
              </Fragment>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

"use client";
import { DeskLink } from "@/components/desk/DeskLink";

import { DeskSurface } from "@/components/desk/DeskSurface";
import { useLocale, useTranslations } from "next-intl";
import { AppIcon, type AppIconName } from "../../app/components/AppIcon";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import type { AccessSectionVisibility } from "../../src/access/accessSection";

export default function QuickActionsWidget({ visibility }: { visibility: AccessSectionVisibility }) {
  const t = useTranslations("dashboard.quickActions");
  const locale = useLocale() as AppLocale;
  const actions: Array<{ key: string; href: string; icon: AppIconName; visible: boolean; primary?: boolean }> = [
    { key: "trade", href: "/trade", icon: "trading", visible: visibility.tradingDesk, primary: true },
    { key: "prediction", href: "/predictions", icon: "predictions", visible: visibility.predictionsDashboard },
    { key: "bot", href: "/bots/new", icon: "bots", visible: visibility.bots },
    { key: "intelligence", href: "/market-intelligence", icon: "ai", visible: visibility.marketIntelligence },
    { key: "account", href: "/settings/exchange-accounts", icon: "accounts", visible: visibility.accounts }
  ];

  return (
    <DeskSurface><div className="card dashboardInsightCard dashboardQuickActionsCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
      </div>
      <div className="dashboardQuickActionsGrid">
        {actions.filter((action) => action.visible).map((action) => (
          <DeskLink
            key={action.key}
            href={withLocalePath(action.href, locale)}
            className={`btn dashboardQuickAction${action.primary ? " btnPrimary" : ""}`}
          >
            <AppIcon name={action.icon} />
            <span>{t(action.key)}</span>
            <AppIcon name="chevronRight" />
          </DeskLink>
        ))}
      </div>
    </div></DeskSurface>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import type { AccessSectionAdminResponse } from "../../src/access/accessSection";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap,
  type ProductFeatureKey
} from "../../src/access/productFeatureGates";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type AdminLinkItem = {
  href: string;
  i18nKey: string;
  category: "Access" | "Integrations" | "Web3" | "Strategy";
  feature?: ProductFeatureKey;
};

type HyperliquidPilotSummary = {
  counts: {
    resolvedUsers: number;
    activeHyperliquidDemoGridBots: number;
    issueCount: number;
  };
};

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

const ADMIN_CATEGORIES: AdminLinkItem["category"][] = ["Access", "Integrations", "Web3", "Strategy"];

function adminCategoryClassName(category: AdminLinkItem["category"]): string {
  if (category === "Access") return "adminLandingGroupAccess";
  if (category === "Integrations") return "adminLandingGroupIntegrations";
  if (category === "Web3") return "adminLandingGroupWeb3";
  return "adminLandingGroupStrategy";
}

const ADMIN_LINKS: AdminLinkItem[] = [
  {
    href: "/admin/access-section",
    i18nKey: "accessSection",
    category: "Access"
  },
  {
    href: "/admin/users",
    i18nKey: "users",
    category: "Access"
  },
  {
    href: "/admin/server-info",
    i18nKey: "serverInfo",
    category: "Access"
  },
  {
    href: "/admin/telegram",
    i18nKey: "telegram",
    category: "Integrations"
  },
  {
    href: "/admin/exchanges",
    i18nKey: "exchanges",
    category: "Integrations"
  },
  {
    href: "/admin/smtp",
    i18nKey: "smtp",
    category: "Integrations"
  },
  {
    href: "/admin/api-keys",
    i18nKey: "apiKeys",
    category: "Integrations"
  },
  {
    href: "/admin/vault-execution",
    i18nKey: "vaultExecution",
    category: "Web3",
    feature: "vaults"
  },
  {
    href: "/admin/vault-safety",
    i18nKey: "vaultSafety",
    category: "Web3",
    feature: "vaults"
  },
  {
    href: "/admin/vault-operations",
    i18nKey: "vaultOperations",
    category: "Web3",
    feature: "vaults"
  },
  {
    href: "/admin/grid-hyperliquid-pilot",
    i18nKey: "gridHyperliquidPilot",
    category: "Web3",
    feature: "grid_bots"
  },
  {
    href: "/admin/billing",
    i18nKey: "billing",
    category: "Integrations"
  },
  {
    href: "/admin/indicator-settings",
    i18nKey: "indicatorSettings",
    category: "Strategy"
  },
  {
    href: "/admin/grid-templates",
    i18nKey: "gridTemplates",
    category: "Strategy",
    feature: "grid_bots"
  },
  {
    href: "/admin/strategies/local",
    i18nKey: "localStrategies",
    category: "Strategy",
    feature: "local_strategies"
  },
  {
    href: "/admin/strategies/builder",
    i18nKey: "compositeBuilder",
    category: "Strategy",
    feature: "composite_strategies"
  },
  {
    href: "/admin/strategies/ai",
    i18nKey: "aiStrategies",
    category: "Strategy",
    feature: "ai_predictions"
  },
  {
    href: "/admin/strategies/ai-generator",
    i18nKey: "aiPromptGenerator",
    category: "Strategy",
    feature: "ai_predictions"
  },
  {
    href: "/admin/prediction-refresh",
    i18nKey: "predictionRefresh",
    category: "Strategy",
    feature: "ai_predictions"
  },
  {
    href: "/admin/prediction-defaults",
    i18nKey: "predictionDefaults",
    category: "Strategy",
    feature: "ai_predictions"
  },
  {
    href: "/admin/ai-trace",
    i18nKey: "aiTrace",
    category: "Strategy",
    feature: "ai_predictions"
  }
];

export default function AdminPage() {
  const tLanding = useTranslations("admin.landing");
  const tLinks = useTranslations("admin.links");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pilotSummary, setPilotSummary] = useState<HyperliquidPilotSummary | null>(null);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [featureGates, setFeatureGates] = useState<ProductFeatureGateMap | null>(null);

  const visibleLinks = useMemo(
    () =>
      ADMIN_LINKS.filter((item) =>
        item.feature ? isProductFeatureAllowed(featureGates, item.feature) : true
      ),
    [featureGates]
  );

  const filteredLinks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return visibleLinks;
    return visibleLinks.filter((item) =>
      [
        tLinks(`${item.i18nKey}.title`),
        tLinks(`${item.i18nKey}.description`),
        tLanding(`categories.${item.category}`)
      ].some((value) =>
        String(value).toLowerCase().includes(needle)
      )
    );
  }, [query, tLanding, tLinks, visibleLinks]);

  const groupedLinks = useMemo(
    () =>
      ADMIN_CATEGORIES
        .map((category) => ({
          category,
          items: filteredLinks.filter((item) => item.category === category)
        }))
        .filter((group) => group.items.length > 0),
    [filteredLinks]
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const me = await apiGet<any>("/auth/me");
        const subscription = await apiGet<SubscriptionFeatureResponse>("/settings/subscription").catch(
          () => null
        );
        setFeatureGates(subscription?.featureGates ?? null);
        setIsSuperadmin(Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess));
        if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) setError(tLanding("accessRequired"));
        else {
          try {
            const [summary, accessSection] = await Promise.all([
              apiGet<HyperliquidPilotSummary>("/admin/grid-hyperliquid-pilot"),
              apiGet<AccessSectionAdminResponse>("/admin/settings/access-section")
            ]);
            setPilotSummary(summary);
            setMaintenanceEnabled(Boolean(accessSection?.maintenance?.enabled));
          } catch {
            setPilotSummary(null);
            setMaintenanceEnabled(false);
          }
        }
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <div className="settingsWrap">{tLanding("loading")}</div>;

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{tLanding("title")}</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        {tLanding("subtitle")}
      </div>

      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}

      {isSuperadmin ? (
        <>
          {pilotSummary ? (
            <section className="card settingsSection">
              <div className="settingsSectionHeader">
                <h3 style={{ margin: 0 }}>{tLanding("pilotTitle")}</h3>
                <Link className="btn" href={withLocalePath("/admin/grid-hyperliquid-pilot", locale)}>
                  {tLanding("pilotOpen")}
                </Link>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div className="card" style={{ padding: 10 }}>
                  <strong>{tLanding("pilotUsers")}</strong>
                  <div>{pilotSummary.counts.resolvedUsers}</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <strong>{tLanding("pilotBots")}</strong>
                  <div>{pilotSummary.counts.activeHyperliquidDemoGridBots}</div>
                </div>
                <div className="card" style={{ padding: 10 }}>
                  <strong>{tLanding("pilotIssues")}</strong>
                  <div>{pilotSummary.counts.issueCount}</div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{tLanding("maintenanceTitle")}</h3>
              <Link className="btn" href={withLocalePath("/admin/access-section", locale)}>
                {tLanding("maintenanceOpen")}
              </Link>
            </div>
            <div className="adminLandingMaintenanceRow">
              <span
                className={`tag adminLandingMaintenanceBadge ${
                  maintenanceEnabled ? "adminLandingMaintenanceBadgeActive" : "adminLandingMaintenanceBadgeIdle"
                }`}
              >
                {maintenanceEnabled
                  ? tLanding("maintenanceStatusActive")
                  : tLanding("maintenanceStatusInactive")}
              </span>
              <div className="adminLandingDesc" style={{ minHeight: 0 }}>
                {tLanding("maintenanceDescription")}
              </div>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="adminLandingToolbar">
              <div className="adminLandingMeta">
                {tLanding("sectionsCount", { filtered: filteredLinks.length, total: ADMIN_LINKS.length })}
              </div>
              <input
                className="input adminLandingSearch"
                placeholder={tLanding("searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </section>

          {filteredLinks.length === 0 ? (
            <section className="card settingsSection">
              <div className="settingsMutedText">{tLanding("noMatch")}</div>
            </section>
          ) : null}

          <div className="adminLandingGrouped">
            {groupedLinks.map((group) => (
              <section
                key={group.category}
                className={`card settingsSection adminLandingGroupCard ${adminCategoryClassName(group.category)}`}
              >
                <div className="settingsSectionHeader">
                  <h3 style={{ margin: 0 }}>{tLanding(`categories.${group.category}`)}</h3>
                  <div className="settingsSectionMeta">{tLanding("groupSectionCount", { count: group.items.length })}</div>
                </div>
                <div className="adminLandingGrid adminLandingGroupGrid">
                  {group.items.map((item) => (
                    <article key={item.href} className="card adminLandingCard">
                      <div className="adminLandingCardHeader">
                        <h3 style={{ margin: 0 }}>{tLinks(`${item.i18nKey}.title`)}</h3>
                      </div>
                      <div className="adminLandingDesc">
                        {tLinks(`${item.i18nKey}.description`)}
                      </div>
                      <div className="adminLandingActions">
                        <Link href={withLocalePath(item.href, locale)} className="btn btnPrimary">
                          {tCommon("openSection", { title: tLinks(`${item.i18nKey}.title`) })}
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { AppIcon } from "../components/AppIcon";
import { PageHeader } from "../components/ui";

type Horizon = "intraday" | "24h" | "7d";
type ProviderState = {
  providerId: string;
  providerType: string;
  state: "healthy" | "degraded" | "unavailable" | "disabled";
  enabled: boolean;
  message?: string;
  staleDataAgeSeconds?: number;
};
type Citation = {
  id: string;
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
};
type MarketSummaryResponse = {
  summary: {
    title: string;
    generatedAt: string;
    horizon: Horizon;
    overallRisk: "low" | "moderate" | "high" | "unknown";
    sentiment: "bearish" | "neutral" | "bullish" | "mixed";
    highlights: Array<{
      type: "macro" | "crypto" | "regulation" | "security" | "market";
      importance: "low" | "medium" | "high";
      headline: string;
      explanation: string;
      sourceIds: string[];
      inference: boolean;
    }>;
    upcomingRisks: Array<{ label: string; scheduledAt?: string; sourceIds: string[] }>;
    uncertainties: string[];
  };
  citations: Citation[];
  meta: {
    model: string;
    cached: boolean;
    degraded: boolean;
    warnings: string[];
  };
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

function stateBadgeClass(state: ProviderState["state"]): string {
  if (state === "healthy") return "uiStatusBadge-success";
  if (state === "degraded") return "uiStatusBadge-warning";
  if (state === "unavailable") return "uiStatusBadge-danger";
  return "uiStatusBadge-neutral";
}

export default function MarketIntelligencePage() {
  const t = useTranslations("system.marketIntelligence");
  const locale = useLocale() as AppLocale;
  const [horizon, setHorizon] = useState<Horizon>("24h");
  const [payload, setPayload] = useState<MarketSummaryResponse | null>(null);
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [summary, providerResponse] = await Promise.all([
        apiGet<MarketSummaryResponse>(`/market-intelligence/summary?horizon=${horizon}`),
        apiGet<{ items?: ProviderState[] }>("/market-intelligence/providers")
      ]);
      setPayload(summary);
      setProviders(Array.isArray(providerResponse.items) ? providerResponse.items : []);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  const citations = useMemo(
    () => new Map((payload?.citations ?? []).map((citation) => [citation.id, citation])),
    [payload]
  );
  const healthyProviders = providers.filter((provider) => provider.state === "healthy").length;
  const incomplete = payload?.meta.degraded || providers.some((provider) => provider.state === "unavailable" || provider.state === "degraded");

  return (
    <div className="uiPage marketIntelligencePage">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={(
          <DeskButton type="button" className="btn" onClick={() => void load()} disabled={loading}>
            <AppIcon name="refresh" />
            {t("refresh")}
          </DeskButton>
        )}
      />

      <div className="marketIntelligenceToolbar" role="group" aria-label={t("horizonLabel")}>
        {(["intraday", "24h", "7d"] as Horizon[]).map((entry) => (
          <DeskButton
            key={entry}
            type="button"
            className={`btn ${horizon === entry ? "btnPrimary" : ""}`}
            onClick={() => setHorizon(entry)}
            aria-pressed={horizon === entry}
          >
            {t(`horizons.${entry}`)}
          </DeskButton>
        ))}
      </div>

      {error ? <DeskSurface><div className="uiNotice uiNotice-danger">{t("loadError")}: {error}</div></DeskSurface> : null}
      {incomplete ? <DeskSurface><div className="uiNotice uiNotice-warning">{t("dataIncomplete")}</div></DeskSurface> : null}

      <section className="marketIntelligenceMetrics" aria-label={t("overviewTitle")}>
        <DeskSurface><div className="uiMetricTile">
          <span>{t("risk")}</span>
          <strong>{payload?.summary.overallRisk ?? (loading ? "…" : "unknown")}</strong>
        </div></DeskSurface>
        <DeskSurface><div className="uiMetricTile">
          <span>{t("tone")}</span>
          <strong>{payload?.summary.sentiment ?? (loading ? "…" : "neutral")}</strong>
        </div></DeskSurface>
        <DeskSurface><div className="uiMetricTile">
          <span>{t("providers")}</span>
          <strong>{healthyProviders}/{providers.length}</strong>
        </div></DeskSurface>
        <DeskSurface><div className="uiMetricTile">
          <span>{t("updated")}</span>
          <strong>{payload ? new Date(payload.summary.generatedAt).toLocaleTimeString() : "–"}</strong>
        </div></DeskSurface>
      </section>

      <div className="marketIntelligenceGrid">
        <section className="uiSection">
          <div className="uiSectionHeader">
            <div>
              <h2>{t("driversTitle")}</h2>
              <p>{t("driversDescription")}</p>
            </div>
          </div>
          {loading && !payload ? <div className="uiEmptyState">{t("loading")}</div> : null}
          {!loading && (payload?.summary.highlights.length ?? 0) === 0 ? (
            <div className="uiEmptyState">{t("empty")}</div>
          ) : null}
          <div className="marketDriverList">
            {payload?.summary.highlights.map((highlight, index) => (
              <article className="marketDriverRow" key={`${highlight.headline}-${index}`}>
                <div className="marketDriverHeader">
                  <span className="badge">{highlight.type}</span>
                  <span className={`badge calendarImpactBadge${highlight.importance[0].toUpperCase()}${highlight.importance.slice(1)}`}>
                    {highlight.importance}
                  </span>
                  {highlight.inference ? <span className="badge">{t("inference")}</span> : <span className="badge">{t("fact")}</span>}
                </div>
                <h3>{highlight.headline}</h3>
                <p>{highlight.explanation}</p>
                <div className="marketSourceLinks">
                  {highlight.sourceIds.map((sourceId) => {
                    const source = citations.get(sourceId);
                    return source?.sourceUrl ? (
                      <a key={sourceId} href={source.sourceUrl} target="_blank" rel="noreferrer" className="btn">
                        <AppIcon name="open" />
                        {source.sourceName}
                      </a>
                    ) : null;
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="marketIntelligenceAside">
          <section className="uiSection">
            <div className="uiSectionHeader"><h2>{t("upcomingTitle")}</h2></div>
            <div className="marketUpcomingList">
              {payload?.summary.upcomingRisks.map((risk, index) => (
                <div className="marketUpcomingRow" key={`${risk.label}-${index}`}>
                  <AppIcon name="calendar" />
                  <div>
                    <strong>{risk.label}</strong>
                    <span>{risk.scheduledAt ? new Date(risk.scheduledAt).toLocaleString() : t("timeUnknown")}</span>
                    <div className="marketUpcomingSources">
                      {risk.sourceIds.map((sourceId) => {
                        const source = citations.get(sourceId);
                        return source?.sourceUrl ? (
                          <a key={sourceId} href={source.sourceUrl} target="_blank" rel="noreferrer">
                            <AppIcon name="open" />
                            {source.sourceName}
                          </a>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {!loading && (payload?.summary.upcomingRisks.length ?? 0) === 0 ? <div className="uiEmptyState">{t("noUpcoming")}</div> : null}
            </div>
          </section>

          {payload?.summary.uncertainties.length ? (
            <section className="uiSection">
              <div className="uiSectionHeader"><h2>{t("uncertaintiesTitle")}</h2></div>
              <ul className="marketUncertaintyList">
                {payload.summary.uncertainties.map((uncertainty, index) => (
                  <li key={`${uncertainty}-${index}`}>{uncertainty}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="uiSection">
            <div className="uiSectionHeader"><h2>{t("providerTitle")}</h2></div>
            <div className="marketProviderList">
              {providers.map((provider) => (
                <div className="marketProviderRow" key={`${provider.providerType}-${provider.providerId}`}>
                  <div>
                    <strong>{provider.providerId}</strong>
                    <span>{provider.providerType}</span>
                  </div>
                  <span className={`uiStatusBadge ${stateBadgeClass(provider.state)}`}>{provider.state}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="marketIntelligenceActions">
            <Link href={withLocalePath("/predictions", locale)} className="btn btnPrimary">
              <AppIcon name="predictions" />
              {t("createPrediction")}
            </Link>
            <Link href={withLocalePath("/news", locale)} className="btn">
              <AppIcon name="news" />
              {t("openNews")}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

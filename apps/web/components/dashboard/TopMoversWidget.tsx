"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPut } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

type MarketType = "spot" | "perp";
type TopMover = { symbol: string; price: number; changePct24h: number; quoteVolume24h: number };
type TopMoversResponse = {
  marketType: MarketType;
  gainers: TopMover[];
  losers: TopMover[];
  source: string;
  fetchedAt: string;
  degraded: boolean;
};

function formatPrice(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 1 ? 4 : 6 }).format(value);
}

function formatVolume(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function TopMoversWidget() {
  const t = useTranslations("dashboard.topMovers");
  const locale = useLocale() as AppLocale;
  const [response, setResponse] = useState<TopMoversResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      setResponse(await apiGet<TopMoversResponse>("/dashboard/top-movers"));
      setError(false);
    } catch {
      setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function selectMarket(marketType: MarketType) {
    if (marketType === response?.marketType) return;
    setSwitching(true);
    setError(false);
    try {
      await apiPut("/dashboard/top-movers", { marketType });
      await load(true);
    } catch {
      setError(true);
    } finally {
      setSwitching(false);
    }
  }

  const marketType = response?.marketType ?? "spot";

  function renderList(items: TopMover[], direction: "gainers" | "losers") {
    return (
      <div className="dashboardTopMoversColumn">
        <div className="dashboardTopMoversColumnTitle">
          <span>{direction === "gainers" ? t("gainers") : t("losers")}</span>
          <span>{t("volume")}</span>
        </div>
        {items.map((item, index) => (
          <Link key={item.symbol} href={withLocalePath("/trade", locale)} className="dashboardTopMoverRow">
            <span className="dashboardTopMoverRank">{index + 1}</span>
            <span className="dashboardTopMoverAsset"><strong>{item.symbol.replace("USDT", "")}</strong><small>/USDT</small></span>
            <span className="dashboardTopMoverVolume">{formatVolume(item.quoteVolume24h, locale)}</span>
            <span className="dashboardTopMoverPrice">{formatPrice(item.price, locale)}</span>
            <strong className={direction === "gainers" ? "dashboardValuePositive" : "dashboardValueNegative"}>
              {item.changePct24h > 0 ? "+" : ""}{item.changePct24h.toFixed(2)}%
            </strong>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <DeskSurface><div className="card dashboardInsightCard dashboardTopMoversCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
        <div className="dashboardTopMoversTabs" role="tablist" aria-label={t("marketType")}>
          {(["spot", "perp"] as const).map((type) => (
            <DeskButton
              key={type}
              type="button"
              role="tab"
              aria-selected={marketType === type}
              className={`dashboardPerformanceTab ${marketType === type ? "dashboardPerformanceTabActive" : ""}`}
              disabled={switching}
              onClick={() => void selectMarket(type)}
            >
              {t(type)}
            </DeskButton>
          ))}
        </div>
      </div>

      {loading && !response ? <div className="dashboardCompactWidgetState">{t("loading")}</div> : null}
      {!loading && response && response.gainers.length === 0 && response.losers.length === 0
        ? <div className="dashboardCompactWidgetState">{t("unavailable")}</div>
        : null}
      {response && (response.gainers.length > 0 || response.losers.length > 0) ? (
        <div className="dashboardTopMoversGrid dashboardWidgetScrollArea">
          {renderList(response.gainers, "gainers")}
          {renderList(response.losers, "losers")}
        </div>
      ) : null}

      <div className="dashboardCompactWidgetFooter">
        <span>{response?.source ?? "Binance"} · {t("liquidityFilter")}</span>
        {response?.degraded || error ? <span className="dashboardWidgetInlineError">{t("degraded")}</span> : null}
      </div>
    </div></DeskSurface>
  );
}

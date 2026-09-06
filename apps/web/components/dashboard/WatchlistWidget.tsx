"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPut } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { AppIcon } from "../../app/components/AppIcon";

type WatchlistQuote = {
  symbol: string;
  price: number;
  changePct24h: number;
  high24h: number | null;
  low24h: number | null;
};

type WatchlistResponse = {
  symbols: string[];
  availableSymbols: string[];
  items: WatchlistQuote[];
  source: string;
  fetchedAt: string;
  degraded: boolean;
};

function formatPrice(value: number, locale: string): string {
  const maximumFractionDigits = value >= 1_000 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export default function WatchlistWidget() {
  const t = useTranslations("dashboard.watchlist");
  const locale = useLocale() as AppLocale;
  const [response, setResponse] = useState<WatchlistResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [addSymbol, setAddSymbol] = useState("");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await apiGet<WatchlistResponse>("/dashboard/watchlist");
      setResponse(next);
      setError(false);
    } catch {
      setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    void load();
    const timer = window.setInterval(() => {
      if (mounted) void load(true);
    }, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const remainingSymbols = useMemo(
    () => (response?.availableSymbols ?? []).filter((symbol) => !response?.symbols.includes(symbol)),
    [response]
  );

  async function persist(symbols: string[]) {
    if (symbols.length === 0 || symbols.length > 10) return;
    setSaving(true);
    setError(false);
    try {
      await apiPut("/dashboard/watchlist", { symbols });
      await load(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const updatedLabel = response?.fetchedAt
    ? new Date(response.fetchedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <DeskSurface><div className="card dashboardInsightCard dashboardWatchlistCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
        <DeskButton type="button" className="btn" onClick={() => setEditing((value) => !value)}>
          <AppIcon name={editing ? "check" : "edit"} />
          {editing ? t("done") : t("edit")}
        </DeskButton>
      </div>

      {editing ? (
        <div className="dashboardWidgetSelectionPanel">
          <div className="dashboardWatchlistAddRow">
            <DeskSelect className="select" value={addSymbol} onChange={(event) => setAddSymbol(event.target.value)}>
              <option value="">{t("chooseCoin")}</option>
              {remainingSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol.replace("USDT", "")}</option>)}
            </DeskSelect>
            <DeskButton
              type="button"
              className="btn btnPrimary"
              disabled={!addSymbol || saving || (response?.symbols.length ?? 0) >= 10}
              onClick={() => {
                if (!addSymbol || !response) return;
                void persist([...response.symbols, addSymbol]);
                setAddSymbol("");
              }}
            >
              <AppIcon name="add" />
              {t("add")}
            </DeskButton>
          </div>
          <div className="dashboardWatchlistEditList">
            {(response?.symbols ?? []).map((symbol) => (
              <div key={symbol} className="dashboardWatchlistEditRow">
                <span>{symbol.replace("USDT", "")} <small>/ USDT</small></span>
                <DeskButton
                  type="button"
                  className="dashboardWatchlistRemove"
                  disabled={saving || response?.symbols.length === 1}
                  onClick={() => void persist((response?.symbols ?? []).filter((item) => item !== symbol))}
                  aria-label={t("remove", { symbol: symbol.replace("USDT", "") })}
                  title={t("remove", { symbol: symbol.replace("USDT", "") })}
                >
                  <AppIcon name="remove" />
                </DeskButton>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboardWatchlistRows dashboardWidgetScrollArea">
          {loading && !response ? <div className="dashboardCompactWidgetState">{t("loading")}</div> : null}
          {!loading && response?.items.length === 0 ? <div className="dashboardCompactWidgetState">{t("unavailable")}</div> : null}
          {response?.items.map((item) => {
            const positive = item.changePct24h >= 0;
            return (
              <Link key={item.symbol} href={withLocalePath("/trade", locale)} className="dashboardWatchlistRow">
                <div className="dashboardWatchlistAsset">
                  <strong>{item.symbol.replace("USDT", "")}</strong>
                  <span>/ USDT</span>
                </div>
                <div className="dashboardWatchlistRange">
                  <span>{t("low")}: {item.low24h === null ? "—" : formatPrice(item.low24h, locale)}</span>
                  <span>{t("high")}: {item.high24h === null ? "—" : formatPrice(item.high24h, locale)}</span>
                </div>
                <div className="dashboardWatchlistPrice">
                  <strong>{formatPrice(item.price, locale)}</strong>
                  <span className={positive ? "dashboardValuePositive" : "dashboardValueNegative"}>
                    {positive ? "+" : ""}{item.changePct24h.toFixed(2)}%
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="dashboardCompactWidgetFooter">
        <span>{response?.source ?? "Binance Spot"}{updatedLabel ? ` · ${t("updated", { time: updatedLabel })}` : ""}</span>
        {response?.degraded || error ? <span className="dashboardWidgetInlineError">{t("degraded")}</span> : null}
      </div>
    </div></DeskSurface>
  );
}

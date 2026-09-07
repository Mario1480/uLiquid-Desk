"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPut } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";

type FundingRateItem = {
  symbol: string;
  fundingRatePct: number;
  nextFundingTime: string;
  markPrice: number | null;
  elevated: boolean;
};

type FundingRatesResponse = {
  symbols: string[];
  availableSymbols: string[];
  items: FundingRateItem[];
  source: string;
  fetchedAt: string;
  degraded: boolean;
};

function countdown(target: string, now: Date): string {
  const remaining = Math.max(0, Math.floor((new Date(target).getTime() - now.getTime()) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function FundingRatesWidget() {
  const t = useTranslations("dashboard.fundingRates");
  const locale = useLocale();
  const [response, setResponse] = useState<FundingRatesResponse | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [addSymbol, setAddSymbol] = useState("");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      setResponse(await apiGet<FundingRatesResponse>("/dashboard/funding-rates"));
      setError(false);
    } catch {
      setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(true), 30_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const remainingSymbols = useMemo(
    () => (response?.availableSymbols ?? []).filter((symbol) => !response?.symbols.includes(symbol)),
    [response]
  );

  async function persist(symbols: string[]) {
    if (symbols.length === 0 || symbols.length > 6) return;
    setSaving(true);
    setError(false);
    try {
      await apiPut("/dashboard/funding-rates", { symbols });
      await load(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DeskSurface dense><div className="card dashboardInsightCard dashboardFundingRatesCard dashboardWidgetCardFill">
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
              <option value="">{t("chooseMarket")}</option>
              {remainingSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol.replace("USDT", "")}</option>)}
            </DeskSelect>
            <DeskButton
              type="button"
              className="btn btnPrimary"
              disabled={!addSymbol || saving || (response?.symbols.length ?? 0) >= 6}
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
                <span>{symbol.replace("USDT", "")} <small>/ USDT Perp</small></span>
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
        <div className="dashboardFundingRatesList dashboardWidgetScrollArea">
          {loading && !response ? <div className="dashboardCompactWidgetState">{t("loading")}</div> : null}
          {!loading && response?.items.length === 0 ? <div className="dashboardCompactWidgetState">{t("unavailable")}</div> : null}
          {response?.items.map((item) => {
            const positive = item.fundingRatePct > 0;
            const negative = item.fundingRatePct < 0;
            return (
              <div key={item.symbol} className="dashboardFundingRateRow">
                <div className="dashboardFundingRateMarket">
                  <strong>{item.symbol.replace("USDT", "")}</strong>
                  <span>/ USDT Perp</span>
                </div>
                <div className="dashboardFundingRateValue">
                  <strong className={positive ? "dashboardValuePositive" : negative ? "dashboardValueNegative" : ""}>
                    {positive ? "+" : ""}{item.fundingRatePct.toFixed(4)}%
                  </strong>
                  <span>{positive ? t("longsPay") : negative ? t("shortsPay") : t("neutral")}</span>
                </div>
                <div className="dashboardFundingRateNext">
                  {item.elevated ? <DeskBadge className="uiStatusBadge uiStatusBadge-warning">{t("elevated")}</DeskBadge> : null}
                  <span>{t("nextIn")}</span>
                  <strong>{countdown(item.nextFundingTime, now)}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="dashboardCompactWidgetFooter">
        <span>{response?.source ?? "Binance USD-M"} · {t("refresh")}</span>
        {response?.degraded || error ? <span className="dashboardWidgetInlineError">{t("degraded")}</span> : null}
        {response?.fetchedAt ? <span>{new Date(response.fetchedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span> : null}
      </div>
    </div></DeskSurface>
  );
}

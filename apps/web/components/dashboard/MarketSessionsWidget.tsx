"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPut } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";
import {
  MARKET_SESSION_DEFINITIONS,
  formatSessionCountdown,
  getMarketSessionState,
  type MarketSessionId
} from "../../src/dashboard/marketSessions";

type MarketSessionsResponse = {
  selected: MarketSessionId[];
  available: MarketSessionId[];
};

export default function MarketSessionsWidget() {
  const t = useTranslations("dashboard.marketSessions");
  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<MarketSessionId[]>(["newYork", "london", "frankfurt", "tokyo"]);
  const [draft, setDraft] = useState<MarketSessionId[]>(selected);
  const [available, setAvailable] = useState<MarketSessionId[]>(MARKET_SESSION_DEFINITIONS.map((item) => item.id));
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    void apiGet<MarketSessionsResponse>("/dashboard/market-sessions")
      .then((response) => {
        if (!mounted) return;
        setSelected(response.selected);
        setDraft(response.selected);
        setAvailable(response.available);
        setError(false);
      })
      .catch(() => {
        if (mounted) setError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const sessions = useMemo(
    () => selected.flatMap((id) => {
      const definition = MARKET_SESSION_DEFINITIONS.find((item) => item.id === id);
      return definition ? [{ definition, state: getMarketSessionState(definition, now) }] : [];
    }),
    [now, selected]
  );

  async function save() {
    if (draft.length === 0) return;
    setSaving(true);
    setError(false);
    try {
      const response = await apiPut<MarketSessionsResponse>("/dashboard/market-sessions", { selected: draft });
      setSelected(response.selected);
      setDraft(response.selected);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DeskSurface><div className="card dashboardInsightCard dashboardMarketSessionsCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
        <DeskButton
          type="button"
          className="btn"
          onClick={() => {
            if (editing) setDraft(selected);
            setEditing((value) => !value);
          }}
        >
          <AppIcon name={editing ? "cancel" : "settings"} />
          {editing ? t("cancel") : t("select")}
        </DeskButton>
      </div>

      {editing ? (
        <div className="dashboardWidgetSelectionPanel">
          <div className="dashboardWidgetChoiceGrid">
            {available.map((id) => (
              <label key={id} className="dashboardWidgetChoice">
                <DeskInput
                  type="checkbox"
                  checked={draft.includes(id)}
                  onChange={(event) => setDraft((current) => (
                    event.target.checked ? [...current, id] : current.filter((item) => item !== id)
                  ))}
                />
                <span>{t(`exchanges.${id}`)}</span>
              </label>
            ))}
          </div>
          <DeskButton type="button" className="btn btnPrimary" disabled={saving || draft.length === 0} onClick={() => void save()}>
            <AppIcon name="save" />
            {saving ? t("saving") : t("save")}
          </DeskButton>
        </div>
      ) : (
        <div className="dashboardMarketSessionsList dashboardWidgetScrollArea">
          {loading ? <div className="dashboardCompactWidgetState">{t("loading")}</div> : null}
          {!loading && sessions.map(({ definition, state }) => (
            <div key={definition.id} className="dashboardMarketSessionRow">
              <div className="dashboardMarketSessionIdentity">
                <span className={`uiStatusBadge ${state.isOpen ? "uiStatusBadge-success" : "uiStatusBadge-neutral"}`}>
                  {state.isOpen ? t("open") : t("closed")}
                </span>
                <div>
                  <strong>{t(`exchanges.${definition.id}`)}</strong>
                  <span>{state.localTime} · {t(`timeZones.${definition.id}`)}</span>
                </div>
              </div>
              <div className="dashboardMarketSessionCountdown">
                <span>{state.nextAction === "open" ? t("opensIn") : t("closesIn")}</span>
                <strong>{formatSessionCountdown(state.nextAt, now)}</strong>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dashboardCompactWidgetFooter">
        <span>{t("regularHours")}</span>
        {error ? <span className="dashboardWidgetInlineError">{t("saveError")}</span> : null}
      </div>
    </div></DeskSurface>
  );
}

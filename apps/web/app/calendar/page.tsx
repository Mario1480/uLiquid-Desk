"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../lib/api";
import { AppIcon } from "../components/AppIcon";
import { PageHeader } from "../components/ui";

type CalendarImpact = "low" | "medium" | "high";
type CalendarDayTab = "today" | "tomorrow" | "next3d" | "custom";

type EconomicEvent = {
  id: string;
  sourceId: string;
  ts: string;
  country: string;
  currency: string;
  title: string;
  impact: CalendarImpact;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: string;
};

type NextSummary = {
  currency: string;
  impactMin: CalendarImpact;
  blackoutActive: boolean;
  activeWindow: {
    from: string;
    to: string;
    event: EconomicEvent;
  } | null;
  nextEvent: EconomicEvent | null;
  asOf: string;
  degraded?: boolean;
  degradedReason?: string | null;
};

type CalendarPreferencesResponse = {
  currencies?: string[];
  impacts?: CalendarImpact[];
  version?: number;
  updatedAt?: string | null;
};

const IMPACT_ORDER: CalendarImpact[] = ["high", "medium", "low"];
const CALENDAR_CURRENCIES = [
  { code: "USD", flag: "🇺🇸" },
  { code: "EUR", flag: "🇪🇺" }
] as const;
const DEFAULT_CALENDAR_CURRENCIES = CALENDAR_CURRENCIES.map((entry) => entry.code);
const DEFAULT_CALENDAR_IMPACTS: CalendarImpact[] = [...IMPACT_ORDER];

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function fmtNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function fmtDateTimeEu(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function impactClass(impact: CalendarImpact): string {
  if (impact === "high") return "calendarImpactBadgeHigh";
  if (impact === "medium") return "calendarImpactBadgeMedium";
  return "calendarImpactBadgeLow";
}

function eventTime(event: EconomicEvent | null): number {
  if (!event) return Number.POSITIVE_INFINITY;
  const value = new Date(event.ts).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function mergeNextSummaries(summaries: NextSummary[]): NextSummary | null {
  if (summaries.length === 0) return null;
  const active = summaries
    .filter((summary) => summary.blackoutActive && summary.activeWindow)
    .sort((left, right) => eventTime(left.activeWindow?.event ?? null) - eventTime(right.activeWindow?.event ?? null))[0];
  const next = summaries
    .filter((summary) => summary.nextEvent)
    .sort((left, right) => eventTime(left.nextEvent) - eventTime(right.nextEvent))[0];
  const base = active ?? next ?? summaries[0];
  const degraded = summaries.some((summary) => summary.degraded === true);
  const degradedReason = summaries
    .map((summary) => summary.degradedReason)
    .find((reason): reason is string => Boolean(reason));
  return {
    ...base,
    currency: active?.currency ?? next?.currency ?? summaries.map((summary) => summary.currency).join("/"),
    blackoutActive: Boolean(active),
    activeWindow: active?.activeWindow ?? null,
    nextEvent: next?.nextEvent ?? null,
    degraded,
    degradedReason: degradedReason ?? null
  };
}

function normalizeImpacts(raw: unknown): CalendarImpact[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CALENDAR_IMPACTS];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is CalendarImpact => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return [...DEFAULT_CALENDAR_IMPACTS];
  return IMPACT_ORDER.filter((entry) => parsed.includes(entry));
}

function normalizeCurrencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CALENDAR_CURRENCIES];
  const parsed = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry) => /^[A-Z0-9]{2,10}$/.test(entry));
  if (parsed.length === 0) return [...DEFAULT_CALENDAR_CURRENCIES];

  const available: string[] = CALENDAR_CURRENCIES.map((entry) => entry.code);
  const merged = Array.from(new Set(parsed));
  const known = available.filter((code) => merged.includes(code));
  const unknown = merged.filter((code) => !available.includes(code));
  const ordered = [...known, ...unknown];
  return ordered.length > 0 ? ordered : [...DEFAULT_CALENDAR_CURRENCIES];
}

function dateRangeFromTab(tab: Exclude<CalendarDayTab, "custom">): { from: string; to: string } {
  const now = new Date();

  if (tab === "today") {
    const day = toDateInput(now);
    return { from: day, to: day };
  }

  if (tab === "tomorrow") {
    const tomorrow = toDateInput(addDays(now, 1));
    return { from: tomorrow, to: tomorrow };
  }

  return {
    from: toDateInput(now),
    to: toDateInput(addDays(now, 3))
  };
}

export default function CalendarPage() {
  const t = useTranslations("system.calendar");
  const locale = useLocale();
  const dateLocale = locale === "de" ? "de-DE" : "en-GB";

  const initialRange = useMemo(() => dateRangeFromTab("next3d"), []);
  const [currencies, setCurrencies] = useState<string[]>([...DEFAULT_CALENDAR_CURRENCIES]);
  const [impacts, setImpacts] = useState<CalendarImpact[]>([...DEFAULT_CALENDAR_IMPACTS]);
  const [dayTab, setDayTab] = useState<CalendarDayTab>("next3d");
  const [searchQuery, setSearchQuery] = useState("");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [nextSummary, setNextSummary] = useState<NextSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesSaveError, setPreferencesSaveError] = useState<string | null>(null);

  const selectedCurrencies = useMemo(() => normalizeCurrencies(currencies), [currencies]);

  const sortedImpacts = useMemo(
    () => IMPACT_ORDER.filter((impact) => impacts.includes(impact)),
    [impacts]
  );

  const summaryImpact = useMemo<CalendarImpact>(() => {
    if (sortedImpacts.includes("high")) return "high";
    if (sortedImpacts.includes("medium")) return "medium";
    return "low";
  }, [sortedImpacts]);

  function toggleCurrency(nextCurrency: string) {
    const normalized = nextCurrency.trim().toUpperCase();
    if (!normalized) return;

    setCurrencies((current) => {
      const active = current.includes(normalized);
      if (active) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== normalized);
      }

      const merged = [...current, normalized];
      return normalizeCurrencies(merged);
    });
  }

  function toggleImpact(nextImpact: CalendarImpact) {
    setImpacts((current) => {
      const has = current.includes(nextImpact);
      if (has) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== nextImpact);
      }

      const merged = [...current, nextImpact];
      return IMPACT_ORDER.filter((entry) => merged.includes(entry));
    });
  }

  function applyDayTab(nextTab: CalendarDayTab) {
    setDayTab(nextTab);
    if (nextTab === "custom") return;

    const range = dateRangeFromTab(nextTab);
    setFrom(range.from);
    setTo(range.to);
  }

  async function load() {
    if (!preferencesReady) return;
    setLoading(true);
    setError(null);

    try {
      const impactList = sortedImpacts.join(",");
      const currencyList = selectedCurrencies.join(",");
      const [eventsResp, nextResponses] = await Promise.all([
        apiGet<{ events: EconomicEvent[]; meta?: { limit?: number; truncated?: boolean; from?: string; to?: string } }>(
          `/economic-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&impacts=${encodeURIComponent(impactList)}&currencies=${encodeURIComponent(currencyList)}&limit=500`
        ),
        Promise.all(selectedCurrencies.map((currency) => (
          apiGet<NextSummary>(
            `/economic-calendar/next?currency=${encodeURIComponent(currency)}&impact=${summaryImpact}`
          )
        )))
      ]);

      setEvents(Array.isArray(eventsResp.events) ? eventsResp.events : []);
      setNextSummary(mergeNextSummaries(nextResponses));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadPreferences() {
      try {
        const response = await apiGet<CalendarPreferencesResponse>("/economic-calendar/preferences");
        if (cancelled) return;

        if (Array.isArray(response.currencies) && response.currencies.length > 0) {
          setCurrencies(normalizeCurrencies(response.currencies));
        }
        if (Array.isArray(response.impacts) && response.impacts.length > 0) {
          setImpacts(normalizeImpacts(response.impacts));
        }
      } catch {
        // Keep defaults if preferences are missing or temporarily unavailable.
      } finally {
        if (!cancelled) setPreferencesReady(true);
      }
    }

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesReady, selectedCurrencies.join(","), sortedImpacts.join(","), summaryImpact, from, to]);

  useEffect(() => {
    if (!preferencesReady) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void apiPut("/economic-calendar/preferences", {
        currencies: selectedCurrencies,
        impacts: sortedImpacts
      })
        .then(() => {
          if (!cancelled) setPreferencesSaveError(null);
        })
        .catch((error) => {
          if (!cancelled) setPreferencesSaveError(errMsg(error));
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [preferencesReady, selectedCurrencies.join(","), sortedImpacts.join(",")]);

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const left = new Date(a.ts).getTime();
      const right = new Date(b.ts).getTime();
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return a.ts.localeCompare(b.ts);
      }
      return left - right;
    });
    return copy;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return sortedEvents;

    return sortedEvents.filter((event) => {
      const haystack = `${event.title} ${event.country} ${event.currency}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [searchQuery, sortedEvents]);

  const showNoSearchResults =
    !loading
    && !error
    && sortedEvents.length > 0
    && filteredEvents.length === 0
    && searchQuery.trim().length > 0;

  const tabDefs: Array<{ key: CalendarDayTab; label: string }> = [
    { key: "today", label: t("tabs.today") },
    { key: "tomorrow", label: t("tabs.tomorrow") },
    { key: "next3d", label: t("tabs.next3d") },
    { key: "custom", label: t("tabs.custom") }
  ];

  return (
    <div className="calendarPage calendarProPage">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <DeskSurface><div className="card calendarFilterCard calendarProControls">
        <div className="calendarProTabRow" role="group" aria-label={t("title")}>
          {tabDefs.map((tab) => (
            <DeskButton
              key={tab.key}
              type="button"
              className={`calendarProTab ${dayTab === tab.key ? "calendarProTabActive" : ""}`}
              onClick={() => applyDayTab(tab.key)}
              aria-pressed={dayTab === tab.key}
            >
              {tab.label}
            </DeskButton>
          ))}
          <DeskButton
            type="button"
	            className="btn calendarProTabRefresh"
	            onClick={() => void load()}
	          >
	            <AppIcon name="refresh" />
	            {t("actions.refresh")}
	          </DeskButton>
        </div>

        <div className="calendarFilterGrid calendarProFilterGrid">
          <label className="calendarFilterField calendarFilterFieldCurrency">
            <div className="calendarProFilterLabel">{t("filters.currency")}</div>
            <div className="calendarCurrencyToggleRow">
              <DeskButton
                type="button"
                className={`badge calendarCurrencyToggle ${
                  selectedCurrencies.length === CALENDAR_CURRENCIES.length
                    ? "calendarProImpactToggleActive"
                    : "calendarProImpactToggleInactive"
                }`}
                onClick={() => setCurrencies([...DEFAULT_CALENDAR_CURRENCIES])}
                aria-pressed={selectedCurrencies.length === CALENDAR_CURRENCIES.length}
              >
                <span className="calendarCurrencyToggleCode">{t("filters.all")}</span>
              </DeskButton>
              {CALENDAR_CURRENCIES.map((entry) => (
                <DeskButton
                  key={entry.code}
                  type="button"
                  className={`badge calendarCurrencyToggle ${
                    selectedCurrencies.includes(entry.code)
                      ? "calendarProImpactToggleActive"
                      : "calendarProImpactToggleInactive"
                  }`}
                  onClick={() => toggleCurrency(entry.code)}
                  aria-pressed={selectedCurrencies.includes(entry.code)}
                >
                  <span className="calendarCurrencyToggleFlag">{entry.flag}</span>
                  <span className="calendarCurrencyToggleCode">{entry.code}</span>
                </DeskButton>
              ))}
            </div>
          </label>

          <label className="calendarFilterField">
            <div className="calendarProFilterLabel">{t("filters.impact")}</div>
            <div className="calendarImpactToggleRow">
              <DeskButton
                type="button"
                className={`badge ${
                  sortedImpacts.length === IMPACT_ORDER.length
                    ? "calendarProImpactToggleActive"
                    : "calendarProImpactToggleInactive"
                }`}
                onClick={() => setImpacts([...DEFAULT_CALENDAR_IMPACTS])}
                aria-pressed={sortedImpacts.length === IMPACT_ORDER.length}
              >
                {t("filters.all")}
              </DeskButton>
              {IMPACT_ORDER.map((entry) => {
                const active = impacts.includes(entry);
                return (
                  <DeskButton
                    key={entry}
                    type="button"
                    className={`badge ${impactClass(entry)} ${active ? "calendarProImpactToggleActive" : "calendarProImpactToggleInactive"}`}
                    onClick={() => toggleImpact(entry)}
                    aria-pressed={active}
                  >
                    {t(`impact.${entry}`)}
                  </DeskButton>
                );
              })}
            </div>
          </label>

          <label className="calendarFilterField">
            <div className="calendarProFilterLabel">{t("search.placeholder")}</div>
            <DeskInput
              className="input calendarProSearch"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              autoComplete="off"
            />
          </label>

          <label className="calendarFilterField calendarFilterFieldDate">
            <div className="calendarProFilterLabel">{t("filters.from")}</div>
            <DeskInput
              className="input calendarDateInput"
              type="date"
              lang={dateLocale}
              value={from}
              onChange={(event) => {
                setDayTab("custom");
                setFrom(event.target.value);
              }}
              disabled={dayTab !== "custom"}
            />
          </label>

          <label className="calendarFilterField calendarFilterFieldDate">
            <div className="calendarProFilterLabel">{t("filters.to")}</div>
            <DeskInput
              className="input calendarDateInput"
              type="date"
              lang={dateLocale}
              value={to}
              onChange={(event) => {
                setDayTab("custom");
                setTo(event.target.value);
              }}
              disabled={dayTab !== "custom"}
            />
          </label>

        </div>
      </div></DeskSurface>

      {preferencesSaveError ? (
        <DeskSurface><div className="card calendarErrorCard calendarProErrorCard">
          <strong>{t("preferencesSaveError")}:</strong> {preferencesSaveError}
        </div></DeskSurface>
      ) : null}

      {nextSummary ? (
        <DeskSurface><div className={`card calendarSummaryCard calendarProStatusStrip ${nextSummary.blackoutActive || nextSummary.degraded ? "calendarProStatusStripAlert" : ""}`}>
          <div className="calendarProStatusTitle">
            {nextSummary.degraded
              ? t("summary.degraded")
              : nextSummary.blackoutActive
                ? t("summary.blackoutActive")
                : t("summary.noBlackout")} ({nextSummary.currency})
          </div>
          {nextSummary.degraded ? (
            <div className="calendarProStatusText">{nextSummary.degradedReason ?? "calendar_degraded"}</div>
          ) : nextSummary.blackoutActive && nextSummary.activeWindow ? (
            <div className="calendarProStatusText">
              {t("summary.until")} {fmtDateTimeEu(nextSummary.activeWindow.to, dateLocale)} · {nextSummary.activeWindow.event.title}
            </div>
          ) : nextSummary.nextEvent ? (
            <div className="calendarProStatusText">
              {t("summary.nextEvent", { impact: nextSummary.impactMin })}: {nextSummary.nextEvent.title} {t("summary.at")} {fmtDateTimeEu(nextSummary.nextEvent.ts, dateLocale)}
            </div>
          ) : (
            <div className="calendarProStatusText">{t("summary.noUpcoming")}</div>
          )}
        </div></DeskSurface>
      ) : null}

      {error ? (
        <DeskSurface><div className="card calendarErrorCard calendarProErrorCard">
          <strong>{t("loadError")}:</strong> {error}
        </div></DeskSurface>
      ) : null}

      <DeskSurface><div className="card calendarEventsCard calendarProEventsCard">
        <div className="calendarProEventsHeader">
          <div className="calendarProEventsTitle">{t("eventsTitle")}</div>
          {!loading ? <div className="calendarProEventsCount">{filteredEvents.length}</div> : null}
        </div>

        {loading ? (
          <div className="calendarProStateText">{t("loadingEvents")}</div>
        ) : sortedEvents.length === 0 ? (
          <div className="calendarProStateText">{t("noEvents")}</div>
        ) : showNoSearchResults ? (
          <div className="calendarProStateText">{t("table.noSearchResults")}</div>
        ) : (
          <>
            <div className="calendarProTableWrap">
              <DeskTable className="calendarProTable">
                <thead>
                  <tr>
                    <th scope="col">{t("table.event")}</th>
                    <th scope="col">{t("table.impact")}</th>
                    <th scope="col">{t("table.currency")}</th>
                    <th scope="col">{t("table.date")}</th>
                    <th scope="col">{t("table.forecast")}</th>
                    <th scope="col">{t("table.previous")}</th>
                    <th scope="col">{t("table.actual")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} className="calendarProRow">
                      <td>
                        <span className="calendarProEventTitle" title={event.title}>{event.title}</span>
                      </td>
                      <td>
                        <span className={`badge ${impactClass(event.impact)}`}>{t(`impact.${event.impact}`)}</span>
                      </td>
                      <td>
                        <div className="calendarProCurrencyCell">
                          <span>{event.currency}</span>
                          <span className="calendarProCountry">{event.country}</span>
                        </div>
                      </td>
                      <td className="calendarProDateCell">{fmtDateTimeEu(event.ts, dateLocale)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.forecast)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.previous)}</td>
                      <td className="calendarProValueCell">{fmtNumber(event.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            </div>

            <div className="calendarProMobileList">
              {filteredEvents.map((event) => (
                <DeskSurface><article key={event.id} className="card calendarProMobileCard">
                  <div className="calendarProMobileHead">
                    <div className="calendarProMobileTitle">{event.title}</div>
                    <span className={`badge ${impactClass(event.impact)}`}>{t(`impact.${event.impact}`)}</span>
                  </div>
                  <div className="calendarProMobileMeta">
                    {fmtDateTimeEu(event.ts, dateLocale)} · {event.country} · {event.currency}
                  </div>
                  <div className="calendarProMobileValues">
                    <span>{t("table.forecast")}: {fmtNumber(event.forecast)}</span>
                    <span>{t("table.previous")}: {fmtNumber(event.previous)}</span>
                    <span>{t("table.actual")}: {fmtNumber(event.actual)}</span>
                  </div>
                </article></DeskSurface>
              ))}
            </div>
          </>
        )}
      </div></DeskSurface>
    </div>
  );
}

import type { EconomicEvent } from "../../contracts/economicCalendar.js";
import { stableHash } from "../../normalization/index.js";

const EUROSTAT_CALENDAR_ENDPOINT = "https://ec.europa.eu/eurostat/o/calendars/eventsJson";
export const EUROSTAT_CALENDAR_SOURCE = "https://ec.europa.eu/eurostat/news/euro-indicators/release-calendar";

type EurostatCalendarRecord = {
  recordid?: unknown;
  start?: unknown;
  title?: unknown;
  period?: unknown;
  datasetCodes?: unknown;
  preliminary?: unknown;
};

type EurostatEventKind = {
  key: string;
  category: string;
  importance: "low" | "medium" | "high";
};

export function buildEurostatCalendarUrl(from: string, to: string): string {
  const url = new URL(EUROSTAT_CALENDAR_ENDPOINT);
  url.searchParams.set("start", from);
  url.searchParams.set("end", to);
  url.searchParams.set("isEuroindicator", "true");
  return url.toString();
}

function eventKind(record: EurostatCalendarRecord): EurostatEventKind {
  const text = `${String(record.title ?? "")} ${String(record.datasetCodes ?? "")}`.toLowerCase();
  if (/inflation|hicp|consumer price/.test(text)) {
    return { key: "eu_cpi", category: "inflation", importance: "high" };
  }
  if (/\bgdp\b|gross domestic product|namq_10_gdp/.test(text)) {
    return { key: "eu_gdp", category: "growth", importance: "high" };
  }
  if (/unemployment|employment/.test(text)) {
    return { key: "eu_labor", category: "labor", importance: "medium" };
  }
  if (/industrial production|production in construction/.test(text)) {
    return {
      key: /construction/.test(text) ? "eu_construction" : "eu_industrial_production",
      category: "production",
      importance: /construction/.test(text) ? "low" : "medium"
    };
  }
  if (/retail trade|retail sales/.test(text)) {
    return { key: "eu_retail_trade", category: "consumption", importance: "medium" };
  }
  if (/international trade|trade in goods/.test(text)) {
    return { key: "eu_international_trade", category: "trade", importance: "medium" };
  }
  if (/interest rate|bond yield/.test(text)) {
    return { key: "eu_market_rates", category: "rates", importance: "low" };
  }
  if (/government (debt|deficit)|public debt/.test(text)) {
    return { key: "eu_government_finance", category: "government_finance", importance: "medium" };
  }
  return { key: "eu_euro_indicator", category: "economic_release", importance: "low" };
}

export function parseEurostatCalendarJson(body: string, fetchedAt = new Date().toISOString()): EconomicEvent[] {
  if (body.length > 3_000_000) throw new Error("eurostat_calendar_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("eurostat_calendar_invalid_json");
  }
  if (!Array.isArray(parsed)) throw new Error("eurostat_calendar_invalid_shape");
  const events: EconomicEvent[] = [];
  for (const candidate of parsed.slice(0, 5000)) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as EurostatCalendarRecord;
    const kind = eventKind(record);
    const recordId = String(record.recordid ?? "").trim();
    const scheduledAt = String(record.start ?? "").trim();
    const title = String(record.title ?? "").trim().slice(0, 240);
    const timestamp = new Date(scheduledAt);
    if (!recordId || !title || !Number.isFinite(timestamp.getTime())) continue;
    events.push({
      id: stableHash(`eurostat|${recordId}|${kind.key}`).slice(0, 40),
      provider: "official",
      sourceName: "Eurostat",
      sourceUrl: EUROSTAT_CALENDAR_SOURCE,
      country: "EU",
      currency: "EUR",
      category: kind.category,
      title,
      scheduledAt: timestamp.toISOString(),
      importance: kind.importance,
      status: "scheduled",
      ...(record.period ? { period: String(record.period).slice(0, 120) } : {}),
      fetchedAt,
      originalTimezone: "Europe/Luxembourg",
      timeConfidence: "exact"
    });
  }
  return events;
}

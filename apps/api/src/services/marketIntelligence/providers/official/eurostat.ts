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

export function buildEurostatCalendarUrl(from: string, to: string): string {
  const url = new URL(EUROSTAT_CALENDAR_ENDPOINT);
  url.searchParams.set("start", from);
  url.searchParams.set("end", to);
  url.searchParams.set("isEuroindicator", "true");
  return url.toString();
}

function eventKind(record: EurostatCalendarRecord): "eu_cpi" | "eu_gdp" | null {
  const text = `${String(record.title ?? "")} ${String(record.datasetCodes ?? "")}`.toLowerCase();
  if (/inflation|hicp|consumer price/.test(text)) return "eu_cpi";
  if (/\bgdp\b|gross domestic product|namq_10_gdp/.test(text)) return "eu_gdp";
  return null;
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
    const timestamp = new Date(scheduledAt);
    if (!kind || !recordId || !Number.isFinite(timestamp.getTime())) continue;
    const isCpi = kind === "eu_cpi";
    events.push({
      id: stableHash(`eurostat|${recordId}|${kind}`).slice(0, 40),
      provider: "official",
      sourceName: "Eurostat",
      sourceUrl: EUROSTAT_CALENDAR_SOURCE,
      country: "EU",
      currency: "EUR",
      category: isCpi ? "inflation" : "growth",
      title: isCpi ? "Euro Area Consumer Price Index (CPI)" : "Euro Area Gross Domestic Product (GDP)",
      scheduledAt: timestamp.toISOString(),
      importance: "high",
      status: "scheduled",
      ...(record.period ? { period: String(record.period).slice(0, 120) } : {}),
      fetchedAt,
      originalTimezone: "Europe/Luxembourg",
      timeConfidence: "exact"
    });
  }
  return events;
}

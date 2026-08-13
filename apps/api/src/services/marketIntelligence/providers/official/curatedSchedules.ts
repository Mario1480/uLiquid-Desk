import type { EconomicEvent } from "../../contracts/economicCalendar.js";
import { stableHash } from "../../normalization/index.js";
import { zonedLocalTimeToUtc } from "./ics.js";

type CuratedSeed = Omit<EconomicEvent, "id" | "provider" | "fetchedAt" | "status"> & {
  /** Stable occurrence identity. It must not contain the scheduled time. */
  sourceKey: string;
};

const FED_SOURCE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const ECB_SOURCE = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html";
const BEA_SOURCE = "https://www.bea.gov/news/schedule/full";
const CENSUS_SOURCE = "https://www.census.gov/retail/release_schedule.html";
const DOL_SOURCE = "https://www.dol.gov/newsroom/releases/opa/opa20200701";
const BLS_SOURCE = "https://www.bls.gov/schedule/";

function centralBankSeeds(params: {
  occurrence: string;
  decisionAt: string;
  pressAt: string;
  region: "us" | "eu";
}): CuratedSeed[] {
  const isUs = params.region === "us";
  const keyPrefix = isUs ? "us_fomc" : "eu_ecb";
  const sourceName = isUs ? "Federal Reserve" : "European Central Bank";
  const sourceUrl = isUs ? FED_SOURCE : ECB_SOURCE;
  const country = isUs ? "US" : "EU";
  const currency = isUs ? "USD" : "EUR";
  const originalTimezone = isUs ? "America/New_York" : "Europe/Berlin";
  const label = isUs ? "FOMC" : "ECB";
  return [
    {
      sourceKey: `${keyPrefix}_rate_decision:${params.occurrence}`,
      sourceName,
      sourceUrl,
      country,
      currency,
      category: "central_bank",
      title: `${label} Interest Rate Decision`,
      scheduledAt: params.decisionAt,
      importance: "high",
      originalTimezone,
      timeConfidence: "exact"
    },
    {
      sourceKey: `${keyPrefix}_press_conference:${params.occurrence}`,
      sourceName,
      sourceUrl,
      country,
      currency,
      category: "central_bank",
      title: `${label} Press Conference`,
      scheduledAt: params.pressAt,
      importance: "high",
      originalTimezone,
      timeConfidence: "exact"
    }
  ];
}

function usReleaseSeed(params: {
  key: string;
  title: string;
  category: string;
  period: string;
  scheduledAt: string;
  sourceName: string;
  sourceUrl: string;
  importance?: "low" | "medium" | "high";
}): CuratedSeed {
  return {
    sourceKey: `${params.key}:${params.period}`,
    sourceName: params.sourceName,
    sourceUrl: params.sourceUrl,
    country: "US",
    currency: "USD",
    category: params.category,
    title: params.title,
    scheduledAt: params.scheduledAt,
    importance: params.importance ?? "high",
    period: params.period,
    originalTimezone: "America/New_York",
    timeConfidence: "exact"
  };
}

const CURATED_SEEDS: CuratedSeed[] = [
  ...[
    ["2026-09", "2026-09-16T18:00:00.000Z", "2026-09-16T18:30:00.000Z"],
    ["2026-10", "2026-10-28T18:00:00.000Z", "2026-10-28T18:30:00.000Z"],
    ["2026-12", "2026-12-09T19:00:00.000Z", "2026-12-09T19:30:00.000Z"],
    ["2027-01", "2027-01-27T19:00:00.000Z", "2027-01-27T19:30:00.000Z"],
    ["2027-03", "2027-03-17T18:00:00.000Z", "2027-03-17T18:30:00.000Z"],
    ["2027-04", "2027-04-28T18:00:00.000Z", "2027-04-28T18:30:00.000Z"],
    ["2027-06", "2027-06-09T18:00:00.000Z", "2027-06-09T18:30:00.000Z"],
    ["2027-07", "2027-07-28T18:00:00.000Z", "2027-07-28T18:30:00.000Z"],
    ["2027-09", "2027-09-15T18:00:00.000Z", "2027-09-15T18:30:00.000Z"],
    ["2027-10", "2027-10-27T18:00:00.000Z", "2027-10-27T18:30:00.000Z"],
    ["2027-12", "2027-12-08T19:00:00.000Z", "2027-12-08T19:30:00.000Z"]
  ].flatMap(([occurrence, decisionAt, pressAt]) => centralBankSeeds({ occurrence, decisionAt, pressAt, region: "us" })),
  ...[
    ["2026-09", "2026-09-10T12:15:00.000Z", "2026-09-10T12:45:00.000Z"],
    ["2026-10", "2026-10-29T13:15:00.000Z", "2026-10-29T13:45:00.000Z"],
    ["2026-12", "2026-12-17T13:15:00.000Z", "2026-12-17T13:45:00.000Z"],
    ["2027-02", "2027-02-04T13:15:00.000Z", "2027-02-04T13:45:00.000Z"],
    ["2027-03", "2027-03-18T13:15:00.000Z", "2027-03-18T13:45:00.000Z"],
    ["2027-04", "2027-04-29T12:15:00.000Z", "2027-04-29T12:45:00.000Z"],
    ["2027-06", "2027-06-10T12:15:00.000Z", "2027-06-10T12:45:00.000Z"],
    ["2027-07", "2027-07-22T12:15:00.000Z", "2027-07-22T12:45:00.000Z"],
    ["2027-09", "2027-09-09T12:15:00.000Z", "2027-09-09T12:45:00.000Z"],
    ["2027-10", "2027-10-28T13:15:00.000Z", "2027-10-28T13:45:00.000Z"],
    ["2027-12", "2027-12-16T13:15:00.000Z", "2027-12-16T13:45:00.000Z"]
  ].flatMap(([occurrence, decisionAt, pressAt]) => centralBankSeeds({ occurrence, decisionAt, pressAt, region: "eu" })),
  ...[
    ["2026-Q2-second", "2026-08-26T12:30:00.000Z"],
    ["2026-Q2-third", "2026-09-30T12:30:00.000Z"],
    ["2026-Q3-advance", "2026-10-29T12:30:00.000Z"],
    ["2026-Q3-second", "2026-11-25T13:30:00.000Z"],
    ["2026-Q3-third", "2026-12-23T13:30:00.000Z"]
  ].map(([period, scheduledAt]) => usReleaseSeed({
    key: "us_gdp",
    title: "U.S. Gross Domestic Product (GDP)",
    category: "growth",
    period,
    scheduledAt,
    sourceName: "U.S. Bureau of Economic Analysis",
    sourceUrl: BEA_SOURCE
  })),
  ...[
    ["2026-07", "2026-08-26T12:30:00.000Z"],
    ["2026-08", "2026-09-30T12:30:00.000Z"],
    ["2026-09", "2026-10-29T12:30:00.000Z"],
    ["2026-10", "2026-11-25T13:30:00.000Z"],
    ["2026-11", "2026-12-23T13:30:00.000Z"]
  ].flatMap(([period, scheduledAt]) => [
    usReleaseSeed({
      key: "us_pce",
      title: "Personal Consumption Expenditures (PCE)",
      category: "inflation",
      period,
      scheduledAt,
      sourceName: "U.S. Bureau of Economic Analysis",
      sourceUrl: BEA_SOURCE
    }),
    usReleaseSeed({
      key: "us_core_pce",
      title: "Core Personal Consumption Expenditures (Core PCE)",
      category: "inflation",
      period,
      scheduledAt,
      sourceName: "U.S. Bureau of Economic Analysis",
      sourceUrl: BEA_SOURCE
    })
  ]),
  ...[
    ["2026-07", "2026-08-14T12:30:00.000Z"],
    ["2026-08", "2026-09-16T12:30:00.000Z"],
    ["2026-09", "2026-10-15T12:30:00.000Z"],
    ["2026-10", "2026-11-17T13:30:00.000Z"],
    ["2026-11", "2026-12-16T13:30:00.000Z"]
  ].map(([period, scheduledAt]) => usReleaseSeed({
    key: "us_retail_sales",
    title: "U.S. Retail Sales",
    category: "consumption",
    period,
    scheduledAt,
    sourceName: "U.S. Census Bureau",
    sourceUrl: CENSUS_SOURCE
  }))
];

function blsFallbackSeed(params: {
  key: string;
  title: string;
  category: "inflation" | "labor";
  period: string;
  scheduledAt: string;
}): CuratedSeed {
  return {
    sourceKey: `bls|${params.key}|${params.period}`,
    sourceName: "U.S. Bureau of Labor Statistics",
    sourceUrl: BLS_SOURCE,
    country: "US",
    currency: "USD",
    category: params.category,
    title: params.title,
    scheduledAt: params.scheduledAt,
    importance: "high",
    period: params.period,
    originalTimezone: "America/New_York",
    timeConfidence: "exact"
  };
}

const BLS_FALLBACK_SEEDS: CuratedSeed[] = [
  ...[
    ["2026-07", "2026-08-12T12:30:00.000Z"],
    ["2026-08", "2026-09-11T12:30:00.000Z"],
    ["2026-09", "2026-10-14T12:30:00.000Z"],
    ["2026-10", "2026-11-10T13:30:00.000Z"],
    ["2026-11", "2026-12-10T13:30:00.000Z"]
  ].flatMap(([period, scheduledAt]) => [
    blsFallbackSeed({ key: "us_cpi", title: "Consumer Price Index (CPI)", category: "inflation", period, scheduledAt }),
    blsFallbackSeed({ key: "us_core_cpi", title: "Core Consumer Price Index (Core CPI)", category: "inflation", period, scheduledAt })
  ]),
  ...[
    ["2026-07", "2026-08-13T12:30:00.000Z"],
    ["2026-08", "2026-09-10T12:30:00.000Z"],
    ["2026-09", "2026-10-15T12:30:00.000Z"],
    ["2026-10", "2026-11-13T13:30:00.000Z"],
    ["2026-11", "2026-12-15T13:30:00.000Z"]
  ].map(([period, scheduledAt]) =>
    blsFallbackSeed({ key: "us_ppi", title: "Producer Price Index (PPI)", category: "inflation", period, scheduledAt })
  ),
  ...[
    ["2026-07", "2026-08-07T12:30:00.000Z"],
    ["2026-08", "2026-09-04T12:30:00.000Z"],
    ["2026-09", "2026-10-02T12:30:00.000Z"],
    ["2026-10", "2026-11-06T13:30:00.000Z"],
    ["2026-11", "2026-12-04T13:30:00.000Z"]
  ].flatMap(([period, scheduledAt]) => [
    blsFallbackSeed({ key: "us_nonfarm_payrolls", title: "Nonfarm Payrolls", category: "labor", period, scheduledAt }),
    blsFallbackSeed({ key: "us_unemployment_rate", title: "Unemployment Rate", category: "labor", period, scheduledAt })
  ])
];

export function blsReferencePeriodFromScheduledAt(scheduledAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date(scheduledAt));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function curatedBlsFallbackEvents(params: { from: string; to: string; fetchedAt?: string }): EconomicEvent[] {
  const from = new Date(params.from).getTime();
  const to = new Date(params.to).getTime();
  const fetchedAt = params.fetchedAt ?? new Date().toISOString();
  return BLS_FALLBACK_SEEDS
    .filter((seed) => {
      const scheduled = new Date(seed.scheduledAt).getTime();
      return scheduled >= from && scheduled <= to;
    })
    .map((seed) => ({
      ...seed,
      id: stableHash(seed.sourceKey).slice(0, 40),
      provider: "official",
      status: "scheduled" as const,
      fetchedAt
    }))
    .map(({ sourceKey: _sourceKey, ...event }) => event);
}

function weeklyInitialClaimsSeeds(from: Date, to: Date): CuratedSeed[] {
  const seeds: CuratedSeed[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));
  while (cursor <= last) {
    if (cursor.getUTCDay() === 4) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const day = cursor.getUTCDate();
      const occurrence = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      seeds.push(usReleaseSeed({
        key: "us_initial_jobless_claims",
        title: "Initial Jobless Claims",
        category: "labor",
        period: occurrence,
        scheduledAt: zonedLocalTimeToUtc({ year, month, day, hour: 8, minute: 30 }, "America/New_York").toISOString(),
        sourceName: "U.S. Department of Labor",
        sourceUrl: DOL_SOURCE,
        importance: "medium"
      }));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return seeds;
}

function parseExtraSeeds(): CuratedSeed[] {
  const raw = String(process.env.ECONOMIC_CURATED_SCHEDULE_JSON ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CuratedSeed => Boolean(
      entry
      && typeof entry === "object"
      && typeof entry.sourceKey === "string"
      && typeof entry.sourceName === "string"
      && typeof entry.title === "string"
      && typeof entry.scheduledAt === "string"
      && Number.isFinite(new Date(entry.scheduledAt).getTime())
    ));
  } catch {
    return [];
  }
}

export function curatedEconomicEvents(params: { from: string; to: string; fetchedAt?: string }): EconomicEvent[] {
  const fromDate = new Date(params.from);
  const toDate = new Date(params.to);
  const from = fromDate.getTime();
  const to = toDate.getTime();
  const fetchedAt = params.fetchedAt ?? new Date().toISOString();
  return [...CURATED_SEEDS, ...weeklyInitialClaimsSeeds(fromDate, toDate), ...parseExtraSeeds()]
    .filter((seed) => {
      const scheduled = new Date(seed.scheduledAt).getTime();
      return scheduled >= from && scheduled <= to;
    })
    .map((seed) => ({
      ...seed,
      id: stableHash(seed.sourceKey).slice(0, 40),
      provider: "official",
      status: "scheduled" as const,
      fetchedAt
    }))
    .map(({ sourceKey: _sourceKey, ...event }) => event);
}

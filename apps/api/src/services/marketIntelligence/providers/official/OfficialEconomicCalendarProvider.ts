import type { EconomicCalendarProvider, EconomicEvent, FetchEconomicEventsInput } from "../../contracts/economicCalendar.js";
import type { ProviderHealth } from "../../contracts/health.js";
import type { ProviderResult, ProviderWarning } from "../../contracts/provider.js";
import { stableHash } from "../../normalization/index.js";
import { fetchBoundedFeed } from "../rss/security.js";
import {
  blsReferencePeriodFromScheduledAt,
  curatedBlsFallbackEvents,
  curatedEconomicEvents
} from "./curatedSchedules.js";
import { matchEconomicEventDefinitions } from "./eventDefinitions.js";
import { buildEurostatCalendarUrl, parseEurostatCalendarJson } from "./eurostat.js";
import { parseIcsCalendar } from "./ics.js";

const BLS_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const BLS_SOURCE_URL = "https://www.bls.gov/schedule/";

export class OfficialEconomicCalendarProvider implements EconomicCalendarProvider {
  readonly id = "official";
  private lastHealth: ProviderHealth = {
    providerId: this.id,
    state: "degraded",
    checkedAt: new Date(0).toISOString(),
    message: "Official calendar provider has not run yet."
  };

  constructor(private readonly fetcher: typeof fetchBoundedFeed = fetchBoundedFeed) {}

  async fetchEvents(input: FetchEconomicEventsInput): Promise<ProviderResult<EconomicEvent[]>> {
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();
    const warnings: ProviderWarning[] = [];
    let scheduled = curatedEconomicEvents({ from: input.from, to: input.to, fetchedAt });
    let blsSucceeded = false;
    let blsFallbackCount = 0;
    let eurostatSucceeded = false;
    const blsTask = async () => {
      const response = await this.fetcher({
        url: BLS_CALENDAR_URL,
        allowedHosts: ["www.bls.gov"],
        signal: input.signal,
        maxBytes: 2_000_000
      });
      const icsEvents = parseIcsCalendar(response.body);
      for (const raw of icsEvents) {
        const definitions = matchEconomicEventDefinitions(raw.summary)
          .filter((definition) => definition.scheduleStrategy === "bls_ics");
        for (const definition of definitions) {
          const period = blsReferencePeriodFromScheduledAt(raw.start);
          scheduled.push({
            id: stableHash(`bls|${definition.key}|${period}`).slice(0, 40),
            provider: this.id,
            sourceName: "U.S. Bureau of Labor Statistics",
            sourceUrl: raw.url || BLS_SOURCE_URL,
            country: definition.country,
            currency: definition.currency,
            category: definition.category,
            title: definition.title,
            scheduledAt: raw.start,
            importance: definition.defaultImportance,
            status: "scheduled",
            period,
            fetchedAt,
            originalTimezone: raw.timezone ?? definition.timezone,
            timeConfidence: raw.timeConfidence
          });
        }
      }
      blsSucceeded = true;
    };
    const eurostatTask = async () => {
      const response = await this.fetcher({
        url: buildEurostatCalendarUrl(input.from, input.to),
        allowedHosts: ["ec.europa.eu"],
        signal: input.signal,
        maxBytes: 3_000_000
      });
      scheduled.push(...parseEurostatCalendarJson(response.body, fetchedAt));
      eurostatSucceeded = true;
    };
    const sourceResults = await Promise.allSettled([blsTask(), eurostatTask()]);
    if (sourceResults[0].status === "rejected") {
      warnings.push({
        code: "official_bls_schedule_unavailable",
        message: String(sourceResults[0].reason),
        retryable: true,
        sourceId: "bls"
      });
      const fallbackEvents = curatedBlsFallbackEvents({ from: input.from, to: input.to, fetchedAt });
      blsFallbackCount = fallbackEvents.length;
      scheduled.push(...fallbackEvents);
    }
    if (sourceResults[1].status === "rejected") {
      warnings.push({
        code: "official_eurostat_schedule_unavailable",
        message: String(sourceResults[1].reason),
        retryable: true,
        sourceId: "eurostat"
      });
    }

    const currencies = new Set((input.currencies ?? []).map((entry) => entry.toUpperCase()));
    const byId = new Map<string, EconomicEvent>();
    for (const event of scheduled) {
      if (currencies.size > 0 && event.currency && !currencies.has(event.currency)) continue;
      const ts = new Date(event.scheduledAt).getTime();
      if (ts < new Date(input.from).getTime() || ts > new Date(input.to).getTime()) continue;
      byId.set(event.id, event);
    }
    scheduled = [...byId.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const blsCoverageAvailable = blsSucceeded || blsFallbackCount > 0;
    const degraded = !blsCoverageAvailable || !eurostatSucceeded;
    this.lastHealth = {
      providerId: this.id,
      state: scheduled.length === 0 && degraded ? "unavailable" : degraded ? "degraded" : "healthy",
      checkedAt: fetchedAt,
      ...(scheduled.length > 0 ? { lastSuccessAt: fetchedAt } : {}),
      latencyMs: Date.now() - startedAt,
      message: `${scheduled.length} official or curated events available; BLS ${blsSucceeded ? "healthy" : blsFallbackCount > 0 ? `curated fallback active (${blsFallbackCount} events)` : "unavailable"}, Eurostat ${eurostatSucceeded ? "healthy" : "unavailable"}.`
    };
    return {
      providerId: this.id,
      data: scheduled,
      warnings,
      latencyMs: Date.now() - startedAt,
      fetchedAt,
      degraded
    };
  }

  async health(): Promise<ProviderHealth> {
    return { ...this.lastHealth };
  }
}

export function mergeEconomicScheduleAndReleases(
  schedule: EconomicEvent[],
  releases: Array<{ eventId: string; actual?: string | number; previous?: string | number; revision?: number; releasedAt: string }>
): EconomicEvent[] {
  const releaseByEvent = new Map(releases.map((release) => [release.eventId, release]));
  return schedule.map((event) => {
    const release = releaseByEvent.get(event.id);
    if (!release) return event;
    return {
      ...event,
      status: typeof release.revision === "number" && release.revision > 0 ? "revised" : "released",
      releasedAt: release.releasedAt,
      ...(release.actual !== undefined ? { actual: release.actual } : {}),
      ...(release.previous !== undefined ? { previous: release.previous } : {}),
      ...(release.revision !== undefined ? { revision: release.revision } : {})
    };
  });
}

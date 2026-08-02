import type { EconomicCalendarProvider, EconomicEvent, FetchEconomicEventsInput } from "../../contracts/economicCalendar.js";
import type { ProviderHealth } from "../../contracts/health.js";
import type { ProviderResult } from "../../contracts/provider.js";
import { stableHash } from "../../normalization/index.js";
import { fetchFmpEconomicEvents } from "../../../economicCalendar/providers/fmp.js";
import { resolveLegacyFmpApiKey } from "./key.js";

export class LegacyFmpEconomicCalendarProvider implements EconomicCalendarProvider {
  readonly id = "legacy_fmp";
  private lastHealth: ProviderHealth = {
    providerId: this.id,
    state: "disabled",
    checkedAt: new Date(0).toISOString(),
    message: "Legacy FMP calendar adapter has not run."
  };

  constructor(private readonly db: any) {}

  async fetchEvents(input: FetchEconomicEventsInput): Promise<ProviderResult<EconomicEvent[]>> {
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();
    const apiKey = await resolveLegacyFmpApiKey(this.db);
    if (!apiKey) {
      this.lastHealth = {
        providerId: this.id,
        state: "disabled",
        checkedAt: fetchedAt,
        message: "No FMP API key configured."
      };
      return { providerId: this.id, data: [], warnings: [], latencyMs: 0, fetchedAt, degraded: false };
    }
    try {
      const rows = await fetchFmpEconomicEvents({
        apiKey,
        baseUrl: process.env.FMP_BASE_URL,
        from: input.from.slice(0, 10),
        to: input.to.slice(0, 10),
        currencies: input.currencies,
        signal: input.signal
      });
      const data = rows.map((row): EconomicEvent => ({
        id: stableHash(`legacy_fmp|${row.sourceId}`).slice(0, 40),
        provider: this.id,
        sourceName: "Financial Modeling Prep",
        country: row.country,
        currency: row.currency,
        category: "economic_release",
        title: row.title,
        scheduledAt: row.ts.toISOString(),
        importance: row.impact,
        status: row.actual === null ? "scheduled" : "released",
        ...(row.actual !== null ? { actual: row.actual } : {}),
        ...(row.forecast !== null ? { forecast: row.forecast } : {}),
        ...(row.previous !== null ? { previous: row.previous } : {}),
        fetchedAt,
        timeConfidence: "exact"
      }));
      this.lastHealth = {
        providerId: this.id,
        state: "healthy",
        checkedAt: fetchedAt,
        lastSuccessAt: fetchedAt,
        latencyMs: Date.now() - startedAt,
        message: `${data.length} legacy FMP calendar events fetched.`
      };
      return { providerId: this.id, data, warnings: [], latencyMs: Date.now() - startedAt, fetchedAt, degraded: false };
    } catch (error) {
      this.lastHealth = {
        providerId: this.id,
        state: "unavailable",
        checkedAt: fetchedAt,
        latencyMs: Date.now() - startedAt,
        message: String(error)
      };
      return {
        providerId: this.id,
        data: [],
        warnings: [{ code: "legacy_fmp_calendar_unavailable", message: String(error), retryable: true }],
        latencyMs: Date.now() - startedAt,
        fetchedAt,
        degraded: true
      };
    }
  }

  async health(): Promise<ProviderHealth> {
    return { ...this.lastHealth };
  }
}

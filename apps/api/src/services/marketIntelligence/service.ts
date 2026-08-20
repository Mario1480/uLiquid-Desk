import { logger } from "../../logger.js";
import type { EconomicCalendarProvider, EconomicEvent } from "./contracts/economicCalendar.js";
import type { NewsCategory, NewsItem, NewsProvider } from "./contracts/news.js";
import type { AggregatedResponseMeta, ProviderState } from "./contracts/provider.js";
import { groundedMarketSummarySchema, type GroundedMarketSummary } from "./contracts/summary.js";
import { ProviderCircuitBreaker, StaleWhileRevalidateCache } from "./cache.js";
import { normalizedNewsDedupKey } from "./normalization/index.js";
import { createMarketProviderRegistries } from "./registry/index.js";
import { RssNewsProvider } from "./providers/rss/RssNewsProvider.js";
import {
  buildMarketSummarySourceClusterHash,
  generateGroundedMarketSummary,
  MARKET_SUMMARY_PROMPT_VERSION,
  resolveMarketSummaryModel
} from "./summary.js";

type ProviderOverride = {
  enabled?: boolean;
  usageStatus?: "pending_review" | "approved" | "blocked";
  termsReviewedAt?: string;
  fetchIntervalMinutes?: number;
};

type ProviderOverrides = Record<string, ProviderOverride>;

const PROVIDER_SETTINGS_KEY = "market_intelligence.providers.v1";
const NEWS_QUERY_CACHE_TTL_MS = Math.max(30, Number(process.env.NEWS_QUERY_CACHE_TTL_SEC ?? "60")) * 1000;
const NEWS_STALE_TTL_MS = Math.max(NEWS_QUERY_CACHE_TTL_MS / 1000, Number(process.env.NEWS_STALE_TTL_SEC ?? "1800")) * 1000;
const NEWS_STALE_AFTER_SEC = Math.max(60, Number(process.env.NEWS_STALE_AFTER_SEC ?? "1800"));
const NEWS_RETENTION_DAYS = Math.max(1, Math.trunc(Number(process.env.NEWS_RETENTION_DAYS ?? "90")));
const SUMMARY_CACHE_TTL_MS = Math.max(60, Number(process.env.AI_MARKET_SUMMARY_CACHE_TTL_SEC ?? "900")) * 1000;
const serviceByDb = new WeakMap<object, MarketIntelligenceService>();

function asDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function toNewsItem(row: any): NewsItem {
  return {
    id: String(row.sourceId ?? row.id),
    provider: String(row.provider ?? "unknown"),
    sourceName: String(row.sourceName ?? "Unknown source"),
    sourceUrl: String(row.sourceUrl ?? row.canonicalUrl ?? ""),
    ...(row.canonicalUrl ? { canonicalUrl: String(row.canonicalUrl) } : {}),
    title: String(row.title ?? ""),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    publishedAt: asDate(row.publishedAt).toISOString(),
    fetchedAt: asDate(row.fetchedAt).toISOString(),
    ...(row.language ? { language: String(row.language) } : {}),
    symbols: asStringArray(row.symbols),
    categories: asStringArray(row.categories) as NewsCategory[],
    contentHash: String(row.contentHash ?? "")
  };
}

function toEconomicEvent(row: any): EconomicEvent {
  return {
    id: String(row.sourceId ?? row.id),
    provider: String(row.source ?? "unknown"),
    sourceName: String(row.sourceName ?? row.source ?? "Unknown source"),
    ...(row.sourceUrl ? { sourceUrl: String(row.sourceUrl) } : {}),
    country: String(row.country ?? ""),
    ...(row.currency ? { currency: String(row.currency).toUpperCase() } : {}),
    category: String(row.category ?? "economic_release"),
    title: String(row.title ?? ""),
    scheduledAt: asDate(row.ts).toISOString(),
    importance: row.impact === "low" || row.impact === "medium" ? row.impact : "high",
    status: ["scheduled", "released", "revised", "cancelled"].includes(String(row.status))
      ? row.status
      : row.actual === null || row.actual === undefined
        ? "scheduled"
        : "released",
    ...(row.actual !== null && row.actual !== undefined ? { actual: row.actual } : {}),
    ...(row.forecast !== null && row.forecast !== undefined ? { forecast: row.forecast } : {}),
    ...(row.previous !== null && row.previous !== undefined ? { previous: row.previous } : {}),
    ...(row.unit ? { unit: String(row.unit) } : {}),
    ...(row.period ? { period: String(row.period) } : {}),
    fetchedAt: asDate(row.fetchedAt ?? row.updatedAt ?? row.createdAt).toISOString(),
    ...(row.originalTimezone ? { originalTimezone: String(row.originalTimezone) } : {}),
    ...(row.timeConfidence ? { timeConfidence: row.timeConfidence } : {}),
    ...(Number.isFinite(Number(row.revision)) ? { revision: Number(row.revision) } : {})
  };
}

export class MarketIntelligenceService {
  private readonly registries;
  private readonly circuit = new ProviderCircuitBreaker(3, 60_000);
  private readonly cache = new StaleWhileRevalidateCache();
  private newsMemory: NewsItem[] = [];
  private eventMemory: EconomicEvent[] = [];
  private providerStates = new Map<string, ProviderState>();

  constructor(private readonly db: any) {
    this.registries = createMarketProviderRegistries(db);
    for (const missing of this.registries.configuredNews.missing) {
      this.recordMissingProvider(missing, "news");
    }
    for (const missing of this.registries.configuredEconomic.missing) {
      this.recordMissingProvider(missing, "economic_calendar");
    }
  }

  private recordMissingProvider(providerId: string, providerType: ProviderState["providerType"]): void {
    this.providerStates.set(`${providerType}:${providerId}`, {
      providerId,
      providerType,
      state: "unavailable",
      enabled: true,
      checkedAt: new Date().toISOString(),
      message: "Configured provider is not registered."
    });
  }

  private async loadOverrides(): Promise<ProviderOverrides> {
    try {
      const row = await this.db?.globalSetting?.findUnique?.({
        where: { key: PROVIDER_SETTINGS_KEY },
        select: { value: true }
      });
      return row?.value && typeof row.value === "object" && !Array.isArray(row.value)
        ? row.value as ProviderOverrides
        : {};
    } catch {
      return {};
    }
  }

  private async isProviderEnabled(providerId: string): Promise<boolean> {
    const overrides = await this.loadOverrides();
    const override = overrides[providerId];
    return override?.enabled !== false && override?.usageStatus !== "blocked";
  }

  async updateProviderSettings(providerId: string, patch: ProviderOverride): Promise<ProviderOverrides> {
    if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(providerId)) throw new Error("invalid_provider_id");
    const current = await this.loadOverrides();
    const next: ProviderOverrides = {
      ...current,
      [providerId]: {
        ...current[providerId],
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(patch.usageStatus ? { usageStatus: patch.usageStatus } : {}),
        ...(patch.termsReviewedAt ? { termsReviewedAt: patch.termsReviewedAt } : {}),
        ...(Number.isFinite(Number(patch.fetchIntervalMinutes))
          ? { fetchIntervalMinutes: Math.min(1440, Math.max(5, Math.trunc(Number(patch.fetchIntervalMinutes)))) }
          : {})
      }
    };
    await this.db.globalSetting.upsert({
      where: { key: PROVIDER_SETTINGS_KEY },
      update: { value: next },
      create: { key: PROVIDER_SETTINGS_KEY, value: next }
    });
    this.cache.clear();
    return next;
  }

  async refreshNews(): Promise<{ fetchedCount: number; storedCount: number; degraded: boolean; warnings: string[] }> {
    const providers: NewsProvider[] = [];
    for (const provider of this.registries.configuredNews.providers) {
      if (await this.isProviderEnabled(provider.id)) providers.push(provider);
      else {
        this.providerStates.set(`news:${provider.id}`, {
          providerId: provider.id,
          providerType: "news",
          state: "disabled",
          enabled: false,
          checkedAt: new Date().toISOString(),
          message: "Provider disabled by administrator."
        });
      }
    }
    const fetchProvider = async (provider: NewsProvider) => {
      if (provider instanceof RssNewsProvider) {
        provider.setSourceOverrides(await this.loadOverrides());
      }
      if (!this.circuit.canRequest(`news:${provider.id}`)) {
        return { provider, result: null, error: "provider_circuit_open" };
      }
      try {
        const result = await provider.fetchNews({ limit: 500 });
        if (result.data.length > 0 || !result.degraded) this.circuit.success(`news:${provider.id}`);
        else this.circuit.failure(`news:${provider.id}`);
        return { provider, result, error: null };
      } catch (error) {
        this.circuit.failure(`news:${provider.id}`);
        return { provider, result: null, error: String(error) };
      }
    };
    const primaryProviders = this.registries.fmpFallbackEnabled
      ? providers.filter((provider) => provider.id !== "legacy_fmp")
      : providers;
    const results = await Promise.all(primaryProviders.map(fetchProvider));
    if (this.registries.fmpFallbackEnabled) {
      const primaryHasData = results.some((entry) => (entry.result?.data.length ?? 0) > 0);
      const fallback = providers.find((provider) => provider.id === "legacy_fmp");
      if (!primaryHasData && fallback) results.push(await fetchProvider(fallback));
    }
    const warnings: string[] = [];
    const byKey = new Map<string, NewsItem>();
    let degraded = false;
    for (const entry of results) {
      if (!entry.result) {
        degraded = true;
        warnings.push(`${entry.provider.id}: ${entry.error}`);
        this.providerStates.set(`news:${entry.provider.id}`, {
          providerId: entry.provider.id,
          providerType: "news",
          state: "unavailable",
          enabled: true,
          checkedAt: new Date().toISOString(),
          message: entry.error ?? "Provider unavailable.",
          circuitState: this.circuit.state(`news:${entry.provider.id}`)
        });
        continue;
      }
      degraded ||= entry.result.degraded;
      warnings.push(...entry.result.warnings.map((warning) => `${entry.provider.id}: ${warning.message}`));
      for (const item of entry.result.data) {
        const key = normalizedNewsDedupKey({
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          sourceName: item.sourceName,
          publishedAt: item.publishedAt
        });
        if (!byKey.has(key)) byKey.set(key, item);
      }
      const health = await entry.provider.health();
      this.providerStates.set(`news:${entry.provider.id}`, {
        ...health,
        providerId: entry.provider.id,
        providerType: "news",
        enabled: true,
        itemCount: entry.result.data.length,
        licenseStatus: entry.provider.id === "rss" ? "approved" : "pending_review",
        ...(entry.provider.id === "rss" ? { termsReviewedAt: "2026-08-02" } : {}),
        circuitState: this.circuit.state(`news:${entry.provider.id}`)
      });
      if (entry.provider instanceof RssNewsProvider) {
        for (const state of entry.provider.sourceStates()) {
          this.providerStates.set(`news:${state.providerId}`, {
            providerId: state.providerId,
            providerType: "news",
            state: state.state,
            enabled: state.source.enabled,
            checkedAt: state.checkedAt,
            ...(state.lastSuccessAt ? { lastSuccessAt: state.lastSuccessAt } : {}),
            ...(state.latencyMs !== undefined ? { latencyMs: state.latencyMs } : {}),
            ...(state.message ? { message: state.message } : {}),
            itemCount: state.itemCount,
            licenseStatus: state.source.usageStatus,
            termsReviewedAt: state.source.termsReviewedAt
          });
        }
      }
    }
    const items = [...byKey.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    let storedCount = 0;
    for (const item of items) {
      try {
        if (typeof this.db?.marketNewsItem?.upsert === "function") {
          await this.db.marketNewsItem.upsert({
            where: { provider_sourceId: { provider: item.provider, sourceId: item.id } },
            create: {
              sourceId: item.id,
              provider: item.provider,
              sourceName: item.sourceName,
              sourceUrl: item.sourceUrl,
              canonicalUrl: item.canonicalUrl ?? null,
              title: item.title,
              summary: item.summary ?? null,
              publishedAt: new Date(item.publishedAt),
              fetchedAt: new Date(item.fetchedAt),
              language: item.language ?? null,
              symbols: item.symbols,
              categories: item.categories,
              contentHash: item.contentHash,
              licenseStatus: item.provider === "rss" ? "approved" : "pending_review",
              termsReviewedAt: item.provider === "rss" ? new Date("2026-08-02T00:00:00.000Z") : null,
              retentionUntil: new Date(new Date(item.publishedAt).getTime() + NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
            },
            update: {
              sourceName: item.sourceName,
              sourceUrl: item.sourceUrl,
              canonicalUrl: item.canonicalUrl ?? null,
              title: item.title,
              summary: item.summary ?? null,
              publishedAt: new Date(item.publishedAt),
              fetchedAt: new Date(item.fetchedAt),
              language: item.language ?? null,
              symbols: item.symbols,
              categories: item.categories,
              contentHash: item.contentHash,
              retentionUntil: new Date(new Date(item.publishedAt).getTime() + NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
            }
          });
        }
        storedCount += 1;
      } catch (error) {
        degraded = true;
        warnings.push(`news persistence: ${String(error)}`);
      }
    }
    if (items.length > 0) this.newsMemory = items;
    try {
      await this.db?.marketNewsItem?.deleteMany?.({ where: { retentionUntil: { lt: new Date() } } });
      await this.db?.marketSummaryCache?.deleteMany?.({ where: { expiresAt: { lt: new Date() } } });
    } catch (error) {
      degraded = true;
      warnings.push(`retention cleanup: ${String(error)}`);
    }
    this.cache.clear();
    return { fetchedCount: items.length, storedCount, degraded, warnings: [...new Set(warnings)] };
  }

  async refreshEconomicEvents(params: { from?: Date; to?: Date } = {}): Promise<{ fetchedCount: number; storedCount: number; degraded: boolean; warnings: string[] }> {
    const now = new Date();
    const from = params.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const to = params.to ?? new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000);
    const providers: EconomicCalendarProvider[] = [];
    for (const provider of this.registries.configuredEconomic.providers) {
      if (await this.isProviderEnabled(provider.id)) providers.push(provider);
    }
    const fetchProvider = async (provider: EconomicCalendarProvider) => {
      if (!this.circuit.canRequest(`economic_calendar:${provider.id}`)) {
        return { provider, result: null, error: "provider_circuit_open" };
      }
      try {
        const result = await provider.fetchEvents({ from: from.toISOString(), to: to.toISOString() });
        if (result.data.length > 0 || !result.degraded) this.circuit.success(`economic_calendar:${provider.id}`);
        else this.circuit.failure(`economic_calendar:${provider.id}`);
        return { provider, result, error: null };
      } catch (error) {
        this.circuit.failure(`economic_calendar:${provider.id}`);
        return { provider, result: null, error: String(error) };
      }
    };
    const primaryProviders = this.registries.fmpFallbackEnabled
      ? providers.filter((provider) => provider.id !== "legacy_fmp")
      : providers;
    const results = await Promise.all(primaryProviders.map(fetchProvider));
    if (this.registries.fmpFallbackEnabled) {
      const primaryHasData = results.some((entry) => (entry.result?.data.length ?? 0) > 0);
      const fallback = providers.find((provider) => provider.id === "legacy_fmp");
      if (!primaryHasData && fallback) results.push(await fetchProvider(fallback));
    }
    const warnings: string[] = [];
    const byId = new Map<string, EconomicEvent>();
    let degraded = false;
    for (const entry of results) {
      if (!entry.result) {
        degraded = true;
        warnings.push(`${entry.provider.id}: ${entry.error}`);
        continue;
      }
      degraded ||= entry.result.degraded;
      warnings.push(...entry.result.warnings.map((warning) => `${entry.provider.id}: ${warning.message}`));
      for (const event of entry.result.data) byId.set(`${event.provider}:${event.id}`, event);
      const health = await entry.provider.health();
      this.providerStates.set(`economic_calendar:${entry.provider.id}`, {
        ...health,
        providerId: entry.provider.id,
        providerType: "economic_calendar",
        enabled: true,
        itemCount: entry.result.data.length,
        licenseStatus: entry.provider.id === "official" ? "approved" : "pending_review",
        ...(entry.provider.id === "official" ? { termsReviewedAt: "2026-08-02" } : {}),
        circuitState: this.circuit.state(`economic_calendar:${entry.provider.id}`)
      });
    }
    const events = [...byId.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    let storedCount = 0;
    for (const event of events) {
      try {
        if (typeof this.db?.economicEvent?.upsert === "function") {
          const storedEvent = await this.db.economicEvent.upsert({
            where: { source_sourceId: { source: event.provider, sourceId: event.id } },
            create: {
              sourceId: event.id,
              ts: new Date(event.scheduledAt),
              country: event.country,
              currency: event.currency ?? "",
              title: event.title,
              impact: event.importance,
              forecast: typeof event.forecast === "number" ? event.forecast : null,
              previous: typeof event.previous === "number" ? event.previous : null,
              actual: typeof event.actual === "number" ? event.actual : null,
              source: event.provider,
              sourceName: event.sourceName,
              sourceUrl: event.sourceUrl ?? null,
              category: event.category,
              status: event.status,
              unit: event.unit ?? null,
              period: event.period ?? null,
              fetchedAt: new Date(event.fetchedAt),
              originalTimezone: event.originalTimezone ?? null,
              timeConfidence: event.timeConfidence ?? null,
              revision: event.revision ?? 0
            },
            update: {
              ts: new Date(event.scheduledAt),
              country: event.country,
              currency: event.currency ?? "",
              title: event.title,
              impact: event.importance,
              forecast: typeof event.forecast === "number" ? event.forecast : null,
              previous: typeof event.previous === "number" ? event.previous : null,
              actual: typeof event.actual === "number" ? event.actual : null,
              sourceName: event.sourceName,
              sourceUrl: event.sourceUrl ?? null,
              category: event.category,
              status: event.status,
              unit: event.unit ?? null,
              period: event.period ?? null,
              fetchedAt: new Date(event.fetchedAt),
              originalTimezone: event.originalTimezone ?? null,
              timeConfidence: event.timeConfidence ?? null,
              revision: event.revision ?? 0
            }
          });
          if (
            storedEvent?.id
            && typeof this.db?.economicEventRevision?.upsert === "function"
            && (event.status === "released" || event.status === "revised")
          ) {
            const revision = event.revision ?? 0;
            await this.db.economicEventRevision.upsert({
              where: { economicEventId_revision: { economicEventId: storedEvent.id, revision } },
              create: {
                economicEventId: storedEvent.id,
                revision,
                actual: typeof event.actual === "number" ? event.actual : null,
                previous: typeof event.previous === "number" ? event.previous : null,
                releasedAt: new Date(event.releasedAt ?? event.fetchedAt),
                sourceName: event.sourceName,
                sourceUrl: event.sourceUrl ?? null
              },
              update: {
                actual: typeof event.actual === "number" ? event.actual : null,
                previous: typeof event.previous === "number" ? event.previous : null,
                releasedAt: new Date(event.releasedAt ?? event.fetchedAt),
                sourceName: event.sourceName,
                sourceUrl: event.sourceUrl ?? null
              }
            });
          }
        }
        storedCount += 1;
      } catch (error) {
        degraded = true;
        warnings.push(`calendar persistence: ${String(error)}`);
      }
    }
    if (events.length > 0) this.eventMemory = events;
    this.cache.clear();
    return { fetchedCount: events.length, storedCount, degraded, warnings: [...new Set(warnings)] };
  }

  async getNews(input: {
    limit?: number;
    page?: number;
    cursor?: string;
    q?: string | null;
    symbols?: string[];
    categories?: string[];
    language?: string | null;
    publisher?: string | null;
    from?: string | null;
    to?: string | null;
  }): Promise<{ data: NewsItem[]; meta: AggregatedResponseMeta & { page: number; limit: number; nextCursor?: string; cache: "hit" | "miss" } }> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 20)));
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const key = JSON.stringify({ type: "news", ...input, limit, page });
    const cached = this.cache.get<{ data: NewsItem[]; meta: any }>(key);
    if (cached) {
      return { data: cached.value.data, meta: { ...cached.value.meta, cache: "hit", stale: cached.stale } };
    }
    let rows: NewsItem[] = [];
    try {
      if (typeof this.db?.marketNewsItem?.findMany === "function") {
        const dbRows = await this.db.marketNewsItem.findMany({
          orderBy: [{ publishedAt: "desc" }],
          take: 2000
        });
        rows = dbRows.map(toNewsItem);
      }
    } catch (error) {
      logger.warn("market_intelligence_news_read_failed", { reason: String(error) });
    }
    if (rows.length === 0) rows = [...this.newsMemory];
    const query = String(input.q ?? "").trim().toLowerCase();
    const symbols = new Set((input.symbols ?? []).map((entry) => entry.toUpperCase()));
    const categories = new Set((input.categories ?? []).map((entry) => entry.toLowerCase()));
    const fromMs = input.from ? new Date(input.from).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = input.to ? new Date(input.to).getTime() : Number.POSITIVE_INFINITY;
    const filtered = rows
      .filter((item) => !query || `${item.title} ${item.summary ?? ""} ${item.sourceName}`.toLowerCase().includes(query))
      .filter((item) => symbols.size === 0 || item.symbols.some((symbol) => symbols.has(symbol)))
      .filter((item) => categories.size === 0 || item.categories.some((category) => categories.has(category)))
      .filter((item) => !input.language || item.language === input.language)
      .filter((item) => !input.publisher || item.sourceName.toLowerCase().includes(input.publisher.toLowerCase()))
      .filter((item) => {
        const ts = new Date(item.publishedAt).getTime();
        return ts >= fromMs && ts <= toMs;
      });
    const cursorIndex = input.cursor ? filtered.findIndex((item) => item.id === input.cursor) + 1 : 0;
    const start = input.cursor ? Math.max(0, cursorIndex) : (page - 1) * limit;
    const data = filtered.slice(start, start + limit);
    const states = (await this.getProviderStates()).filter((state) => state.providerType === "news");
    const warnings = states.filter((state) => state.state === "degraded" || state.state === "unavailable").map((state) => `${state.providerId}: ${state.message ?? state.state}`);
    const meta = {
      generatedAt: new Date().toISOString(),
      providerStates: states,
      degraded: warnings.length > 0 || rows.length === 0,
      warnings,
      page,
      limit,
      ...(start + limit < filtered.length && data.length > 0 ? { nextCursor: data[data.length - 1].id } : {}),
      cache: "miss" as const
    };
    const result = { data, meta };
    this.cache.set(key, result, NEWS_QUERY_CACHE_TTL_MS, NEWS_STALE_TTL_MS);
    return result;
  }

  async getNewsItem(id: string): Promise<NewsItem | null> {
    const result = await this.getNews({ limit: 100, page: 1 });
    const memory = [...result.data, ...this.newsMemory].find((item) => item.id === id);
    if (memory) return memory;
    try {
      const row = await this.db?.marketNewsItem?.findUnique?.({ where: { id } });
      return row ? toNewsItem(row) : null;
    } catch {
      return null;
    }
  }

  async getEconomicEvents(input: {
    from: string;
    to: string;
    currencies?: string[];
    importance?: Array<"low" | "medium" | "high">;
    limit?: number;
  }): Promise<{ data: EconomicEvent[]; meta: AggregatedResponseMeta }> {
    const from = new Date(input.from);
    const to = new Date(input.to);
    let events: EconomicEvent[] = [];
    try {
      if (typeof this.db?.economicEvent?.findMany === "function") {
        const rows = await this.db.economicEvent.findMany({
          where: { ts: { gte: from, lte: to } },
          orderBy: [{ ts: "asc" }],
          take: Math.min(2000, Math.max(1, input.limit ?? 1000))
        });
        events = rows.map(toEconomicEvent);
      }
    } catch (error) {
      logger.warn("market_intelligence_calendar_read_failed", { reason: String(error) });
    }
    if (events.length === 0) {
      events = this.eventMemory.filter((event) => {
        const ts = new Date(event.scheduledAt).getTime();
        return ts >= from.getTime() && ts <= to.getTime();
      });
    }
    const currencies = new Set((input.currencies ?? []).map((entry) => entry.toUpperCase()));
    const importance = new Set(input.importance ?? []);
    const data = events
      .filter((event) => currencies.size === 0 || (event.currency && currencies.has(event.currency)))
      .filter((event) => importance.size === 0 || importance.has(event.importance))
      .slice(0, input.limit ?? 1000);
    const states = (await this.getProviderStates()).filter((state) => state.providerType === "economic_calendar");
    const warnings = states.filter((state) => state.state === "degraded" || state.state === "unavailable").map((state) => `${state.providerId}: ${state.message ?? state.state}`);
    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        providerStates: states,
        degraded: warnings.length > 0 || events.length === 0,
        warnings
      }
    };
  }

  async getMarketContext(input: { symbol?: string; horizon?: "intraday" | "24h" | "7d" }): Promise<{
    news: NewsItem[];
    events: EconomicEvent[];
    dataAgeSeconds: number | null;
    providerStates: ProviderState[];
    degraded: boolean;
    warnings: string[];
  }> {
    const now = new Date();
    const horizon = input.horizon ?? "24h";
    const horizonMs = horizon === "intraday" ? 12 * 60 * 60 * 1000 : horizon === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const [newsResult, events, states] = await Promise.all([
      this.getNews({ limit: 50, from: new Date(now.getTime() - horizonMs).toISOString(), to: now.toISOString() }),
      this.getEconomicEvents({
        from: now.toISOString(),
        to: new Date(now.getTime() + horizonMs).toISOString(),
        importance: ["high", "medium"],
        limit: 50
      }),
      this.getProviderStates()
    ]);
    const requestedSymbol = String(input.symbol ?? "").trim().toUpperCase();
    const news = requestedSymbol
      ? newsResult.data
          .filter((item) => item.symbols.includes(requestedSymbol) || item.categories.some((category) => (
            category === "macro" || category === "regulation" || category === "institutional" || category === "security_incident"
          )))
          .sort((a, b) => Number(b.symbols.includes(requestedSymbol)) - Number(a.symbols.includes(requestedSymbol)))
          .slice(0, 20)
      : newsResult.data.slice(0, 20);
    const fetchedTimes = news.map((item) => new Date(item.fetchedAt).getTime()).filter(Number.isFinite);
    const newest = fetchedTimes.length > 0 ? Math.max(...fetchedTimes) : null;
    const dataAgeSeconds = newest === null ? null : Math.max(0, Math.floor((now.getTime() - newest) / 1000));
    const stale = dataAgeSeconds !== null && dataAgeSeconds > NEWS_STALE_AFTER_SEC;
    const warnings = [
      ...newsResult.meta.warnings,
      ...events.meta.warnings,
      ...(stale ? [`News data is stale (${dataAgeSeconds}s old).`] : [])
    ];
    const providerStates = states.map((state) => state.providerType === "news" && dataAgeSeconds !== null
      ? {
          ...state,
          staleDataAgeSeconds: dataAgeSeconds,
          ...(stale && state.state === "healthy" ? { state: "degraded" as const } : {})
        }
      : state);
    return {
      news,
      events: events.data,
      dataAgeSeconds,
      providerStates,
      degraded: newsResult.meta.degraded || events.meta.degraded || stale,
      warnings: [...new Set(warnings)]
    };
  }

  async getPredictionContext(input: { symbol: string; horizon?: "intraday" | "24h" | "7d" }): Promise<{
    schemaVersion: "market-intelligence-context/v1";
    symbol: string;
    generatedAt: string;
    dataAgeSeconds: number | null;
    degraded: boolean;
    warnings: string[];
    facts: Array<{
      id: string;
      title: string;
      sourceName: string;
      sourceUrl: string;
      publishedAt: string;
      categories: string[];
    }>;
    upcomingHighImpactEvents: Array<{
      id: string;
      title: string;
      scheduledAt: string;
      currency?: string;
      sourceName: string;
      sourceUrl?: string;
      timeConfidence?: "exact" | "estimated" | "date_only";
    }>;
    providerStates: Array<{ providerId: string; state: string; checkedAt: string }>;
  }> {
    const context = await this.getMarketContext({
      symbol: input.symbol,
      horizon: input.horizon ?? "24h"
    });
    return {
      schemaVersion: "market-intelligence-context/v1",
      symbol: input.symbol.toUpperCase(),
      generatedAt: new Date().toISOString(),
      dataAgeSeconds: context.dataAgeSeconds,
      degraded: context.degraded,
      warnings: context.warnings.slice(0, 5),
      facts: context.news.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        sourceName: item.sourceName,
        sourceUrl: item.canonicalUrl ?? item.sourceUrl,
        publishedAt: item.publishedAt,
        categories: item.categories
      })),
      upcomingHighImpactEvents: context.events.filter((event) => event.importance === "high").slice(0, 5).map((event) => ({
        id: event.id,
        title: event.title,
        scheduledAt: event.scheduledAt,
        ...(event.currency ? { currency: event.currency } : {}),
        sourceName: event.sourceName,
        ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
        ...(event.timeConfidence ? { timeConfidence: event.timeConfidence } : {})
      })),
      providerStates: context.providerStates.map((state) => ({
        providerId: state.providerId,
        state: state.state,
        checkedAt: state.checkedAt
      }))
    };
  }

  async getDailySummary(input: { symbol?: string; horizon?: "intraday" | "24h" | "7d"; billingUserId?: string | null }): Promise<GroundedMarketSummary> {
    const context = await this.getMarketContext(input);
    const horizon = input.horizon ?? "24h";
    const sourceClusterHash = buildMarketSummarySourceClusterHash({
      news: context.news,
      events: context.events,
      horizon,
      degraded: context.degraded,
      warnings: context.warnings
    });
    const requestedModel = resolveMarketSummaryModel();
    try {
      const cached = await this.db?.marketSummaryCache?.findFirst?.({
        where: {
          sourceClusterHash,
          promptVersion: MARKET_SUMMARY_PROMPT_VERSION,
          model: requestedModel,
          horizon,
          expiresAt: { gt: new Date() }
        },
        orderBy: { generatedAt: "desc" }
      });
      const parsed = groundedMarketSummarySchema.safeParse(cached?.payload);
      if (parsed.success) return { ...parsed.data, meta: { ...parsed.data.meta, cached: true } };
    } catch (error) {
      logger.warn("market_intelligence_summary_cache_read_failed", { reason: String(error) });
    }
    const generated = await generateGroundedMarketSummary({
      news: context.news,
      events: context.events,
      horizon,
      degraded: context.degraded,
      warnings: context.warnings,
      billingUserId: input.billingUserId
    });
    try {
      await this.db?.marketSummaryCache?.upsert?.({
        where: {
          sourceClusterHash_promptVersion_model_horizon: {
            sourceClusterHash: generated.meta.sourceClusterHash,
            promptVersion: generated.meta.promptVersion,
            model: generated.meta.model,
            horizon
          }
        },
        create: {
          sourceClusterHash: generated.meta.sourceClusterHash,
          promptVersion: generated.meta.promptVersion,
          model: generated.meta.model,
          horizon,
          payload: generated,
          generatedAt: new Date(generated.summary.generatedAt),
          expiresAt: new Date(Date.now() + SUMMARY_CACHE_TTL_MS)
        },
        update: {
          payload: generated,
          generatedAt: new Date(generated.summary.generatedAt),
          expiresAt: new Date(Date.now() + SUMMARY_CACHE_TTL_MS)
        }
      });
    } catch (error) {
      logger.warn("market_intelligence_summary_cache_write_failed", { reason: String(error) });
    }
    return generated;
  }

  async getProviderStates(): Promise<ProviderState[]> {
    const overrides = await this.loadOverrides();
    return [...this.providerStates.values()]
      .map((state) => ({
        ...state,
        ...(overrides[state.providerId]?.enabled === false ? { state: "disabled" as const, enabled: false } : {}),
        ...(overrides[state.providerId]?.usageStatus ? { licenseStatus: overrides[state.providerId].usageStatus } : {}),
        ...(overrides[state.providerId]?.termsReviewedAt ? { termsReviewedAt: overrides[state.providerId].termsReviewedAt } : {})
      }))
      .sort((a, b) => `${a.providerType}:${a.providerId}`.localeCompare(`${b.providerType}:${b.providerId}`));
  }
}

export function getMarketIntelligenceService(db: any): MarketIntelligenceService {
  if (!db || (typeof db !== "object" && typeof db !== "function")) return new MarketIntelligenceService(db);
  const key = db as object;
  const existing = serviceByDb.get(key);
  if (existing) return existing;
  const created = new MarketIntelligenceService(db);
  serviceByDb.set(key, created);
  return created;
}

import type { EconomicCalendarProvider } from "../contracts/economicCalendar.js";
import type { NewsProvider } from "../contracts/news.js";
import { LegacyFmpEconomicCalendarProvider } from "../providers/legacyFmp/LegacyFmpEconomicCalendarProvider.js";
import { LegacyFmpNewsProvider } from "../providers/legacyFmp/LegacyFmpNewsProvider.js";
import { OfficialEconomicCalendarProvider } from "../providers/official/OfficialEconomicCalendarProvider.js";
import { RssNewsProvider } from "../providers/rss/RssNewsProvider.js";

export function envFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return fallback;
}

export function parseProviderIds(value: string | undefined, fallback: string[]): string[] {
  const parsed = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9][a-z0-9_-]{0,80}$/.test(entry));
  return [...new Set(parsed.length > 0 ? parsed : fallback)];
}

export class ProviderRegistry<T extends { readonly id: string }> {
  private readonly providers = new Map<string, T>();

  constructor(providers: T[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: T): void {
    if (this.providers.has(provider.id)) throw new Error(`provider_duplicate:${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  get(id: string): T | undefined {
    return this.providers.get(id);
  }

  resolve(ids: string[]): { providers: T[]; missing: string[] } {
    const providers: T[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const provider = this.providers.get(id);
      if (provider) providers.push(provider);
      else missing.push(id);
    }
    return { providers, missing };
  }

  all(): T[] {
    return [...this.providers.values()];
  }
}

export function createMarketProviderRegistries(db: any) {
  const fmpEnabled = envFlag(process.env.FMP_LEGACY_ENABLED, false);
  const fmpFallbackEnabled = fmpEnabled && envFlag(process.env.FMP_LEGACY_FALLBACK_ENABLED, false);
  const newsIds = parseProviderIds(process.env.NEWS_PROVIDERS, ["rss"]);
  const calendarIds = parseProviderIds(process.env.ECONOMIC_CALENDAR_PROVIDERS, ["official"]);
  if (!envFlag(process.env.RSS_NEWS_ENABLED, true)) {
    const index = newsIds.indexOf("rss");
    if (index >= 0) newsIds.splice(index, 1);
  }
  if (!envFlag(process.env.OFFICIAL_ECONOMIC_CALENDAR_ENABLED, true)) {
    const index = calendarIds.indexOf("official");
    if (index >= 0) calendarIds.splice(index, 1);
  }
  if (!fmpEnabled) {
    for (const ids of [newsIds, calendarIds]) {
      const index = ids.indexOf("legacy_fmp");
      if (index >= 0) ids.splice(index, 1);
    }
  } else if (fmpFallbackEnabled) {
    if (!newsIds.includes("legacy_fmp")) newsIds.push("legacy_fmp");
    if (!calendarIds.includes("legacy_fmp")) calendarIds.push("legacy_fmp");
  }
  const newsRegistry = new ProviderRegistry<NewsProvider>([
    new RssNewsProvider(),
    new LegacyFmpNewsProvider(db)
  ]);
  const economicRegistry = new ProviderRegistry<EconomicCalendarProvider>([
    new OfficialEconomicCalendarProvider(),
    new LegacyFmpEconomicCalendarProvider(db)
  ]);
  return {
    news: newsRegistry,
    economic: economicRegistry,
    configuredNews: newsRegistry.resolve(newsIds),
    configuredEconomic: economicRegistry.resolve(calendarIds),
    fmpFallbackEnabled
  };
}

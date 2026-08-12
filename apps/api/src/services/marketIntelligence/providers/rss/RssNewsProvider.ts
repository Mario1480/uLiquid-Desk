import type { ProviderHealth } from "../../contracts/health.js";
import type { FetchNewsInput, NewsItem, NewsProvider } from "../../contracts/news.js";
import type { ProviderResult, ProviderWarning } from "../../contracts/provider.js";
import {
  canonicalizeUrl,
  classifyNews,
  detectSymbols,
  normalizedNewsDedupKey,
  stableHash
} from "../../normalization/index.js";
import { parseRssOrAtom } from "./parser.js";
import { fetchBoundedFeed } from "./security.js";
import { activeRssSources, type RssSourceConfig } from "./sourceRegistry.js";

type SourceHealth = ProviderHealth & { itemCount?: number };

export class RssNewsProvider implements NewsProvider {
  readonly id = "rss";
  private readonly sourceHealth = new Map<string, SourceHealth>();
  private sourceOverrides: Record<string, { enabled?: boolean; usageStatus?: "pending_review" | "approved" | "blocked"; termsReviewedAt?: string }> = {};
  private lastHealth: ProviderHealth = {
    providerId: this.id,
    state: "disabled",
    checkedAt: new Date(0).toISOString(),
    message: "RSS provider has not run yet."
  };

  constructor(
    private readonly sources: RssSourceConfig[] = activeRssSources(),
    private readonly fetcher: typeof fetchBoundedFeed = fetchBoundedFeed
  ) {}

  setSourceOverrides(overrides: Record<string, { enabled?: boolean; usageStatus?: "pending_review" | "approved" | "blocked"; termsReviewedAt?: string }>): void {
    this.sourceOverrides = overrides;
  }

  private effectiveSource(source: RssSourceConfig): RssSourceConfig {
    const override = this.sourceOverrides[source.id];
    return {
      ...source,
      ...(typeof override?.enabled === "boolean" ? { enabled: override.enabled } : {}),
      ...(override?.usageStatus ? { usageStatus: override.usageStatus } : {}),
      ...(override?.termsReviewedAt ? { termsReviewedAt: override.termsReviewedAt } : {})
    };
  }

  async fetchNews(input: FetchNewsInput): Promise<ProviderResult<NewsItem[]>> {
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();
    const sources = this.sources
      .map((source) => this.effectiveSource(source))
      .filter((source) => source.enabled && source.usageStatus !== "blocked")
      .filter((source) => process.env.NODE_ENV !== "production" || source.usageStatus === "approved");
    if (sources.length === 0) {
      this.lastHealth = {
        providerId: this.id,
        state: "disabled",
        checkedAt: fetchedAt,
        message: "No approved RSS sources are enabled."
      };
      return { providerId: this.id, data: [], warnings: [], latencyMs: 0, fetchedAt, degraded: false };
    }
    const perSourceLimit = Math.min(
      100,
      Math.max(20, Math.ceil((input.limit ?? 200) / sources.length))
    );

    const settled = await Promise.allSettled(sources.map(async (source) => {
      const sourceStartedAt = Date.now();
      const feedHost = new URL(source.feedUrl).hostname;
      const homepageHost = new URL(source.homepageUrl).hostname;
      try {
        const response = await this.fetcher({
          url: source.feedUrl,
          allowedHosts: [...new Set([feedHost, homepageHost])],
          signal: input.signal
        });
        const parsed = parseRssOrAtom(response.body, perSourceLimit);
        const items = parsed.map((item): NewsItem => {
          const canonicalUrl = canonicalizeUrl(item.url) ?? item.url;
          const combinedText = `${item.title} ${item.summary ?? ""}`;
          const dedupKey = normalizedNewsDedupKey({
            canonicalUrl,
            title: item.title,
            sourceName: source.name,
            publishedAt: item.publishedAt
          });
          return {
            id: stableHash(`${source.id}|${item.id ?? dedupKey}`).slice(0, 40),
            provider: this.id,
            sourceName: source.name,
            sourceUrl: canonicalUrl,
            canonicalUrl,
            title: item.title,
            ...(item.summary ? { summary: item.summary } : {}),
            publishedAt: item.publishedAt,
            fetchedAt,
            language: source.defaultLanguage,
            symbols: detectSymbols(combinedText),
            categories: classifyNews(combinedText, source.categories),
            contentHash: stableHash(`${item.title.toLowerCase()}|${item.summary ?? ""}|${canonicalUrl}`)
          };
        });
        this.sourceHealth.set(source.id, {
          providerId: source.id,
          state: "healthy",
          checkedAt: fetchedAt,
          lastSuccessAt: fetchedAt,
          latencyMs: Date.now() - sourceStartedAt,
          message: `${items.length} feed items parsed.`,
          itemCount: items.length
        });
        return { source, items };
      } catch (error) {
        this.sourceHealth.set(source.id, {
          providerId: source.id,
          state: "unavailable",
          checkedAt: fetchedAt,
          latencyMs: Date.now() - sourceStartedAt,
          message: String(error)
        });
        throw { source, error };
      }
    }));

    const warnings: ProviderWarning[] = [];
    const byKey = new Map<string, NewsItem>();
    let successCount = 0;
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      const source = sources[index];
      if (result.status === "rejected") {
        warnings.push({
          code: "rss_source_unavailable",
          message: String((result.reason as any)?.error ?? result.reason),
          retryable: true,
          sourceId: source?.id
        });
        continue;
      }
      successCount += 1;
      for (const item of result.value.items) {
        const key = normalizedNewsDedupKey({
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          sourceName: item.sourceName,
          publishedAt: item.publishedAt
        });
        if (!byKey.has(key)) byKey.set(key, item);
      }
    }
    const data = [...byKey.values()]
      .filter((item) => !input.from || new Date(item.publishedAt).getTime() >= new Date(input.from).getTime())
      .filter((item) => !input.to || new Date(item.publishedAt).getTime() <= new Date(input.to).getTime())
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, input.limit ?? 500);
    const degraded = successCount < sources.length;
    this.lastHealth = {
      providerId: this.id,
      state: successCount === 0 ? "unavailable" : degraded ? "degraded" : "healthy",
      checkedAt: fetchedAt,
      ...(successCount > 0 ? { lastSuccessAt: fetchedAt } : {}),
      latencyMs: Date.now() - startedAt,
      message: `${successCount}/${sources.length} RSS sources succeeded; ${data.length} unique items.`
    };
    return {
      providerId: this.id,
      data,
      warnings,
      latencyMs: Date.now() - startedAt,
      fetchedAt,
      degraded
    };
  }

  async health(): Promise<ProviderHealth> {
    return { ...this.lastHealth };
  }

  sourceStates(): Array<SourceHealth & { source: RssSourceConfig }> {
    return this.sources.map((configuredSource) => {
      const source = this.effectiveSource(configuredSource);
      const health = this.sourceHealth.get(source.id) ?? {
        providerId: source.id,
        state: "disabled" as const,
        checkedAt: new Date(0).toISOString(),
        message: "Source has not run yet."
      };
      return {
        source,
        ...health,
        ...(!source.enabled || source.usageStatus === "blocked"
          ? { state: "disabled" as const, message: "Source disabled by administrator." }
          : {})
      };
    });
  }
}

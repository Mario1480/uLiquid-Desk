import type { ProviderHealth } from "../../contracts/health.js";
import type { FetchNewsInput, NewsItem, NewsProvider } from "../../contracts/news.js";
import type { ProviderResult, ProviderWarning } from "../../contracts/provider.js";
import { canonicalizeUrl, classifyNews, detectSymbols, stableHash } from "../../normalization/index.js";
import {
  fetchFmpCryptoNews,
  fetchFmpGeneralNews
} from "../../../news/providers/fmp.js";
import { resolveLegacyFmpApiKey } from "./key.js";

export class LegacyFmpNewsProvider implements NewsProvider {
  readonly id = "legacy_fmp";
  private lastHealth: ProviderHealth = {
    providerId: this.id,
    state: "disabled",
    checkedAt: new Date(0).toISOString(),
    message: "Legacy FMP news adapter has not run."
  };

  constructor(private readonly db: any) {}

  async fetchNews(input: FetchNewsInput): Promise<ProviderResult<NewsItem[]>> {
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
    const limit = Math.min(100, Math.max(10, input.limit ?? 50));
    const settled = await Promise.allSettled([
      fetchFmpCryptoNews({ apiKey, page: 0, limit, signal: input.signal }),
      fetchFmpGeneralNews({ apiKey, page: 0, limit, signal: input.signal })
    ]);
    const data: NewsItem[] = [];
    const warnings: ProviderWarning[] = [];
    for (const result of settled) {
      if (result.status === "rejected") {
        warnings.push({ code: "legacy_fmp_news_unavailable", message: String(result.reason), retryable: true });
        continue;
      }
      for (const item of result.value) {
        const sourceUrl = canonicalizeUrl(item.url);
        if (!sourceUrl) continue;
        const combined = `${item.title} ${item.text ?? ""}`;
        data.push({
          id: stableHash(`legacy_fmp|${item.id}`).slice(0, 40),
          provider: this.id,
          sourceName: item.site || "Financial Modeling Prep",
          sourceUrl,
          canonicalUrl: sourceUrl,
          title: item.title,
          ...(item.text ? { summary: item.text.slice(0, 600) } : {}),
          publishedAt: item.publishedAt.toISOString(),
          fetchedAt,
          language: "en",
          symbols: item.symbol ? [item.symbol] : detectSymbols(combined),
          categories: classifyNews(combined, item.feed === "crypto" ? ["crypto_market"] : ["macro"]),
          contentHash: stableHash(`${item.title}|${item.text ?? ""}|${sourceUrl}`)
        });
      }
    }
    const degraded = warnings.length > 0;
    this.lastHealth = {
      providerId: this.id,
      state: data.length === 0 ? "unavailable" : degraded ? "degraded" : "healthy",
      checkedAt: fetchedAt,
      ...(data.length > 0 ? { lastSuccessAt: fetchedAt } : {}),
      latencyMs: Date.now() - startedAt,
      message: `${data.length} legacy FMP news items fetched.`
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
}

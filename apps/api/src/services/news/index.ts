import { getMarketIntelligenceService } from "../marketIntelligence/service.js";
import type { ListNewsParams, ListNewsResult, NewsItemView } from "./types.js";

export async function listNews(params: ListNewsParams): Promise<ListNewsResult> {
  const marketIntelligenceEnabled = !["0", "false", "off", "no"].includes(
    String(process.env.MARKET_INTELLIGENCE_ENABLED ?? "true").trim().toLowerCase()
  );
  if (!marketIntelligenceEnabled) {
    throw new Error("market_intelligence_disabled");
  }

  const service = getMarketIntelligenceService(params.db);
  const requestedCategories = params.categories && params.categories.length > 0
    ? params.categories
    : params.mode === "crypto"
      ? ["crypto_market"]
      : undefined;
  const result = await service.getNews({
    limit: params.mode === "general" ? Math.min(100, params.limit * 3) : params.limit,
    page: params.page,
    cursor: params.cursor ?? undefined,
    q: params.q,
    symbols: params.symbols,
    categories: requestedCategories,
    language: params.language,
    publisher: params.publisher,
    from: params.fromTs ?? params.from,
    to: params.toTs ?? params.to
  });
  const mappedItems = result.data.map((item) => ({
    id: item.id,
    source: item.provider,
    feed: item.categories.includes("crypto_market") || item.symbols.length > 0 ? "crypto" : "general",
    title: item.title,
    url: item.sourceUrl,
    site: item.sourceName,
    publishedAt: item.publishedAt,
    imageUrl: null,
    symbol: item.symbols[0] ?? null,
    text: item.summary ?? null
  } satisfies NewsItemView));
  const items = mappedItems
    .filter((item) => params.mode === "all" || item.feed === params.mode)
    .slice(0, params.limit);

  return {
    items,
    meta: {
      mode: params.mode,
      page: result.meta.page,
      limit: result.meta.limit,
      cache: result.meta.cache,
      fetchedAt: result.meta.generatedAt,
      partial: result.meta.degraded,
      degraded: result.meta.degraded,
      stale: result.meta.stale,
      warnings: result.meta.warnings,
      providerStates: result.meta.providerStates.map((state) => ({
        providerId: state.providerId,
        state: state.state,
        ...(state.message ? { message: state.message } : {})
      })),
      ...(result.meta.nextCursor ? { nextCursor: result.meta.nextCursor } : {}),
      ...(params.q ? { searchQuery: params.q, searchApplied: true } : {})
    }
  };
}

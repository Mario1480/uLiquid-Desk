import { callAi } from "../../ai/provider.js";
import type { EconomicEvent } from "./contracts/economicCalendar.js";
import type { NewsItem } from "./contracts/news.js";
import {
  marketSummarySchema,
  type GroundedMarketSummary,
  type MarketSummary,
  type SummaryCitation
} from "./contracts/summary.js";
import { stableHash } from "./normalization/index.js";

export const MARKET_SUMMARY_PROMPT_VERSION = "market-summary-v1";
const SUMMARY_CACHE_TTL_MS = Math.max(60, Number(process.env.AI_MARKET_SUMMARY_CACHE_TTL_SEC ?? "900")) * 1000;
const memoryCache = new Map<string, { expiresAt: number; value: GroundedMarketSummary }>();

function envEnabled(value: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function sourceIdForNews(item: NewsItem): string {
  return `news:${item.id}`;
}

function sourceIdForEvent(item: EconomicEvent): string {
  return `event:${item.id}`;
}

function buildCitations(news: NewsItem[], events: EconomicEvent[]): SummaryCitation[] {
  return [
    ...news.map((item) => ({
      id: sourceIdForNews(item),
      newsItemId: item.id,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt
    })),
    ...events.map((event) => ({
      id: sourceIdForEvent(event),
      economicEventId: event.id,
      sourceName: event.sourceName,
      ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
      publishedAt: event.scheduledAt
    }))
  ];
}

function summaryType(item: NewsItem): "macro" | "crypto" | "regulation" | "security" | "market" {
  if (item.categories.includes("security_incident")) return "security";
  if (item.categories.includes("regulation")) return "regulation";
  if (item.categories.includes("macro")) return "macro";
  if (item.categories.includes("crypto_market") || item.categories.includes("protocol")) return "crypto";
  return "market";
}

function deterministicSummary(params: {
  news: NewsItem[];
  events: EconomicEvent[];
  horizon: "intraday" | "24h" | "7d";
  now: Date;
  degraded: boolean;
  warnings: string[];
}): MarketSummary {
  const nowMs = params.now.getTime();
  const highEvents = params.events.filter((event) => event.importance === "high");
  const highWithin24h = highEvents.some((event) => {
    const delta = new Date(event.scheduledAt).getTime() - nowMs;
    return delta >= -60 * 60 * 1000 && delta <= 24 * 60 * 60 * 1000;
  });
  const hasSecurityIncident = params.news.some((item) => item.categories.includes("security_incident"));
  const overallRisk = params.degraded && params.news.length === 0 && params.events.length === 0
    ? "unknown" as const
    : highWithin24h || hasSecurityIncident
      ? "high" as const
      : highEvents.length > 0
        ? "moderate" as const
        : "low" as const;
  const sentiments = params.news.map((item) => item.sentiment?.label).filter(Boolean);
  const sentiment = sentiments.length === 0
    ? "neutral" as const
    : new Set(sentiments).size > 1
      ? "mixed" as const
      : sentiments[0] === "negative"
        ? "bearish" as const
        : sentiments[0] === "positive"
          ? "bullish" as const
          : "neutral" as const;
  const eventHighlights = highEvents.slice(0, 2).map((event) => ({
    type: "macro" as const,
    importance: event.importance,
    headline: event.title,
    explanation: `Officially scheduled ${event.country} event at ${event.scheduledAt}. Forecast is ${event.forecast === undefined ? "not available" : String(event.forecast)}.`,
    sourceIds: [sourceIdForEvent(event)],
    inference: false
  }));
  const newsHighlights = params.news.slice(0, Math.max(0, 5 - eventHighlights.length)).map((item) => ({
    type: summaryType(item),
    importance: item.categories.includes("security_incident") ? "high" as const : "medium" as const,
    headline: item.title,
    explanation: item.summary || `Published by ${item.sourceName}. Open the source for the complete context.`,
    sourceIds: [sourceIdForNews(item)],
    inference: false
  }));
  return marketSummarySchema.parse({
    title: "Market Intelligence Summary",
    generatedAt: params.now.toISOString(),
    horizon: params.horizon,
    overallRisk,
    sentiment,
    highlights: [...eventHighlights, ...newsHighlights],
    upcomingRisks: highEvents.slice(0, 8).map((event) => ({
      label: event.title,
      scheduledAt: event.scheduledAt,
      sourceIds: [sourceIdForEvent(event)]
    })),
    uncertainties: [
      ...(params.degraded ? ["One or more market-data providers are degraded or unavailable."] : []),
      ...(highEvents.some((event) => event.forecast === undefined)
        ? ["Official sources do not provide a licensed consensus forecast for every event."]
        : []),
      ...params.warnings.slice(0, 5)
    ]
  });
}

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("market_summary_json_missing");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function validateGrounding(summary: MarketSummary, citationIds: Set<string>): void {
  const referenced = [
    ...summary.highlights.flatMap((item) => item.sourceIds),
    ...summary.upcomingRisks.flatMap((item) => item.sourceIds)
  ];
  if (summary.highlights.length > 0 && referenced.length === 0) throw new Error("market_summary_citations_missing");
  if (referenced.some((id) => !citationIds.has(id))) throw new Error("market_summary_unknown_citation");
}

export async function generateGroundedMarketSummary(params: {
  news: NewsItem[];
  events: EconomicEvent[];
  horizon?: "intraday" | "24h" | "7d";
  degraded?: boolean;
  warnings?: string[];
  now?: Date;
  billingUserId?: string | null;
}): Promise<GroundedMarketSummary> {
  const now = params.now ?? new Date();
  const horizon = params.horizon ?? "24h";
  const news = [...params.news]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 20);
  const events = [...params.events]
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 20);
  const citations = buildCitations(news, events);
  const sourceClusterHash = buildMarketSummarySourceClusterHash({
    news,
    events,
    horizon,
    degraded: params.degraded === true,
    warnings: params.warnings ?? []
  });
  const model = resolveMarketSummaryModel();
  const cacheKey = `${sourceClusterHash}:${MARKET_SUMMARY_PROMPT_VERSION}:${model}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, meta: { ...cached.value.meta, cached: true } };
  }
  const warnings = [...new Set(params.warnings ?? [])];
  const fallback = deterministicSummary({
    news,
    events,
    horizon,
    now,
    degraded: params.degraded === true,
    warnings
  });
  let summary = fallback;
  let usedModel = "deterministic-v1";
  if (envEnabled(process.env.AI_MARKET_SUMMARY_ENABLED) && citations.length > 0) {
    try {
      const allowedSourceIds = citations.map((citation) => citation.id);
      const raw = await callAi(
        JSON.stringify({
          instruction: "Create a concise market intelligence summary. Use only supplied facts. Every highlight and upcoming risk must cite one or more allowed source IDs. Mark inference=true for any inference. Never provide trading instructions, orders, position changes, or fabricated forecasts.",
          schema: {
            title: "string",
            generatedAt: now.toISOString(),
            horizon,
            overallRisk: "low|moderate|high|unknown",
            sentiment: "bearish|neutral|bullish|mixed",
            highlights: [{ type: "macro|crypto|regulation|security|market", importance: "low|medium|high", headline: "string", explanation: "string", sourceIds: ["allowed source id"], inference: false }],
            upcomingRisks: [{ label: "string", scheduledAt: "optional ISO string", sourceIds: ["allowed source id"] }],
            uncertainties: ["string"]
          },
          allowedSourceIds,
          news: news.map((item) => ({
            sourceId: sourceIdForNews(item),
            title: item.title,
            summary: item.summary,
            categories: item.categories,
            symbols: item.symbols,
            publishedAt: item.publishedAt,
            sourceName: item.sourceName
          })),
          events: events.map((event) => ({
            sourceId: sourceIdForEvent(event),
            title: event.title,
            scheduledAt: event.scheduledAt,
            importance: event.importance,
            actual: event.actual,
            forecast: event.forecast,
            previous: event.previous,
            sourceName: event.sourceName
          }))
        }),
        {
          systemMessage: "You are a read-only market intelligence summarizer. Output JSON only. You have no tools and cannot execute trades.",
          model,
          temperature: 0,
          maxTokens: 1200,
          timeoutMs: 20_000,
          billingUserId: params.billingUserId ?? null,
          billingScope: "market_intelligence_summary"
        }
      );
      const parsed = marketSummarySchema.parse(extractJsonObject(raw));
      validateGrounding(parsed, new Set(allowedSourceIds));
      summary = parsed;
      usedModel = model;
    } catch (error) {
      warnings.push(`AI summary fallback: ${String(error)}`.slice(0, 300));
    }
  }
  validateGrounding(summary, new Set(citations.map((citation) => citation.id)));
  const value: GroundedMarketSummary = {
    summary,
    citations,
    meta: {
      promptVersion: MARKET_SUMMARY_PROMPT_VERSION,
      model: usedModel,
      sourceClusterHash,
      cached: false,
      degraded: params.degraded === true || warnings.length > 0,
      warnings
    }
  };
  memoryCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS, value });
  return value;
}

export function resolveMarketSummaryModel(): string {
  return envEnabled(process.env.AI_MARKET_SUMMARY_ENABLED)
    ? String(process.env.AI_MARKET_SUMMARY_MODEL ?? process.env.AI_MODEL ?? "gpt-4o-mini")
    : "deterministic-v1";
}

export function buildMarketSummarySourceClusterHash(params: {
  news: NewsItem[];
  events: EconomicEvent[];
  horizon: "intraday" | "24h" | "7d";
  degraded: boolean;
  warnings: string[];
}): string {
  return stableHash(JSON.stringify({
    news: params.news.map((item) => [item.id, item.contentHash]),
    events: params.events.map((item) => [item.id, item.scheduledAt, item.actual, item.status]),
    horizon: params.horizon,
    degraded: params.degraded,
    warnings: [...new Set(params.warnings)].sort()
  }));
}

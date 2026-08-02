import type { ProviderHealth } from "./health.js";
import type { ProviderResult } from "./provider.js";

export type NewsCategory =
  | "crypto_market"
  | "macro"
  | "regulation"
  | "exchange"
  | "security_incident"
  | "protocol"
  | "institutional"
  | "stablecoin";

export type NewsItem = {
  id: string;
  provider: string;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
  summary?: string;
  publishedAt: string;
  fetchedAt: string;
  language?: string;
  symbols: string[];
  categories: NewsCategory[];
  sentiment?: {
    score: number;
    label: "negative" | "neutral" | "positive";
    origin: "provider" | "local_model" | "ai";
  };
  contentHash: string;
};

export type FetchNewsInput = {
  from?: string;
  to?: string;
  limit?: number;
  signal?: AbortSignal;
};

export interface NewsProvider {
  readonly id: string;
  fetchNews(input: FetchNewsInput): Promise<ProviderResult<NewsItem[]>>;
  health(): Promise<ProviderHealth>;
}

import type { NewsCategory } from "../../contracts/news.js";

export type RssSourceConfig = {
  id: string;
  name: string;
  feedUrl: string;
  homepageUrl: string;
  enabled: boolean;
  categories: NewsCategory[];
  defaultLanguage: string;
  fetchIntervalMinutes: number;
  termsReviewedAt?: string;
  usageStatus: "pending_review" | "approved" | "blocked";
};

const DEFAULT_SOURCES: RssSourceConfig[] = [
  {
    id: "federal-reserve-press",
    name: "Federal Reserve Board",
    feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    homepageUrl: "https://www.federalreserve.gov/feeds/feeds.htm",
    enabled: true,
    categories: ["macro", "institutional"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 10,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "federal-reserve-speeches",
    name: "Federal Reserve Board",
    feedUrl: "https://www.federalreserve.gov/feeds/speeches.xml",
    homepageUrl: "https://www.federalreserve.gov/feeds/feeds.htm",
    enabled: true,
    categories: ["macro", "institutional"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 15,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "ecb-press",
    name: "European Central Bank",
    feedUrl: "https://www.ecb.europa.eu/rss/press.html",
    homepageUrl: "https://www.ecb.europa.eu/home/html/rss.en.html",
    enabled: true,
    categories: ["macro", "institutional"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 10,
    termsReviewedAt: "2026-08-02",
    usageStatus: "approved"
  },
  {
    id: "sec-press-releases",
    name: "U.S. Securities and Exchange Commission",
    feedUrl: "https://www.sec.gov/news/pressreleases.rss",
    homepageUrl: "https://www.sec.gov/about/rss-feeds",
    enabled: true,
    categories: ["regulation", "institutional"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 15,
    termsReviewedAt: "2026-08-02",
    usageStatus: "approved"
  },
  {
    id: "sec-speeches-statements",
    name: "U.S. Securities and Exchange Commission",
    feedUrl: "https://www.sec.gov/news/speeches-statements.rss",
    homepageUrl: "https://www.sec.gov/newsroom/speeches-statements",
    enabled: true,
    categories: ["regulation", "institutional", "crypto_market"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 15,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "cftc-press-releases",
    name: "U.S. Commodity Futures Trading Commission",
    feedUrl: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
    homepageUrl: "https://www.cftc.gov/RSS/index.htm",
    enabled: false,
    categories: ["regulation", "institutional", "crypto_market"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 15,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "bis-press-releases",
    name: "Bank for International Settlements",
    feedUrl: "https://www.bis.org/doclist/all_pressrels.rss",
    homepageUrl: "https://www.bis.org/rss/index.htm",
    enabled: true,
    categories: ["macro", "institutional", "stablecoin"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 30,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "ethereum-foundation-blog",
    name: "Ethereum Foundation Blog",
    feedUrl: "https://blog.ethereum.org/feed.xml",
    homepageUrl: "https://blog.ethereum.org/",
    enabled: true,
    categories: ["crypto_market", "protocol", "security_incident"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 30,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  },
  {
    id: "kraken-blog",
    name: "Kraken Blog",
    feedUrl: "https://blog.kraken.com/feed",
    homepageUrl: "https://blog.kraken.com/",
    enabled: true,
    categories: ["crypto_market", "exchange", "institutional"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 30,
    termsReviewedAt: "2026-08-12",
    usageStatus: "approved"
  }
];

const ALLOWED_CATEGORIES = new Set<NewsCategory>([
  "crypto_market",
  "macro",
  "regulation",
  "exchange",
  "security_incident",
  "protocol",
  "institutional",
  "stablecoin"
]);

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return fallback;
}

function normalizeSource(raw: unknown): RssSourceConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = String(value.id ?? "").trim().toLowerCase();
  const name = String(value.name ?? "").trim();
  const feedUrl = String(value.feedUrl ?? "").trim();
  const homepageUrl = String(value.homepageUrl ?? "").trim();
  const usageStatus = value.usageStatus === "approved" || value.usageStatus === "blocked"
    ? value.usageStatus
    : "pending_review";
  if (!/^[a-z0-9][a-z0-9_-]{1,80}$/.test(id) || !name || !feedUrl || !homepageUrl) return null;
  const categories = Array.isArray(value.categories)
    ? value.categories
        .map((entry) => String(entry).trim() as NewsCategory)
        .filter((entry) => ALLOWED_CATEGORIES.has(entry))
    : [];
  return {
    id,
    name: name.slice(0, 160),
    feedUrl,
    homepageUrl,
    enabled: parseBoolean(value.enabled, false),
    categories: categories.length > 0 ? [...new Set(categories)] : ["macro"],
    defaultLanguage: String(value.defaultLanguage ?? "en").trim().slice(0, 16) || "en",
    fetchIntervalMinutes: Math.min(1440, Math.max(5, Math.trunc(Number(value.fetchIntervalMinutes) || 15))),
    ...(typeof value.termsReviewedAt === "string" && value.termsReviewedAt.trim()
      ? { termsReviewedAt: value.termsReviewedAt.trim().slice(0, 32) }
      : {}),
    usageStatus
  };
}

export function loadRssSourceRegistry(env = process.env): RssSourceConfig[] {
  const raw = String(env.RSS_SOURCE_REGISTRY_JSON ?? "").trim();
  if (!raw) return DEFAULT_SOURCES.map((source) => ({ ...source, categories: [...source.categories] }));
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSource).filter((source): source is RssSourceConfig => Boolean(source));
  } catch {
    return [];
  }
}

export function activeRssSources(params: {
  sources?: RssSourceConfig[];
  production?: boolean;
} = {}): RssSourceConfig[] {
  const sources = params.sources ?? loadRssSourceRegistry();
  const production = params.production ?? process.env.NODE_ENV === "production";
  return sources.filter((source) => {
    if (!source.enabled || source.usageStatus === "blocked") return false;
    if (production && source.usageStatus !== "approved") return false;
    return true;
  });
}

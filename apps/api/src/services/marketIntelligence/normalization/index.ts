import crypto from "node:crypto";
import type { NewsCategory } from "../contracts/news.js";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term"
]);

const SYMBOL_ALIASES: Array<{ symbol: string; aliases: string[] }> = [
  { symbol: "BTC", aliases: ["bitcoin", "btc"] },
  { symbol: "ETH", aliases: ["ethereum", "ether", "eth"] },
  { symbol: "SOL", aliases: ["solana", "sol"] },
  { symbol: "XRP", aliases: ["xrp", "ripple"] },
  { symbol: "USDC", aliases: ["usdc", "usd coin"] },
  { symbol: "USDT", aliases: ["usdt", "tether"] },
  { symbol: "HYPE", aliases: ["hyperliquid", "hype"] }
];

export function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sanitizeText(value: unknown, maxLength = 600): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function canonicalizeUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  return url.toString().slice(0, 2048);
}

function secPressReleaseYear(value: string): number | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== "www.sec.gov" && url.hostname !== "sec.gov") return null;
  const match = url.pathname.match(/^\/newsroom\/press-releases\/(\d{2}|\d{4})-\d+(?:-|$)/i);
  if (!match) return null;
  const rawYear = Number(match[1]);
  if (!Number.isInteger(rawYear)) return null;
  if (match[1].length === 4) return rawYear;
  return rawYear >= 90 ? 1900 + rawYear : 2000 + rawYear;
}

export function newsPublicationDateIssue(input: {
  sourceUrl: string;
  publishedAt: string;
  fetchedAt: string;
}): "invalid_date" | "future_date" | "source_year_mismatch" | null {
  const publishedAt = new Date(input.publishedAt);
  const fetchedAt = new Date(input.fetchedAt);
  if (!Number.isFinite(publishedAt.getTime()) || !Number.isFinite(fetchedAt.getTime())) {
    return "invalid_date";
  }
  if (publishedAt.getTime() > fetchedAt.getTime() + 24 * 60 * 60 * 1000) {
    return "future_date";
  }
  const embeddedYear = secPressReleaseYear(input.sourceUrl);
  if (embeddedYear !== null && embeddedYear !== publishedAt.getUTCFullYear()) {
    return "source_year_mismatch";
  }
  return null;
}

export function detectSymbols(text: string): string[] {
  const normalized = ` ${sanitizeText(text, 5000).toLowerCase()} `;
  return SYMBOL_ALIASES
    .filter((entry) => entry.aliases.some((alias) => new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(normalized)))
    .map((entry) => entry.symbol);
}

export function classifyNews(text: string, defaults: NewsCategory[] = []): NewsCategory[] {
  const normalized = sanitizeText(text, 5000).toLowerCase();
  const categories = new Set<NewsCategory>(defaults);
  if (/sec|regulat|law|policy|compliance|legislation/.test(normalized)) categories.add("regulation");
  if (/hack|exploit|breach|vulnerab|cyber|stolen/.test(normalized)) categories.add("security_incident");
  if (/stablecoin|usdc|usdt|tether/.test(normalized)) categories.add("stablecoin");
  if (/exchange|binance|bitget|mexc|hyperliquid|coinbase/.test(normalized)) categories.add("exchange");
  if (/fomc|inflation|cpi|gdp|employment|interest rate|central bank|ecb|federal reserve/.test(normalized)) categories.add("macro");
  if (/protocol|mainnet|upgrade|fork|validator|defi/.test(normalized)) categories.add("protocol");
  if (/institution|etf|fund|bank|treasury/.test(normalized)) categories.add("institutional");
  if (/bitcoin|ethereum|crypto|blockchain|token|btc|eth/.test(normalized)) categories.add("crypto_market");
  if (categories.size === 0) categories.add("macro");
  return [...categories];
}

export function normalizedNewsDedupKey(input: {
  canonicalUrl?: string;
  title: string;
  sourceName: string;
  publishedAt: string;
}): string {
  const title = sanitizeText(input.title, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const timeBucket = Math.floor(new Date(input.publishedAt).getTime() / (6 * 60 * 60 * 1000));
  return stableHash(`${input.canonicalUrl ?? ""}|${title}|${input.sourceName.toLowerCase()}|${timeBucket}`);
}

import { canonicalizeUrl, sanitizeText } from "../../normalization/index.js";

export type ParsedFeedItem = {
  id?: string;
  title: string;
  url: string;
  summary?: string;
  publishedAt: string;
};

function extractTag(block: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = block.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractLink(block: string): string | null {
  const textLink = extractTag(block, ["link"]);
  const canonicalTextLink = canonicalizeUrl(sanitizeText(textLink, 2048));
  if (canonicalTextLink) return canonicalTextLink;
  const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of links) {
    const attributes = match[1] ?? "";
    const rel = attributes.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (rel && rel !== "alternate") continue;
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const canonical = canonicalizeUrl(href);
    if (canonical) return canonical;
  }
  return null;
}

function parseDate(value: string | null): string | null {
  const raw = sanitizeText(value, 200);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function parseRssOrAtom(xml: string, maxItems = 200): ParsedFeedItem[] {
  const input = String(xml ?? "");
  if (!input.trim()) return [];
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("rss_unsafe_xml_declaration");
  if (input.length > 2_000_000) throw new Error("rss_xml_too_large");
  const blocks = [
    ...input.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...input.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)
  ].slice(0, Math.max(1, maxItems));
  const items: ParsedFeedItem[] = [];
  for (const match of blocks) {
    const block = match[1] ?? "";
    const title = sanitizeText(extractTag(block, ["title"]), 300);
    const url = extractLink(block);
    const publishedAt = parseDate(extractTag(block, ["pubDate", "published", "updated", "dc:date"]));
    if (!title || !url || !publishedAt) continue;
    const id = sanitizeText(extractTag(block, ["guid", "id"]), 300);
    const summary = sanitizeText(extractTag(block, ["description", "summary", "content:encoded", "content"]), 600);
    items.push({
      ...(id ? { id } : {}),
      title,
      url,
      ...(summary ? { summary } : {}),
      publishedAt
    });
  }
  return items;
}

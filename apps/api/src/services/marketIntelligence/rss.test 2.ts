import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizedNewsDedupKey } from "./normalization/index.js";
import { RssNewsProvider } from "./providers/rss/RssNewsProvider.js";
import { parseRssOrAtom } from "./providers/rss/parser.js";
import type { RssSourceConfig } from "./providers/rss/sourceRegistry.js";
import { isPublicIpAddress, validateFeedUrl } from "./providers/rss/security.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("RSS and Atom fixtures share one sanitized parser contract", () => {
  const fed = parseRssOrAtom(fixture("fed-rss.xml"));
  const ecb = parseRssOrAtom(fixture("ecb-atom.xml"));
  const sec = parseRssOrAtom(fixture("sec-rss.xml"));

  assert.equal(fed.length, 1);
  assert.equal(ecb.length, 1);
  assert.equal(sec.length, 1);
  assert.equal(fed[0].summary?.includes("script"), false);
  assert.equal(fed[0].url.includes("utm_source"), false);
  assert.equal(ecb[0].publishedAt, "2026-08-01T12:15:00.000Z");
  assert.throws(
    () => parseRssOrAtom("<!DOCTYPE rss [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><rss />"),
    /rss_unsafe_xml_declaration/
  );
});

test("feed URL validation blocks SSRF targets and non-HTTPS URLs", () => {
  assert.equal(validateFeedUrl("https://www.sec.gov/news/pressreleases.rss", ["www.sec.gov"]).hostname, "www.sec.gov");
  assert.throws(() => validateFeedUrl("http://www.sec.gov/feed", ["www.sec.gov"]), /rss_https_required/);
  assert.throws(() => validateFeedUrl("https://localhost/feed", ["localhost"]), /rss_private_host_blocked/);
  assert.throws(() => validateFeedUrl("https://example.org/feed", ["www.sec.gov"]), /rss_host_not_allowlisted/);
  assert.equal(isPublicIpAddress("127.0.0.1"), false);
  assert.equal(isPublicIpAddress("10.2.3.4"), false);
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
});

test("dedup keys collapse tracking variants in the same time bucket", () => {
  const base = {
    title: "Policy update",
    sourceName: "Official source",
    publishedAt: "2026-08-01T12:00:00.000Z"
  };
  assert.equal(
    normalizedNewsDedupKey({ ...base, canonicalUrl: "https://example.org/update" }),
    normalizedNewsDedupKey({ ...base, canonicalUrl: "https://example.org/update" })
  );
});

test("RSS provider tolerates one source failure and reports degraded mode", async () => {
  const sources: RssSourceConfig[] = [
    ["fed", "Federal Reserve", "fed-rss.xml", "macro"],
    ["ecb", "European Central Bank", "ecb-atom.xml", "macro"],
    ["sec", "SEC", "sec-rss.xml", "regulation"]
  ].map(([id, name, file, category]) => ({
    id,
    name,
    feedUrl: `https://${id}.example.test/${file}`,
    homepageUrl: `https://${id}.example.test/`,
    enabled: true,
    categories: [category as "macro" | "regulation"],
    defaultLanguage: "en",
    fetchIntervalMinutes: 10,
    termsReviewedAt: "2026-08-02",
    usageStatus: "approved"
  }));
  const provider = new RssNewsProvider(sources, async ({ url }) => {
    if (url.includes("sec.example.test")) throw new Error("fixture_source_down");
    const file = url.includes("fed.example.test") ? "fed-rss.xml" : "ecb-atom.xml";
    return { body: fixture(file), finalUrl: url, contentType: "application/xml" };
  });

  const result = await provider.fetchNews({ limit: 20 });
  assert.equal(result.data.length, 2);
  assert.equal(result.degraded, true);
  assert.equal(result.warnings[0]?.sourceId, "sec");
  assert.equal((await provider.health()).state, "degraded");
});

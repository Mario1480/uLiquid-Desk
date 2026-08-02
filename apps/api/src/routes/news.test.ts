import assert from "node:assert/strict";
import test from "node:test";
import { newsQuerySchema } from "./news.js";
import { listNews } from "../services/news/index.js";

test("news query rejects page=0", () => {
  const parsed = newsQuerySchema.safeParse({ page: "0" });
  assert.equal(parsed.success, false);
});

test("news query accepts valid fromTs/toTs", () => {
  const parsed = newsQuerySchema.safeParse({
    mode: "all",
    page: "1",
    limit: "20",
    fromTs: "2026-02-23T00:00:00.000Z",
    toTs: "2026-02-23T23:59:59.999Z"
  });
  assert.equal(parsed.success, true);
});

test("news query rejects invalid fromTs/toTs", () => {
  const invalidFrom = newsQuerySchema.safeParse({ page: "1", fromTs: "2026-02-23" });
  const invalidTo = newsQuerySchema.safeParse({ page: "1", toTs: "broken" });
  assert.equal(invalidFrom.success, false);
  assert.equal(invalidTo.success, false);
});

test("existing news service returns provider-neutral rows without an FMP key", async () => {
  const previousEnabled = process.env.MARKET_INTELLIGENCE_ENABLED;
  process.env.MARKET_INTELLIGENCE_ENABLED = "true";
  try {
    const result = await listNews({
      db: {
        globalSetting: { findUnique: async () => null },
        marketNewsItem: {
          findMany: async () => [{
            id: "db_1",
            sourceId: "rss_1",
            provider: "rss",
            sourceName: "Federal Reserve",
            sourceUrl: "https://www.federalreserve.gov/fixture",
            canonicalUrl: "https://www.federalreserve.gov/fixture",
            title: "Policy fixture",
            summary: "Source-backed fixture.",
            publishedAt: new Date("2026-08-02T08:00:00.000Z"),
            fetchedAt: new Date("2026-08-02T08:01:00.000Z"),
            language: "en",
            symbols: [],
            categories: ["macro"],
            contentHash: "hash"
          }]
        }
      },
      mode: "general",
      limit: 20,
      page: 1
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, "rss_1");
    assert.equal(result.items[0].source, "rss");
    assert.equal(result.items[0].site, "Federal Reserve");
  } finally {
    if (previousEnabled === undefined) delete process.env.MARKET_INTELLIGENCE_ENABLED;
    else process.env.MARKET_INTELLIGENCE_ENABLED = previousEnabled;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { registerCrossMarketRoutes } from "./routes.js";
import type { CrossMarketBook, CrossMarketVenue } from "./core.js";

function fakeApp() {
  let handlers: any[] = [];
  return {
    post(_path: string, ...next: any[]) { handlers = next; },
    handler() { return handlers.at(-1); }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; }
  };
}

function book(venue: CrossMarketVenue): CrossMarketBook {
  return {
    venue,
    bids: [[101, 20]],
    asks: [[100, 20]],
    observedAt: "2026-09-09T10:00:00.000Z",
    fetchedAt: "2026-09-09T10:00:00.010Z",
    ageMs: 10,
    quality: "fresh",
    warnings: [],
    snapshotId: `snapshot:${venue}`,
    providerId: `native:${venue}`
  };
}

test("route validates scanner inputs before invoking providers", async () => {
  let calls = 0;
  const app = fakeApp();
  registerCrossMarketRoutes(app as any, { readBook: async ({ venue }) => { calls += 1; return book(venue); } });
  const res = response();
  await app.handler()({ body: { kind: "arbitrage", symbol: "BTCUSDT", venues: ["binance"], targetNotionalUsd: 10 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_payload");
  assert.equal(calls, 0);
});

test("route exposes a scanner-only response and fee override provenance", async () => {
  const app = fakeApp();
  registerCrossMarketRoutes(app as any, { readBook: async ({ venue }) => book(venue) });
  const res = response();
  await app.handler()({ body: {
    kind: "xemm",
    symbol: "BTCUSDT",
    venues: ["binance", "bitget"],
    targetNotionalUsd: 1_000,
    feeProfiles: { binance: { makerBps: 1, takerBps: 8 } }
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, "scanner_only");
  assert.equal(res.body.kind, "xemm");
  assert.ok(res.body.opportunities.length > 0);
  assert.deepEqual(res.body.assumptions.feeProfiles.binance, {
    makerBps: 1,
    takerBps: 8,
    source: "request_override"
  });
  assert.equal(res.body.assumptions.feeProfiles.bitget.source, "default_assumption");
});

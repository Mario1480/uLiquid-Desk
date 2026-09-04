import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardMarketSessionsUpdateSchema,
  dashboardFundingRatesUpdateSchema,
  dashboardTopMoversUpdateSchema,
  dashboardWatchlistUpdateSchema,
  loadDashboardFundingRates,
  loadDashboardNetworkStatus,
  loadDashboardTopMovers,
  loadDashboardWatchlistQuotes,
  normalizeDashboardMarketSessions,
  normalizeDashboardWatchlist
} from "./widgets.js";

test("dashboard widget preferences reject duplicates and unsupported values", () => {
  assert.equal(dashboardMarketSessionsUpdateSchema.safeParse({ selected: ["newYork", "newYork"] }).success, false);
  assert.equal(dashboardWatchlistUpdateSchema.safeParse({ symbols: ["BTCUSDT", "BTCUSDT"] }).success, false);
  assert.equal(dashboardWatchlistUpdateSchema.safeParse({ symbols: ["UNKNOWNUSDT"] }).success, false);
  assert.equal(dashboardFundingRatesUpdateSchema.safeParse({ symbols: ["BTCUSDT", "BTCUSDT"] }).success, false);
  assert.equal(dashboardTopMoversUpdateSchema.safeParse({ marketType: "options" }).success, false);
});

test("dashboard widget preferences fall back to safe defaults", () => {
  assert.deepEqual(normalizeDashboardMarketSessions(null), ["newYork", "london", "frankfurt", "tokyo"]);
  assert.deepEqual(normalizeDashboardWatchlist(null), ["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
});

test("watchlist quotes preserve the selected order and parse Binance values", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { symbol: "BTCUSDT", lastPrice: "112000.5", priceChangePercent: "1.25", highPrice: "114000", lowPrice: "109500" },
    { symbol: "ETHUSDT", lastPrice: "4450", priceChangePercent: "-0.75", highPrice: "4520", lowPrice: "4380" }
  ]), { status: 200, headers: { "content-type": "application/json" } });

  const result = await loadDashboardWatchlistQuotes(["ETHUSDT", "BTCUSDT"], fetchImpl as typeof fetch, 1_800_000_000_000);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.items.map((item) => item.symbol), ["ETHUSDT", "BTCUSDT"]);
  assert.equal(result.items[0]?.changePct24h, -0.75);
  assert.equal(result.items[1]?.price, 112000.5);
});

test("funding rates parse percentages, next funding time, and elevated values", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { symbol: "BTCUSDT", lastFundingRate: "0.00010000", nextFundingTime: 1_800_003_600_000, markPrice: "112000" },
    { symbol: "SOLUSDT", lastFundingRate: "-0.00060000", nextFundingTime: 1_800_003_600_000, markPrice: "210" }
  ]), { status: 200, headers: { "content-type": "application/json" } });

  const result = await loadDashboardFundingRates(["SOLUSDT", "BTCUSDT"], fetchImpl as typeof fetch, 1_800_000_000_000);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.items.map((item) => item.symbol), ["SOLUSDT", "BTCUSDT"]);
  assert.equal(result.items[0]?.fundingRatePct, -0.06);
  assert.equal(result.items[0]?.elevated, true);
  assert.equal(result.items[1]?.fundingRatePct, 0.01);
});

test("top movers rank liquid USDT markets and exclude leveraged and stable pairs", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { symbol: "AAAUSDT", lastPrice: "2", priceChangePercent: "12", quoteVolume: "20000000" },
    { symbol: "BBBUSDT", lastPrice: "3", priceChangePercent: "5", quoteVolume: "30000000" },
    { symbol: "CCCUSDT", lastPrice: "4", priceChangePercent: "-9", quoteVolume: "25000000" },
    { symbol: "DDDUSDT", lastPrice: "5", priceChangePercent: "-3", quoteVolume: "11000000" },
    { symbol: "BTCUPUSDT", lastPrice: "1", priceChangePercent: "40", quoteVolume: "50000000" },
    { symbol: "USDCUSDT", lastPrice: "1", priceChangePercent: "2", quoteVolume: "50000000" },
    { symbol: "TINYUSDT", lastPrice: "1", priceChangePercent: "50", quoteVolume: "9999999" }
  ]), { status: 200, headers: { "content-type": "application/json" } });

  const result = await loadDashboardTopMovers("spot", fetchImpl as typeof fetch, 1_800_100_000_000);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.gainers.map((item) => item.symbol), ["AAAUSDT", "BBBUSDT"]);
  assert.deepEqual(result.losers.map((item) => item.symbol), ["CCCUSDT", "DDDUSDT"]);
});

test("network status parses RPC blocks and reports failed market services", async () => {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && !url.includes("hyperliquid.xyz/info")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
    }
    if (url.includes("hyperliquid.xyz/info")) {
      return new Response(JSON.stringify({ universe: [] }), { status: 200 });
    }
    return new Response("{}", { status: url.includes("fapi") ? 503 : 200 });
  };
  const result = await loadDashboardNetworkStatus(fetchImpl as typeof fetch, 1_800_200_000_000);
  assert.equal(result.items.find((item) => item.id === "hyperEvm")?.blockNumber, 16);
  assert.equal(result.items.find((item) => item.id === "hyperliquid")?.status, "operational");
  assert.equal(result.items.find((item) => item.id === "arbitrum")?.status, "operational");
  assert.equal(result.items.find((item) => item.id === "binancePerp")?.status, "unavailable");
  assert.equal(result.degraded, true);
});

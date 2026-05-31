import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeComparableMarketSymbol,
  normalizeComparableSymbol,
  readMarkPriceDiagnosticFromAdapter
} from "./futuresVenueRuntime.js";

test("normalizeComparableMarketSymbol matches stablecoin-quoted perp aliases without changing raw symbol normalization", () => {
  assert.equal(normalizeComparableSymbol("BTCUSDT"), "BTCUSDT");
  assert.equal(normalizeComparableMarketSymbol("BTCUSDT"), "BTC");
  assert.equal(normalizeComparableMarketSymbol("BTCUSDC"), "BTC");
  assert.equal(normalizeComparableMarketSymbol("BTC-PERP"), "BTC");
  assert.equal(normalizeComparableMarketSymbol("BTC-USDT-PERP"), "BTC");
  assert.equal(normalizeComparableMarketSymbol("BTC/USDT:USDT"), "BTC");
  assert.equal(normalizeComparableMarketSymbol("USDC"), "USDC");
});

test("readMarkPriceDiagnosticFromAdapter uses cached snapshot diagnostics when available", async () => {
  let remoteCalls = 0;
  const adapter = {
    async toExchangeSymbol() {
      return "BTC-PERP";
    },
    getLatestTickerSnapshot() {
      return {
        symbol: "BTC-PERP",
        markPrice: 70100,
        midPrice: 70090,
        priceSource: "markPx",
        diagnostics: {
          degraded: true,
          endpointFailures: [
            {
              endpoint: "getMetaAndAssetCtxs",
              errorCategory: "timeout",
              retryCount: 1,
              message: "temporary timeout"
            }
          ],
          retryCount: 1,
          snapshotAgeMs: 1500,
          usedCachedSnapshot: true,
          attemptedSources: ["markPx", "mid"],
          errorCategory: "timeout"
        }
      };
    },
    marketApi: {
      async getTicker() {
        remoteCalls += 1;
        throw new Error("should not hit live ticker when cached snapshot is usable");
      }
    }
  } as any;

  const diagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, "BTCUSDT");

  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.price, 70100);
  assert.equal(diagnostic.usedCachedSnapshot, true);
  assert.equal(diagnostic.staleCacheAgeMs, 1500);
  assert.equal(remoteCalls, 0);
});

test("readMarkPriceDiagnosticFromAdapter preserves structured root cause when live ticker fetch fails", async () => {
  const adapter = {
    async toExchangeSymbol() {
      return "BTC-PERP";
    },
    marketApi: {
      async getTicker() {
        const error = new Error("connection reset by peer");
        (error as Error & { code?: string }).code = "ECONNRESET";
        (error as Error & { endpointFailures?: Array<Record<string, unknown>> }).endpointFailures = [
          {
            endpoint: "getAllMids",
            errorCategory: "network",
            retryCount: 2,
            message: "connection reset by peer"
          }
        ];
        (error as Error & { retryCount?: number }).retryCount = 2;
        (error as Error & { errorCategory?: string }).errorCategory = "network";
        throw error;
      }
    }
  } as any;

  const diagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, "BTCUSDT");

  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.errorCategory, "network");
  assert.deepEqual(diagnostic.attemptedSources, ["markPx", "mid"]);
  assert.equal(diagnostic.exchangeSymbol, "BTC-PERP");
  assert.equal(diagnostic.retryCount, 2);
  assert.equal(diagnostic.endpointFailures[0]?.endpoint, "getAllMids");
});

test("readMarkPriceDiagnosticFromAdapter captures symbol mapping failures as diagnostics", async () => {
  const adapter = {
    async toExchangeSymbol() {
      throw new Error("symbol_unknown:BTCUSDT");
    }
  } as any;

  const diagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, "BTCUSDT");

  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.errorCategory, "unknown");
  assert.equal(diagnostic.exchangeSymbol, "BTCUSDT");
  assert.deepEqual(diagnostic.attemptedSources, []);
  assert.match(String(diagnostic.endpointFailures[0]?.message ?? ""), /symbol_unknown/i);
});

test("readMarkPriceDiagnosticFromAdapter keeps snapshot availability when cached snapshot has no mark price", async () => {
  const adapter = {
    async toExchangeSymbol() {
      return "BTC-PERP";
    },
    getLatestTickerSnapshot() {
      return {
        symbol: "BTC-PERP",
        priceSource: "markPx",
        diagnostics: {
          usedCachedSnapshot: true,
          attemptedSources: ["markPx", "mid"]
        }
      };
    },
    marketApi: {
      async getTicker() {
        const error = new Error("live ticker unavailable");
        (error as Error & { errorCategory?: string }).errorCategory = "network";
        throw error;
      }
    }
  } as any;

  const diagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, "BTCUSDT");

  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.snapshotAvailable, true);
  assert.equal(diagnostic.snapshotSource, "cache");
  assert.equal(diagnostic.errorCategory, "network");
});

test("readMarkPriceDiagnosticFromAdapter marks live snapshot as available even when mark price is missing", async () => {
  const adapter = {
    async toExchangeSymbol() {
      return "BTC-PERP";
    },
    marketApi: {
      async getTicker() {
        return {
          symbol: "BTC-PERP",
          diagnostics: {
            attemptedSources: ["markPx", "mid"]
          }
        };
      }
    }
  } as any;

  const diagnostic = await readMarkPriceDiagnosticFromAdapter(adapter, "BTCUSDT");

  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.snapshotAvailable, true);
  assert.equal(diagnostic.snapshotSource, "live");
});

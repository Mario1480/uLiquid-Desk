import assert from "node:assert/strict";
import test from "node:test";
import { readMarkPriceDiagnosticFromAdapter } from "./futuresVenueRuntime.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import { createGridVenueContextResolver } from "./venueContext.js";

test("grid venue context prefers ticker mark and ignores cached non-positive price tick", async () => {
  let lastPriceCalls = 0;
  const resolve = createGridVenueContextResolver({
    db: {},
    logger: { warn() {} },
    normalizeExchangeValue(value: unknown) {
      return String(value ?? "").trim().toLowerCase();
    },
    resolveMarketDataTradingAccount: async () => ({
      selectedAccount: { exchange: "hyperliquid" } as any,
      marketDataAccount: { exchange: "hyperliquid" } as any
    }),
    createPerpMarketDataClient() {
      return {
        async getTicker() {
          return {
            symbol: "BTCUSDT",
            mark: 70123.4,
            last: 70001,
            bid: null,
            ask: null,
            ts: Date.now(),
            raw: null
          };
        },
        async getLastPrice() {
          lastPriceCalls += 1;
          return 69999;
        },
        async listSymbols() {
          return [
            {
              symbol: "BTCUSDT",
              exchangeSymbol: "BTC-PERP",
              status: "online",
              tradable: true,
              tickSize: null,
              stepSize: null,
              minQty: null,
              maxQty: null,
              minLeverage: null,
              maxLeverage: null,
              quoteAsset: "USDC",
              baseAsset: "BTC"
            }
          ];
        },
        async getCandles() {
          return [];
        },
        async getDepth() {
          return { bids: [], asks: [], ts: null, raw: null };
        },
        async getTrades() {
          return [];
        },
        async close() {}
      };
    },
    readGridVenueConstraintCache: async () => ({
      minQty: 0.001,
      qtyStep: 0.001,
      priceTick: 0,
      minNotionalUSDT: 5,
      feeRateTaker: 0.06,
      markPrice: 70000
    }),
    upsertGridVenueConstraintCache: async () => {}
  });

  const result = await resolve({
    userId: "user-1",
    exchangeAccountId: "account-1",
    symbol: "BTCUSDT"
  });

  assert.equal(result.markPrice, 70123.4);
  assert.equal(lastPriceCalls, 0);
  assert.equal(result.venueConstraints.minQty, 0.001);
  assert.equal(result.venueConstraints.qtyStep, 0.001);
  assert.equal(result.venueConstraints.priceTick, null);
  assert.equal(result.warnings.includes("constraints_cache_fallback_used"), true);
});

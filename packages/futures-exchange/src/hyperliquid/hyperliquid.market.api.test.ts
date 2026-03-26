import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";

function createSdk(params: {
  getAllMids: () => Promise<unknown>;
  getMetaAndAssetCtxs: () => Promise<unknown>;
}) {
  return {
    info: {
      getAllMids: params.getAllMids,
      getCandleSnapshot: async () => [],
      getL2Book: async () => ({}),
      perpetuals: {
        getMeta: async () => ({ universe: [] }),
        getMetaAndAssetCtxs: params.getMetaAndAssetCtxs
      }
    }
  } as any;
}

test("getTicker falls back to mids when meta/asset ctx fetch fails", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70000.5" }),
      getMetaAndAssetCtxs: async () => {
        throw new Error("temporary meta failure");
      }
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(ticker.markPrice, 70000.5);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.diagnostics.degraded, true);
  assert.equal(ticker.diagnostics.endpointFailures[0]?.endpoint, "getMetaAndAssetCtxs");
});

test("getTicker falls back to mid when markPx is empty", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70123.4" }),
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "", oraclePx: "69999.9" }]
      ]
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(ticker.markPrice, 70123.4);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.midPrice, 70123.4);
  assert.equal(ticker.indexPrice, 69999.9);
});

test("getTicker still succeeds when symbol is missing from asset contexts but mids are present", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ ETH: "3450.1" }),
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "70000", oraclePx: "69990" }]
      ]
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("ETHUSDT");

  assert.equal(ticker.coin, "ETH");
  assert.equal(ticker.markPrice, 3450.1);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.diagnostics.symbolFoundInAssetCtxs, false);
});

test("market reads retry transient timeouts and recover", async () => {
  let midCalls = 0;
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => {
        midCalls += 1;
        if (midCalls === 1) {
          const error = new Error("timed out");
          (error as Error & { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        return { BTC: "70200" };
      },
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "70210", oraclePx: "70205" }]
      ]
    }),
    { retryAttempts: 2, retryBaseDelayMs: 1, timeoutMs: 50 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(midCalls, 2);
  assert.equal(ticker.markPrice, 70210);
  assert.equal(ticker.priceSource, "markPx");
  assert.equal(ticker.diagnostics.retryCount, 1);
});

test("non-retryable client errors do not loop retries when mids already provide a price", async () => {
  let metaCalls = 0;
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70300" }),
      getMetaAndAssetCtxs: async () => {
        metaCalls += 1;
        const error = new Error("unauthorized");
        (error as Error & { status?: number }).status = 401;
        throw error;
      }
    }),
    { retryAttempts: 3, retryBaseDelayMs: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(metaCalls, 1);
  assert.equal(ticker.markPrice, 70300);
  assert.equal(ticker.diagnostics.endpointFailures[0]?.errorCategory, "client");
});

import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "./hyperliquid.adapter.js";

test("adapter market poll batches one snapshot for multiple ticker symbols", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`
  });

  let snapshotCalls = 0;
  let singleTickerCalls = 0;
  (adapter as any).marketApi.getMarketSnapshot = async () => {
    snapshotCalls += 1;
    return {
      fetchedAt: Date.now(),
      retryCount: 0,
      degraded: true,
      endpointFailures: [
        {
          endpoint: "getMetaAndAssetCtxs",
          errorCategory: "timeout",
          retryCount: 1,
          message: "temporary timeout"
        }
      ],
      usedCachedSnapshot: false,
      tickers: [
        {
          symbol: "BTC-PERP",
          coin: "BTC",
          lastPr: 70000,
          last: 70000,
          markPrice: 70010,
          indexPrice: 69990,
          bidPr: 70000,
          askPr: 70000,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 70000,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        },
        {
          symbol: "ETH-PERP",
          coin: "ETH",
          lastPr: 3500,
          last: 3500,
          markPrice: 3501,
          indexPrice: 3499,
          bidPr: 3500,
          askPr: 3500,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 3500,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        }
      ],
      tickersByCoin: new Map()
        .set("BTC", {
          symbol: "BTC-PERP",
          coin: "BTC",
          lastPr: 70000,
          last: 70000,
          markPrice: 70010,
          indexPrice: 69990,
          bidPr: 70000,
          askPr: 70000,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 70000,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        })
        .set("ETH", {
          symbol: "ETH-PERP",
          coin: "ETH",
          lastPr: 3500,
          last: 3500,
          markPrice: 3501,
          indexPrice: 3499,
          bidPr: 3500,
          askPr: 3500,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 3500,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        })
    };
  };
  (adapter as any).marketApi.getTicker = async () => {
    singleTickerCalls += 1;
    throw new Error("per-symbol getTicker should not be used inside batched poll");
  };

  (adapter as any).tickerSymbols.add("BTC-PERP");
  (adapter as any).tickerSymbols.add("ETH-PERP");
  const seenCoins: string[] = [];
  const detach = adapter.onTicker((payload) => {
    seenCoins.push(String(payload?.data?.[0]?.coin ?? ""));
  });

  await (adapter as any).runMarketPoll();

  assert.equal(snapshotCalls, 1);
  assert.equal(singleTickerCalls, 0);
  assert.deepEqual(seenCoins.sort(), ["BTC", "ETH"]);

  detach();
  await adapter.close();
});

test("adapter seeds perp asset map without sdk refresh", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`
  });

  (adapter as any).marketApi.getMetaAndAssetCtxs = async () => [
    {
      universe: [
        { name: "BTC", szDecimals: 3 },
        { name: "ETH", szDecimals: 3 }
      ]
    },
    []
  ];

  const symbolConversion = (adapter.sdk as any).symbolConversion;
  symbolConversion.initialized = false;
  symbolConversion.assetToIndexMap.clear();
  symbolConversion.exchangeToInternalNameMap.clear();
  symbolConversion.refreshAssetMaps = async () => {
    throw new Error("sdk refresh should not be used");
  };

  await (adapter as any).ensureSdkPerpAssetMapReady();

  assert.equal(symbolConversion.initialized, true);
  assert.equal(symbolConversion.assetToIndexMap.get("BTC-PERP"), 0);
  assert.equal(symbolConversion.assetToIndexMap.get("ETH-PERP"), 1);
  assert.equal(symbolConversion.exchangeToInternalNameMap.get("BTC"), "BTC-PERP");
  assert.equal(symbolConversion.exchangeToInternalNameMap.get("ETH"), "ETH-PERP");

  await adapter.close();
});

test("adapter placeOrder rejects clientOid-only acknowledgements", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`
  });

  (adapter as any).requireTradeableContract = async () => ({
    exchangeSymbol: "BTC",
    stepSize: 0.001,
    raw: { universe: { szDecimals: 3 } }
  });
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  (adapter as any).tradeApi.placeOrder = async () => ({
    clientOid: "grid-btc-1"
  });

  await assert.rejects(
    () => adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      qty: 0.01,
      price: 70000,
      clientOrderId: "grid-btc-1",
      marginMode: "cross"
    }),
    /hyperliquid_place_order_missing_order_id/
  );

  await adapter.close();
});

test("adapter cancelOrder supports corewriter cloid ids without symbol lookup", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let canceledOrderId: string | null = null;
  (adapter as any).tradeApi.cancelOrder = async ({ orderId }: any) => {
    canceledOrderId = orderId;
  };

  await adapter.cancelOrder("cloid:7:123456");

  assert.equal(canceledOrderId, "cloid:7:123456");
  await adapter.close();
});

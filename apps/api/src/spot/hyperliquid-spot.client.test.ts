import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidSpotClient } from "./hyperliquid-spot.client.js";

const originalFetch = globalThis.fetch;

function createClient(): HyperliquidSpotClient {
  return new HyperliquidSpotClient({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    vaultAddress: `0x${"3".repeat(40)}`,
    baseUrl: "https://api.hyperliquid.xyz"
  });
}

function mockSpotMeta() {
  return [
    {
      tokens: [
        { index: 0, name: "BTC", szDecimals: 6 },
        { index: 1, name: "USDC", szDecimals: 6 }
      ],
      universe: [
        {
          index: 7,
          name: "BTC/USDC",
          tokens: [0, 1]
        }
      ]
    },
    [{ midPx: "70000", markPx: "70010" }]
  ] as const;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("spot client seeds sdk asset map before placeOrder", async () => {
  const client = createClient();
  (client.sdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.sdk.info as any).getAllMids = async () => ({ "BTC-SPOT": "70000" });

  const symbolConversion = (client.sdk as any).symbolConversion;
  symbolConversion.initialized = false;
  symbolConversion.assetToIndexMap.clear();
  symbolConversion.exchangeToInternalNameMap.clear();
  symbolConversion.refreshAssetMaps = async () => {
    throw new Error("sdk refresh should not be used");
  };

  let placedCoin = "";
  (client.sdk.exchange as any).placeOrder = async (payload: Record<string, unknown>) => {
    placedCoin = String(payload.coin ?? "");
    return {
      response: {
        data: {
          statuses: [{ resting: { oid: 123 } }]
        }
      }
    };
  };

  const placed = await client.placeOrder({
    symbol: "BTCUSDC",
    side: "buy",
    type: "market",
    qty: 0.01
  });

  assert.equal(placed.orderId, "123");
  assert.equal(placedCoin, "BTC-SPOT");
  assert.equal(symbolConversion.initialized, true);
  assert.equal(symbolConversion.assetToIndexMap.get("BTC-SPOT"), 10007);
  assert.equal(symbolConversion.exchangeToInternalNameMap.get("BTC/USDC"), "BTC-SPOT");
});

test("spot client candles use direct info request without sdk symbol conversion", async () => {
  const client = createClient();
  (client.sdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.sdk.info as any).getCandleSnapshot = async () => {
    throw new Error("sdk candle path should not be used");
  };

  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify([
      { t: 1, o: "10", h: "12", l: "9", c: "11", v: "5" }
    ]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const candles = await client.getCandles({
    symbol: "BTCUSDC",
    timeframe: "1m",
    limit: 1
  });

  assert.deepEqual(candles, [
    { ts: 1, open: 10, high: 12, low: 9, close: 11, volume: 5 }
  ]);
  assert.equal(requestBody?.type, "candleSnapshot");
  assert.equal((requestBody?.req as Record<string, unknown>)?.coin, "BTC/USDC");
});

test("spot client falls back to signing wallet balances when configured vault read is empty", async () => {
  const client = createClient();
  const requestedAddresses: string[] = [];
  (client.sdk.info.spot as any).getSpotClearinghouseState = async (address: string) => {
    requestedAddresses.push(address);
    if (address === `0x${"3".repeat(40)}`) {
      return { balances: [] };
    }
    return {
      balances: [
        { coin: "USDC", total: "55", hold: "0" }
      ]
    };
  };

  const summary = await client.getSummary("USDC");

  assert.deepEqual(requestedAddresses, [`0x${"3".repeat(40)}`, `0x${"1".repeat(40)}`]);
  assert.equal(summary.equity, 55);
  assert.equal(summary.available, 55);
  assert.equal(summary.currency, "USDC");
});

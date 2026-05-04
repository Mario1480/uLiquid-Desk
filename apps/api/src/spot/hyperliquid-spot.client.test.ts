import assert from "node:assert/strict";
import test from "node:test";
import { clearHyperliquidReadCoordinatorForTests } from "@mm/futures-exchange";
import {
  clearHyperliquidSpotClientCachesForTests,
  HyperliquidSpotClient
} from "./hyperliquid-spot.client.js";

const originalFetch = globalThis.fetch;

function createClient(params?: {
  apiKey?: string;
  vaultAddress?: string;
}): HyperliquidSpotClient {
  return new HyperliquidSpotClient({
    apiKey: params?.apiKey ?? `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    vaultAddress: params?.vaultAddress ?? `0x${"3".repeat(40)}`,
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
  clearHyperliquidReadCoordinatorForTests();
  clearHyperliquidSpotClientCachesForTests();
});

test("spot client seeds sdk asset map before placeOrder", async () => {
  const client = createClient();
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
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

test("spot client surfaces explicit spot order rejects", async () => {
  const client = createClient();
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.sdk.info as any).getAllMids = async () => ({ "BTC-SPOT": "70000" });
  (client.sdk.exchange as any).placeOrder = async () => ({
    status: "err",
    response: "Vault not registered: 0x3333333333333333333333333333333333333333"
  });

  await assert.rejects(
    () => client.placeOrder({
      symbol: "BTCUSDC",
      side: "buy",
      type: "market",
      qty: 0.01
    }),
    (error: unknown) => {
      assert.equal(
        (error as Error).message,
        "hyperliquid_spot_order_rejected:Vault not registered: 0x3333333333333333333333333333333333333333"
      );
      return true;
    }
  );
});

test("spot client candles use direct info request without sdk symbol conversion", async () => {
  const client = createClient();
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
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

test("spot client open orders use direct info reads without sdk symbol conversion", async () => {
  const client = createClient({
    apiKey: `0x${"3".repeat(40)}`,
    vaultAddress: `0x${"3".repeat(40)}`
  });
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.sdk.info as any).getUserOpenOrders = async () => {
    throw new Error("sdk open orders path should not be used");
  };

  const requestTypes: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    requestTypes.push(String(body.type ?? ""));
    assert.equal(body.type, "openOrders");
    assert.equal(body.user, `0x${"3".repeat(40)}`);
    return new Response(JSON.stringify([
      {
        oid: 123,
        coin: "BTC/USDC",
        side: "B",
        limitPx: "70000",
        sz: "0.01",
        timestamp: 1710000000000
      },
      {
        oid: 124,
        coin: "@7",
        side: "A",
        limitPx: "71000",
        sz: "0.02",
        timestamp: 1710000001000
      }
    ]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const rows = await client.getOpenOrders("BTCUSDC");

  assert.deepEqual(requestTypes, ["openOrders"]);
  assert.deepEqual(rows.map((row) => ({
    orderId: row.orderId,
    symbol: row.symbol,
    side: row.side,
    price: row.price,
    qty: row.qty
  })), [
    { orderId: "123", symbol: "BTCUSDC", side: "buy", price: 70000, qty: 0.01 },
    { orderId: "124", symbol: "BTCUSDC", side: "sell", price: 71000, qty: 0.02 }
  ]);
});

test("spot client balances fall back to direct info when sdk spot state is opaque", async () => {
  const client = createClient();
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async () => {
    throw new Error("An unknown error occurred");
  };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(body.type, "spotClearinghouseState");
    assert.equal(body.user, `0x${"3".repeat(40)}`);
    return new Response(JSON.stringify({
      balances: [
        { coin: "USDC", total: "12.5", hold: "1.5" }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const summary = await client.getSummary("USDC");

  assert.equal(summary.equity, 12.5);
  assert.equal(summary.available, 11);
  assert.equal(summary.currency, "USDC");
});

test("spot client does not retry rate-limited spot state through direct info", async () => {
  const client = createClient();
  (client.readSdk.info as any).getUserRole = async () => null;
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async () => {
    const error = new Error("hyperliquid_info_request_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };

  let directInfoCalls = 0;
  globalThis.fetch = (async () => {
    directInfoCalls += 1;
    return new Response(JSON.stringify({ balances: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  await assert.rejects(
    () => client.getSummary("USDC"),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 429);
      assert.equal((error as { code?: string }).code, "EX_RATE_LIMIT");
      return true;
    }
  );
  assert.equal(directInfoCalls, 0);
});

test("spot client reuses cached balances when a fallback read is rate limited", async () => {
  const firstClient = createClient();
  (firstClient.readSdk.info as any).getUserRole = async () => null;
  (firstClient.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (firstClient.readSdk.info.spot as any).getSpotClearinghouseState = async (address: string) => {
    if (address.toLowerCase() === `0x${"3".repeat(40)}`) {
      return { balances: [] };
    }
    return {
      balances: [
        { coin: "USDC", total: "55", hold: "0" }
      ]
    };
  };

  const firstSummary = await firstClient.getSummary("USDC");
  assert.equal(firstSummary.equity, 55);

  clearHyperliquidReadCoordinatorForTests();

  const secondClient = createClient();
  (secondClient.readSdk.info as any).getUserRole = async () => null;
  (secondClient.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (secondClient.readSdk.info.spot as any).getSpotClearinghouseState = async (address: string) => {
    if (address.toLowerCase() === `0x${"3".repeat(40)}`) {
      return { balances: [] };
    }
    const error = new Error("hyperliquid_info_request_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };

  let directInfoCalls = 0;
  globalThis.fetch = (async () => {
    directInfoCalls += 1;
    return new Response(JSON.stringify({ balances: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const secondSummary = await secondClient.getSummary("USDC");

  assert.equal(secondSummary.equity, 55);
  assert.equal(secondSummary.available, 55);
  assert.equal(secondSummary.currency, "USDC");
  assert.equal(directInfoCalls, 0);
});

test("spot client falls back to signing wallet balances when configured vault read is empty", async () => {
  const client = createClient();
  const requestedAddresses: string[] = [];
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async (address: string) => {
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

test("spot client reads balances from nested spotState payloads", async () => {
  const client = createClient({
    apiKey: `0x${"4".repeat(40)}`,
    vaultAddress: `0x${"5".repeat(40)}`
  });
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async () => ({
    spotState: {
      balances: [
        { coin: "USDC", total: "42.5", hold: "2.5" }
      ]
    }
  });

  const summary = await client.getSummary("USDC");

  assert.equal(summary.equity, 42.5);
  assert.equal(summary.available, 40);
  assert.equal(summary.currency, "USDC");
});

test("spot client resolves token-index balances through spot metadata", async () => {
  const client = createClient();
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => ([
    {
      tokens: [
        { index: 0, name: "USDC", szDecimals: 6 }
      ],
      universe: []
    },
    []
  ]);
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async () => ({
    tokenBalances: [
      { token: 0, balance: "77.25", hold: "1.25" }
    ]
  });

  const summary = await client.getSummary("USDC");

  assert.equal(summary.equity, 77.25);
  assert.equal(summary.available, 76);
  assert.equal(summary.currency, "USDC");
});

test("spot client falls back to agent master account balances", async () => {
  const client = createClient({
    apiKey: `0x${"6".repeat(40)}`,
    vaultAddress: `0x${"7".repeat(40)}`
  });
  const requestedAddresses: string[] = [];
  (client.readSdk.info as any).getUserRole = async (address: string) => ({
    role: address.toLowerCase() === `0x${"6".repeat(40)}` ? "agent" : "user",
    data: { user: `0x${"8".repeat(40)}` }
  });
  (client.readSdk.info.spot as any).getSpotMetaAndAssetCtxs = async () => mockSpotMeta();
  (client.readSdk.info.spot as any).getSpotClearinghouseState = async (address: string) => {
    requestedAddresses.push(address.toLowerCase());
    if (address.toLowerCase() === `0x${"8".repeat(40)}`) {
      return {
        balances: [
          { coin: "USDC", total: "5.378497", hold: "0" }
        ]
      };
    }
    return { balances: [] };
  };

  const summary = await client.getSummary("USDC");

  assert.deepEqual(requestedAddresses, [
    `0x${"7".repeat(40)}`,
    `0x${"8".repeat(40)}`
  ]);
  assert.equal(summary.equity, 5.378497);
  assert.equal(summary.available, 5.378497);
  assert.equal(summary.currency, "USDC");
});

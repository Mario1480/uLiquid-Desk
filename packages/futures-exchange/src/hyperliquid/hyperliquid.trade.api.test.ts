import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";
import { HyperliquidCoreWriterClient } from "./hyperliquid.corewriter.js";
import { clearHyperliquidReadCoordinatorForTests } from "./hyperliquid.read-coordinator.js";

beforeEach(() => {
  clearHyperliquidReadCoordinatorForTests();
});

afterEach(() => {
  clearHyperliquidReadCoordinatorForTests();
});

test("placeOrder uses hardened market ticker path for Hyperliquid market orders", async () => {
  const placedOrders: any[] = [];
  const api = new HyperliquidTradeApi(
    {
      info: {
        getAllMids: async () => {
          throw new Error("legacy mid path should not be used when market api is available");
        }
      },
      exchange: {
        async placeOrder(order: unknown) {
          placedOrders.push(order);
          return { orderId: "12345" };
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true,
    {
      async getTicker() {
        return {
          markPrice: 100,
          midPrice: 99.5,
          lastPr: 100,
          last: 100,
          indexPrice: 99.8
        } as any;
      }
    }
  );

  const result = await api.placeOrder({
    symbol: "BTC-PERP",
    side: "buy",
    orderType: "market",
    size: "1",
    szDecimals: 3,
    reduceOnly: "NO"
  });

  assert.equal(result.orderId, "12345");
  assert.equal(placedOrders.length, 1);
  assert.equal(placedOrders[0]?.limit_px, "100.3");
});

test("placeOrder surfaces venue rejection when no oid is returned", async () => {
  const api = new HyperliquidTradeApi(
    {
      exchange: {
        async placeOrder() {
          return {
            response: {
              data: {
                statuses: [
                  {
                    error: "User or API Wallet 0xabc is not registered"
                  }
                ]
              }
            }
          };
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true
  );

  await assert.rejects(
    () =>
      api.placeOrder({
        symbol: "BTC-PERP",
        side: "buy",
        orderType: "limit",
        size: "1",
        price: "100",
        szDecimals: 3,
        reduceOnly: "NO"
      }),
    /hyperliquid_order_rejected:User or API Wallet 0xabc is not registered/
  );
});

test("placeOrder uses corewriter path when configured", async () => {
  const coreWriter = {
    async placeLimitOrder(input: any) {
      return {
        status: "confirmed",
        submitted: true,
        confirmationSource: "receipt",
        receiptStatus: "success",
        orderId: `cloid:${input.asset}:123`,
        clientOrderId: input.clientOrderId,
        txHash: `0x${"a".repeat(64)}`
      };
    }
  } as unknown as HyperliquidCoreWriterClient;
  const api = new HyperliquidTradeApi(
    {
      exchange: {
        async placeOrder() {
          throw new Error("legacy exchange path should not be used");
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true,
    undefined,
    coreWriter
  );

  const result = await api.placeOrder({
    symbol: "BTC-PERP",
    assetIndex: 7,
    side: "buy",
    orderType: "limit",
    size: "0.001",
    price: "66600",
    szDecimals: 3,
    clientOid: "grid-btc-1",
    reduceOnly: "NO"
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.orderId, "cloid:7:123");
  assert.equal(result.clientOrderId, "grid-btc-1");
});

test("placeOrder maps corewriter market orders to deployed-vault compatible GTC tif", async () => {
  const coreWriterCalls: any[] = [];
  const coreWriter = {
    async placeLimitOrder(input: any) {
      coreWriterCalls.push(input);
      return {
        status: "confirmed",
        submitted: true,
        confirmationSource: "receipt",
        receiptStatus: "success",
        orderId: `cloid:${input.asset}:123`,
        clientOrderId: input.clientOrderId,
        txHash: `0x${"a".repeat(64)}`
      };
    }
  } as unknown as HyperliquidCoreWriterClient;
  const api = new HyperliquidTradeApi(
    {
      exchange: {
        async placeOrder() {
          throw new Error("legacy exchange path should not be used");
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true,
    {
      async getTicker() {
        return { markPrice: "66600" };
      }
    } as any,
    coreWriter
  );

  await api.placeOrder({
    symbol: "BTC-PERP",
    assetIndex: 7,
    side: "buy",
    orderType: "market",
    size: "0.001",
    szDecimals: 3,
    clientOid: "grid-btc-market-1",
    reduceOnly: "NO"
  });

  assert.equal(coreWriterCalls.length, 1);
  assert.equal(coreWriterCalls[0]?.encodedTif, 2);
});

test("placeOrder returns the generated effective clientOid on the corewriter path when caller omits one", async () => {
  const coreWriterCalls: any[] = [];
  const api = new HyperliquidTradeApi(
    {
      exchange: {
        async placeOrder() {
          throw new Error("legacy exchange path should not be used");
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true,
    undefined,
    {
      async placeLimitOrder(input: any) {
        coreWriterCalls.push(input);
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          orderId: `cloid:${input.asset}:123`,
          clientOrderId: input.clientOrderId,
          txHash: `0x${"c".repeat(64)}`
        };
      }
    } as unknown as HyperliquidCoreWriterClient
  );

  const result = await api.placeOrder({
    symbol: "BTC-PERP",
    assetIndex: 7,
    side: "buy",
    orderType: "limit",
    size: "0.001",
    price: "66600",
    szDecimals: 3,
    reduceOnly: "NO"
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.orderId, "cloid:7:123");
  assert.match(String(result.clientOrderId ?? ""), /^utrade-\d+-[a-z0-9]+$/);
  assert.equal(coreWriterCalls.length, 1);
  assert.equal(coreWriterCalls[0]?.clientOrderId, result.clientOrderId);
});

test("placeOrder normalizes price and size precision before sending to corewriter", async () => {
  const calls: any[] = [];
  const coreWriter = {
    async placeLimitOrder(input: any) {
      calls.push(input);
      return {
        status: "confirmed",
        submitted: true,
        confirmationSource: "receipt",
        receiptStatus: "success",
        orderId: `cloid:${input.asset}:123`,
        clientOrderId: input.clientOrderId,
        txHash: `0x${"b".repeat(64)}`
      };
    }
  } as unknown as HyperliquidCoreWriterClient;
  const api = new HyperliquidTradeApi(
    {
      exchange: {
        async placeOrder() {
          throw new Error("legacy exchange path should not be used");
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true,
    undefined,
    coreWriter
  );

  await api.placeOrder({
    symbol: "BTC-PERP",
    assetIndex: 0,
    side: "buy",
    orderType: "limit",
    size: "0.003319",
    price: "66435.71123",
    clientOid: "grid-btc-precision",
    szDecimals: 5,
    reduceOnly: "NO"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.limitPx, 66435);
  assert.equal(calls[0]?.sz, 0.00331);
});

test("getPendingOrders preserves clientOid and cloid from frontend open orders", async () => {
  const api = new HyperliquidTradeApi(
    {
      info: {
        async getFrontendOpenOrders() {
          return [{
            oid: 98123,
            coin: "BTC",
            limitPx: "67500",
            sz: "0.001",
            side: "B",
            orderType: "limit",
            timestamp: 1710000000000,
            reduceOnly: false,
            isTrigger: false,
            clientOid: "grid-btc-live-1",
            cloid: "208456784328589790982014142665896995042"
          }];
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true
  );

  const rows = await api.getPendingOrders();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.orderId, "98123");
  assert.equal(rows[0]?.clientOid, "grid-btc-live-1");
  assert.equal(rows[0]?.cloid, "208456784328589790982014142665896995042");
});

test("getPendingOrders paginates by numeric oid and idLessThan cursor", async () => {
  const api = new HyperliquidTradeApi(
    {
      info: {
        async getFrontendOpenOrders() {
          return [
            {
              oid: 98100,
              coin: "BTC",
              limitPx: "67500",
              sz: "0.001",
              side: "B",
              orderType: "limit",
              timestamp: 1710000000000,
              reduceOnly: false,
              isTrigger: false
            },
            {
              oid: 98050,
              coin: "BTC",
              limitPx: "67400",
              sz: "0.001",
              side: "B",
              orderType: "limit",
              timestamp: 1710000000000,
              reduceOnly: false,
              isTrigger: false
            },
            {
              oid: 98105,
              coin: "BTC",
              limitPx: "67600",
              sz: "0.001",
              side: "B",
              orderType: "limit",
              timestamp: 1710000000000,
              reduceOnly: false,
              isTrigger: false
            }
          ];
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true
  );

  const firstPage = await api.getPendingOrders({ pageSize: 2 });
  const secondPage = await api.getPendingOrders({ pageSize: 2, idLessThan: "98100" });

  assert.deepEqual(
    firstPage.map((row) => row.orderId),
    ["98105", "98100"]
  );
  assert.deepEqual(
    secondPage.map((row) => row.orderId),
    ["98050"]
  );
});

test("getPendingOrders keeps coins already returned as *-PERP in internal perp format", async () => {
  const api = new HyperliquidTradeApi(
    {
      info: {
        async getFrontendOpenOrders() {
          return [{
            oid: 98124,
            coin: "BTC-PERP",
            limitPx: "67500",
            sz: "0.001",
            side: "B",
            orderType: "limit",
            timestamp: 1710000000000,
            reduceOnly: false,
            isTrigger: false
          }];
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true
  );

  const rows = await api.getPendingOrders();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "BTC-PERP");
});

test("getPendingOrders falls back to direct info reads when sdk open-order reads fail", async () => {
  const previousFetch = globalThis.fetch;
  const api = new HyperliquidTradeApi(
    {
      info: {
        async getFrontendOpenOrders() {
          throw new Error("sdk unavailable");
        }
      }
    } as any,
    "0x1111111111111111111111111111111111111111",
    true
  );

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          oid: 98123,
          coin: "BTC",
          limitPx: "67500",
          sz: "0.001",
          side: "B",
          orderType: "limit",
          timestamp: 1710000000000,
          reduceOnly: false,
          isTrigger: false,
          clientOid: "grid-btc-live-1",
          cloid: "208456784328589790982014142665896995042"
        }
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    ) as any;

  try {
    const rows = await api.getPendingOrders();
    assert.equal(rows[0]?.orderId, "98123");
    assert.equal(rows[0]?.clientOid, "grid-btc-live-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";
import { HyperliquidCoreWriterClient } from "./hyperliquid.corewriter.js";

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
        orderId: `cloid:${input.asset}:123`,
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
    clientOid: "grid-btc-1",
    reduceOnly: "NO"
  });

  assert.equal(result.orderId, "cloid:7:123");
});

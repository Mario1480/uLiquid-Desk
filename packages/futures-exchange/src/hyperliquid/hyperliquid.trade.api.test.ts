import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";

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

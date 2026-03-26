import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidPositionApi } from "./hyperliquid.position.api.js";

test("positions use the same preferred markPx semantics as ticker snapshots", async () => {
  const marketApi = {
    getMarketSnapshot: async () => ({
      tickersByCoin: new Map([
        [
          "BTC",
          {
            markPrice: 70250,
            priceSource: "markPx"
          }
        ]
      ])
    })
  } as any;

  const sdk = {
    info: {
      getAllMids: async () => ({ BTC: "70000" }),
      perpetuals: {
        getClearinghouseState: async () => ({
          assetPositions: [
            {
              position: {
                coin: "BTC",
                szi: "0.5",
                entryPx: "69000",
                unrealizedPnl: "625",
                leverage: {
                  value: "5",
                  type: "cross"
                }
              }
            }
          ]
        })
      }
    }
  } as any;

  const api = new HyperliquidPositionApi(sdk, "0xabc", marketApi);
  const positions = await api.getAllPositions();

  assert.equal(positions[0]?.markPrice, "70250");
  assert.equal(positions[0]?.markPriceSource, "markPx");
});

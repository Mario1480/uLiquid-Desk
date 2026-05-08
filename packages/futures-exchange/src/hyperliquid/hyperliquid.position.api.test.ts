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
                },
                marginUsed: "6900",
                positionValue: "35125",
                liquidationPx: "55200",
                returnOnEquity: "0.0905797101"
              }
            }
          ]
        })
      }
    }
  } as any;

  const api = new HyperliquidPositionApi(sdk, "0x1111111111111111111111111111111111111111", marketApi);
  const positions = await api.getAllPositions();

  assert.equal(positions[0]?.markPrice, "70250");
  assert.equal(positions[0]?.markPriceSource, "markPx");
  assert.equal(positions[0]?.marginUsed, "6900");
  assert.equal(positions[0]?.positionValue, "35125");
  assert.equal(positions[0]?.liquidationPrice, "55200");
  assert.equal(positions[0]?.returnOnEquity, "0.0905797101");
});

test("positions fall back to direct info reads when sdk clearinghouse reads fail", async () => {
  const previousFetch = globalThis.fetch;
  const sdk = {
    info: {
      getAllMids: async () => ({ BTC: "70000" }),
      perpetuals: {
        getClearinghouseState: async () => {
          throw new Error("sdk unavailable");
        }
      }
    }
  } as any;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        marginSummary: { accountValue: "105" },
        crossMarginSummary: { accountValue: "105" },
        withdrawable: "105",
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
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    ) as any;

  try {
    const api = new HyperliquidPositionApi(sdk, "0x1111111111111111111111111111111111111111");
    const positions = await api.getAllPositions();
    assert.equal(positions[0]?.symbol, "BTCUSDC");
    assert.equal(positions[0]?.total, "0.5");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

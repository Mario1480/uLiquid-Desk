import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidAccountApi } from "./hyperliquid.account.api.js";

test("account api falls back to direct info reads when sdk clearinghouse reads fail", async () => {
  const previousFetch = globalThis.fetch;
  const sdk = {
    info: {
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
        assetPositions: []
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    ) as any;

  try {
    const api = new HyperliquidAccountApi(sdk, "0x1111111111111111111111111111111111111111");
    const rows = await api.getAccounts();
    assert.equal(rows[0]?.accountEquity, "105");
    assert.equal(rows[0]?.available, "105");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

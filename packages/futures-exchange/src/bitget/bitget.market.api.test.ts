import assert from "node:assert/strict";
import test from "node:test";
import { BitgetMarketApi } from "./bitget.market.api.js";
import type { BitgetRestClient } from "./bitget.rest.js";

test("public funding and open-interest reads use the verified Bitget V2 contracts", async () => {
  const calls: Array<{ method: string; endpoint: string; query?: Record<string, unknown> }> = [];
  const rest = {
    async requestPublic(method: string, endpoint: string, query?: Record<string, unknown>) {
      calls.push({ method, endpoint, query });
      return [];
    }
  } as unknown as BitgetRestClient;
  const market = new BitgetMarketApi(rest);

  await market.getFundingRate("BTCUSDT");
  await market.getOpenInterest("BTCUSDT");

  assert.deepEqual(calls, [
    {
      method: "GET",
      endpoint: "/api/v2/mix/market/current-fund-rate",
      query: { symbol: "BTCUSDT", productType: "USDT-FUTURES" }
    },
    {
      method: "GET",
      endpoint: "/api/v2/mix/market/open-interest",
      query: { symbol: "BTCUSDT", productType: "USDT-FUTURES" }
    }
  ]);
});

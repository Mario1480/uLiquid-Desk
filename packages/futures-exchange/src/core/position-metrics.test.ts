import assert from "node:assert/strict";
import test from "node:test";
import { buildPositionRiskMetrics, pickFiniteNumber } from "./position-metrics.js";
import { BingxFuturesAdapter } from "../bingx/bingx.adapter.js";
import { BingxAccountApi } from "../bingx/bingx.account.api.js";

test("shared metrics preserve zero separately from missing liquidation data", () => {
  for (const reported of [0, "0.0", null, undefined]) {
    const result = buildPositionRiskMetrics({ side: "long", markPrice: 100, liquidationPrice: pickFiniteNumber(reported) });
    assert.equal(result.liquidationPrice, reported == null ? null : 0);
    assert.equal(result.liquidationDistancePct, null);
  }
});

test("native BingX position reads preserve numeric and string zeros through listPositions", async () => {
  // Avoid constructor warmup: this fixture uses only the real read mapper and no network.
  const adapter = Object.create(BingxFuturesAdapter.prototype) as BingxFuturesAdapter;
  Object.assign(adapter, {
    contractCache: { refresh: async () => {} },
    accountApi: new BingxAccountApi({ requestPrivate: async (request: any) => {
      assert.equal(request.method, "GET");
      assert.equal(request.endpoint, "/openApi/swap/v2/user/positions");
      return [0, "0.0", null, undefined, 98].map((liquidationPrice, i) => ({
        symbol: `FIXTURE${i}-USDT`, positionSide: "LONG", positionAmt: "1", avgPrice: "100", markPrice: "100", liquidationPrice
      }));
    } } as any),
    tradeApi: { getOpenOrders: async () => [] }
  });
  const positions = await adapter.listPositions();
  assert.equal(positions.length, 5);
  assert.deepEqual(positions.map(p => p.liquidationPrice), [0, 0, null, null, 98]);
  assert.deepEqual(positions.map(p => p.liquidationDistancePct), [null, null, null, null, 2]);
});

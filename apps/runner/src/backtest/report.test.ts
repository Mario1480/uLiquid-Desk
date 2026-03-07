import assert from "node:assert/strict";
import test from "node:test";
import { buildBacktestKpi } from "./report.js";

test("buildBacktestKpi computes pnl and trade stats", () => {
  const result = buildBacktestKpi({
    initialEquityUsd: 10_000,
    finalEquityUsd: 10_250,
    trades: [
      {
        id: "t1",
        side: "long",
        entryTs: 1,
        exitTs: 2,
        entryPrice: 100,
        exitPrice: 101,
        qty: 1,
        feeUsd: 0.1,
        slippageUsd: 0.05,
        pnlUsd: 0.85
      },
      {
        id: "t2",
        side: "short",
        entryTs: 3,
        exitTs: 4,
        entryPrice: 102,
        exitPrice: 103,
        qty: 1,
        feeUsd: 0.1,
        slippageUsd: 0.05,
        pnlUsd: -1.15
      }
    ],
    equityCurve: [
      { ts: 1, equityUsd: 10_000 },
      { ts: 2, equityUsd: 10_100 },
      { ts: 3, equityUsd: 9_950 },
      { ts: 4, equityUsd: 10_250 }
    ]
  });

  assert.equal(result.tradeCount, 2);
  assert.equal(result.pnlUsd, 250);
  assert.equal(result.winratePct, 50);
  assert.equal(result.maxDrawdownPct, 1.4851);
});


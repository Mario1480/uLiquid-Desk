import assert from "node:assert/strict";
import test from "node:test";

import { buildGridCycles } from "../../components/grid/utils.js";
import type { GridFillsResponse } from "../../components/grid/types.js";

function fill(input: GridFillsResponse["items"][number]): GridFillsResponse["items"][number] {
  return input;
}

test("buildGridCycles matches a later rebalance sell against an earlier seed buy on the same leg", () => {
  const cycles = buildGridCycles([
    fill({
      id: "seed-buy",
      exchangeOrderId: "378704919477",
      clientOrderId: null,
      fillPrice: 71057,
      fillQty: 0.00074,
      fillNotionalUsd: 52.58218,
      feeUsd: 0.023661,
      side: "buy",
      gridLeg: "long",
      gridIndex: 0,
      fillTs: "2026-04-12T13:28:21.562Z",
      rawJson: null
    }),
    fill({
      id: "rebalance-sell",
      exchangeOrderId: "378705918351",
      clientOrderId: "grid-cmnvs2ezo00ewt91x8t3jwrvj-long-12",
      fillPrice: 72000,
      fillQty: 0.00015,
      fillNotionalUsd: 10.8,
      feeUsd: 0.001619,
      side: "sell",
      gridLeg: "long",
      gridIndex: 12,
      fillTs: "2026-04-13T14:46:31.648Z",
      rawJson: { intentType: "rebalance" }
    })
  ]);

  const completed = cycles.filter((row) => row.closeFill);
  const open = cycles.filter((row) => !row.closeFill);

  assert.equal(completed.length, 1);
  assert.equal(open.length, 1);
  assert.equal(completed[0]?.openFill.id, "seed-buy");
  assert.equal(completed[0]?.closeFill?.id, "rebalance-sell");
  assert.ok(Number(completed[0]?.realizedPnlUsd ?? 0) > 0.13);
  assert.equal(open[0]?.openFill.id, "seed-buy");
});

test("buildGridCycles fallback matching never crosses grid legs", () => {
  const cycles = buildGridCycles([
    fill({
      id: "short-seed",
      exchangeOrderId: "1",
      clientOrderId: null,
      fillPrice: 72000,
      fillQty: 0.0002,
      fillNotionalUsd: 14.4,
      feeUsd: 0.002,
      side: "sell",
      gridLeg: "short",
      gridIndex: 12,
      fillTs: "2026-04-13T10:00:00.000Z",
      rawJson: { intentType: "entry" }
    }),
    fill({
      id: "long-rebalance",
      exchangeOrderId: "2",
      clientOrderId: "grid-long-12",
      fillPrice: 72000,
      fillQty: 0.00015,
      fillNotionalUsd: 10.8,
      feeUsd: 0.001,
      side: "sell",
      gridLeg: "long",
      gridIndex: 12,
      fillTs: "2026-04-13T11:00:00.000Z",
      rawJson: { intentType: "rebalance" }
    })
  ]);

  assert.equal(cycles.filter((row) => row.closeFill).length, 0);
  assert.equal(cycles.filter((row) => !row.closeFill).length, 2);
});

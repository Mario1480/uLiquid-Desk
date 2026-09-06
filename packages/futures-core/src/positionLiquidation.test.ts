import assert from "node:assert/strict";
import test from "node:test";
import { normalizePositionLiquidation } from "./positionLiquidation.js";

test("reported zero prices survive normalization without invented distance", () => {
  for (const side of ["long", "short"] as const) {
    for (const liquidationPrice of [0, "0", "0.0"]) {
      assert.deepEqual(normalizePositionLiquidation({ side, markPrice: 100, liquidationPrice, liquidationDistancePct: 0 }), {
        liquidationPrice: 0, liquidationDistancePct: null
      });
    }
  }
});

test("missing and invalid prices and distances are not coerced to zero", () => {
  for (const value of [null, undefined, "", " ", NaN, Infinity, "invalid", false, [], {}]) {
    assert.deepEqual(normalizePositionLiquidation({ side: "long", markPrice: 100, liquidationPrice: value, liquidationDistancePct: value }), {
      liquidationPrice: null, liquidationDistancePct: null
    });
  }
  assert.equal(normalizePositionLiquidation({ side: "long", liquidationPrice: -1 }).liquidationPrice, null);
});

test("positive liquidation prices retain genuine zero, near, and breached distances", () => {
  for (const side of ["long", "short"] as const) {
    assert.equal(normalizePositionLiquidation({ side, markPrice: 100, liquidationPrice: 100 }).liquidationDistancePct, 0);
    assert.equal(normalizePositionLiquidation({ side, markPrice: 100, liquidationPrice: side === "long" ? 96 : 104 }).liquidationDistancePct, 4);
    assert.equal(normalizePositionLiquidation({ side, markPrice: 100, liquidationPrice: side === "long" ? 104 : 96 }).liquidationDistancePct, -4);
    assert.equal(normalizePositionLiquidation({ side, markPrice: null, liquidationPrice: 100 }).liquidationDistancePct, null);
  }
});

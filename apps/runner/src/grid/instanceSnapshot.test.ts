import assert from "node:assert/strict";
import test from "node:test";
import { resolveGridCoreSnapshot } from "./instanceSnapshot.js";

test("resolveGridCoreSnapshot prefers the bot snapshot over later template changes", () => {
  const resolved = resolveGridCoreSnapshot({
    botParamsJson: {
      grid: {
        mode: "cross",
        gridMode: "geometric",
        lowerPrice: 50000,
        upperPrice: 90000,
        gridCount: 9,
        crossSideConfig: {
          long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
          short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 }
        }
      }
    },
    template: {
      mode: "long",
      gridMode: "arithmetic",
      lowerPrice: 61000,
      upperPrice: 78000,
      gridCount: 22,
      crossLongLowerPrice: 61000,
      crossLongUpperPrice: 69000,
      crossLongGridCount: 8,
      crossShortLowerPrice: 72000,
      crossShortUpperPrice: 78000,
      crossShortGridCount: 11
    }
  });

  assert.deepEqual(resolved, {
    mode: "cross",
    gridMode: "geometric",
    lowerPrice: 50000,
    upperPrice: 90000,
    gridCount: 9,
    crossSideConfig: {
      long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 }
    }
  });
});

test("resolveGridCoreSnapshot falls back to template data for legacy bots without a stored snapshot", () => {
  const resolved = resolveGridCoreSnapshot({
    botParamsJson: {},
    template: {
      mode: "neutral",
      gridMode: "arithmetic",
      lowerPrice: 60000,
      upperPrice: 80000,
      gridCount: 20
    }
  });

  assert.deepEqual(resolved, {
    mode: "neutral",
    gridMode: "arithmetic",
    lowerPrice: 60000,
    upperPrice: 80000,
    gridCount: 20,
    crossSideConfig: null
  });
});

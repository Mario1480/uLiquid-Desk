import assert from "node:assert/strict";
import test from "node:test";
import { resolvePositiveMarkPrice, usesPreviewMarkPriceFallback } from "./previewComputation.js";

test("usesPreviewMarkPriceFallback is false when an explicit mark price override is provided", () => {
  assert.equal(usesPreviewMarkPriceFallback({
    override: 101.25,
    venueMarkPrice: 0
  }), false);
});

test("usesPreviewMarkPriceFallback is false when venue mark price is available", () => {
  assert.equal(usesPreviewMarkPriceFallback({
    override: null,
    venueMarkPrice: 99.5
  }), false);
});

test("usesPreviewMarkPriceFallback is true when neither override nor venue mark price is usable", () => {
  assert.equal(usesPreviewMarkPriceFallback({
    override: null,
    venueMarkPrice: 0
  }), true);
});

test("resolvePositiveMarkPrice falls back to the grid midpoint when venue mark price is unavailable", () => {
  assert.equal(resolvePositiveMarkPrice({
    override: null,
    venueMarkPrice: 0,
    lowerPrice: 90,
    upperPrice: 110
  }), 100);
});

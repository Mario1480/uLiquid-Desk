import assert from "node:assert/strict";
import test from "node:test";
import { deriveNeutralModePreviewHints } from "./neutralModeHints";

test("deriveNeutralModePreviewHints returns neutral-specific hints and fallback mark notice", () => {
  const result = deriveNeutralModePreviewHints({
    template: {
      mode: "neutral",
      initialSeedEnabled: true,
    },
    preview: {
      warnings: ["preview_mark_price_fallback_used"],
      initialSeed: {
        enabled: true,
        seedSide: "sell",
      },
    },
  });

  assert.deepEqual(result, {
    show: true,
    symmetric: true,
    fullBudgetOneWay: true,
    seedDirectionDependsOnMark: true,
    syntheticMarkPreview: true,
    currentSeedSide: "sell",
  });
});

test("deriveNeutralModePreviewHints stays hidden for non-neutral modes", () => {
  const result = deriveNeutralModePreviewHints({
    template: {
      mode: "long",
      initialSeedEnabled: true,
    },
    preview: {
      warnings: ["preview_mark_price_fallback_used"],
      initialSeed: {
        enabled: true,
        seedSide: "buy",
      },
    },
  });

  assert.deepEqual(result, {
    show: false,
    symmetric: false,
    fullBudgetOneWay: false,
    seedDirectionDependsOnMark: false,
    syntheticMarkPreview: false,
    currentSeedSide: null,
  });
});

test("deriveNeutralModePreviewHints suppresses seed hint when initial seed is disabled", () => {
  const result = deriveNeutralModePreviewHints({
    template: {
      mode: "neutral",
      initialSeedEnabled: false,
    },
    preview: {
      warnings: [],
      initialSeed: {
        enabled: false,
        seedSide: null,
      },
    },
  });

  assert.equal(result.show, true);
  assert.equal(result.seedDirectionDependsOnMark, false);
  assert.equal(result.syntheticMarkPreview, false);
  assert.equal(result.currentSeedSide, null);
});

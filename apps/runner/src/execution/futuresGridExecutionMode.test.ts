import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGridProtectionIntent,
  buildGridPlanRequest,
  buildExecutedGridInitialSeedMetrics,
  buildVaultBalanceSnapshot,
  hasSignalMarketSnapshot,
  computeInitialSeedSide,
  ensureGridLeverageConfigured,
  evaluateHyperliquidBotVaultExecutionReadiness,
  extractHyperliquidLiveOrderRefs,
  filterGridIntentsForRiskGate,
  findBlockingPendingGridCancel,
  liveOrderMatchesLocalOpenOrder,
  normalizeGridOrderIntentForVenueConstraints,
  resolveInitialSeedOrderQty,
  resolveInitialCoreSpotDepositAmountUsd,
  resolveInitialPerpFundingAmountUsd,
  resolveAllowedGridExchangesForBot,
  resolvePlannerFillEventsForExecution,
  refreshTradeStateForVaultReconciliation,
  resolveGridMarketDataFailure,
  resolveGridOrderPlacementFailure,
  resolvePlannerPositionForExecution,
  resolveGridRiskNoopReason,
  resolveGridOrderResubmitGuardReason,
  resolveRestartRecoveryGuardReason,
  resolveVaultReconciliationBlockReason,
  resolveVenueMinNotional,
  shouldRetryCloseOnlySettlementTransfer,
  summarizeGridDelegatedResults,
  shouldAllowHyperliquidVaultBootstrap,
  shouldMarkInitialSeedExecuted,
  shouldRetryInitialSeedSubmission,
  stabilizeHyperliquidVaultGridIntents
} from "./futuresGridExecutionMode.js";
import { resolveGridCoreSnapshot } from "../grid/instanceSnapshot.js";

const COREWRITER_CLOID_DECIMAL = "208456784328589790982014142665896995042";
const COREWRITER_CLOID_HEX = `0x${BigInt(COREWRITER_CLOID_DECIMAL).toString(16).padStart(32, "0")}`;

test("resolveAllowedGridExchangesForBot adds hyperliquid for live hypervault execution", () => {
  const allowed = resolveAllowedGridExchangesForBot(new Set(["paper"]), {
    executionExchange: "hyperliquid",
    marketDataVenue: "hyperliquid",
    executionProvider: "hyperliquid"
  });

  assert.deepEqual([...allowed].sort(), ["hyperliquid", "paper"]);
});

test("resolveAllowedGridExchangesForBot adds hyperliquid for paper bots linked to hyperliquid market data", () => {
  const allowed = resolveAllowedGridExchangesForBot(new Set(["paper"]), {
    executionExchange: "paper",
    marketDataVenue: "hyperliquid",
    executionProvider: null
  });

  assert.deepEqual([...allowed].sort(), ["hyperliquid", "paper"]);
});

test("resolveAllowedGridExchangesForBot keeps the base allowlist for non-hyperliquid bots", () => {
  const base = new Set(["paper"]);
  const allowed = resolveAllowedGridExchangesForBot(base, {
    executionExchange: "bitget",
    marketDataVenue: "bitget",
    executionProvider: null
  });

  assert.equal(allowed, base);
  assert.deepEqual([...allowed], ["paper"]);
});

test("resolvePlannerPositionForExecution tolerates hyperliquid position read failures during fresh bootstrap", async () => {
  const result = await resolvePlannerPositionForExecution({
    adapter: {
      async getPositions() {
        throw new Error("An unknown error occurred");
      }
    } as any,
    symbol: "BTCUSDT",
    executionExchange: "hyperliquid",
    tradeState: {
      openSide: null,
      openQty: 0,
      openEntryPrice: null
    } as any,
    openOrdersCount: 0,
    currentStateJson: {}
  });

  assert.equal(result.position, null);
  assert.equal(result.degraded, true);
  assert.equal(result.source, "empty_hyperliquid_bootstrap_fallback");
  assert.match(String(result.readError ?? ""), /unknown error occurred/i);
});

test("resolvePlannerPositionForExecution keeps throwing non-bootstrap adapter read failures", async () => {
  await assert.rejects(
    () => resolvePlannerPositionForExecution({
      adapter: {
        async getPositions() {
          throw new Error("positions unavailable");
        }
      } as any,
      symbol: "BTCUSDT",
      executionExchange: "hyperliquid",
      tradeState: {
        openSide: null,
        openQty: 0,
        openEntryPrice: null
      } as any,
      openOrdersCount: 1,
      currentStateJson: {
        initialSeedExecuted: true
      }
    }),
    /positions unavailable/i
  );
});

test("ensureGridLeverageConfigured applies leverage once and caches it in state", async () => {
  const calls: Array<{ symbol: string; leverage: number; marginMode: string }> = [];
  const now = new Date("2026-03-26T10:00:00.000Z");

  const first = await ensureGridLeverageConfigured({
    adapter: {
      async setLeverage(symbol: string, leverage: number, marginMode: string) {
        calls.push({ symbol, leverage, marginMode });
      }
    } as any,
    executionExchange: "hyperliquid",
    symbol: "BTCUSDT",
    leverage: 7,
    marginMode: "cross",
    currentStateJson: {},
    now
  });

  const second = await ensureGridLeverageConfigured({
    adapter: {
      async setLeverage(symbol: string, leverage: number, marginMode: string) {
        calls.push({ symbol, leverage, marginMode });
      }
    } as any,
    executionExchange: "hyperliquid",
    symbol: "BTCUSDT",
    leverage: 7,
    marginMode: "cross",
    currentStateJson: first.stateJson,
    now
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(calls, [
    {
      symbol: "BTCUSDT",
      leverage: 7,
      marginMode: "cross"
    }
  ]);
});

test("shouldMarkInitialSeedExecuted requires a pending seed and confirmed open position", () => {
  assert.equal(shouldMarkInitialSeedExecuted({
    currentStateJson: {
      initialSeedPending: true
    },
    plannerPosition: {
      side: "long",
      qty: 0.00327,
      entryPrice: 67017
    }
  }), true);

  assert.equal(shouldMarkInitialSeedExecuted({
    currentStateJson: {
      initialSeedPending: false
    },
    plannerPosition: {
      side: "long",
      qty: 0.00327,
      entryPrice: 67017
    }
  }), false);

  assert.equal(shouldMarkInitialSeedExecuted({
    currentStateJson: {
      initialSeedPending: true
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    }
  }), false);
});

test("computeInitialSeedSide uses cross side midpoints instead of aggregate bounds", () => {
  assert.equal(computeInitialSeedSide({
    mode: "cross",
    markPrice: 67200,
    lowerPrice: 58000,
    upperPrice: 76000,
    crossSideConfig: {
      long: { lowerPrice: 58000, upperPrice: 66000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 76000, gridCount: 9 }
    }
  }), "buy");
});

test("computeInitialSeedSide seeds buy when cross mark price is in the long region", () => {
  assert.equal(computeInitialSeedSide({
    mode: "cross",
    markPrice: 61200,
    lowerPrice: 58000,
    upperPrice: 76000,
    crossSideConfig: {
      long: { lowerPrice: 58000, upperPrice: 66000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 76000, gridCount: 9 }
    }
  }), "buy");
});

test("computeInitialSeedSide seeds sell when cross mark price is in the short region", () => {
  assert.equal(computeInitialSeedSide({
    mode: "cross",
    markPrice: 74100,
    lowerPrice: 58000,
    upperPrice: 76000,
    crossSideConfig: {
      long: { lowerPrice: 58000, upperPrice: 66000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 76000, gridCount: 9 }
    }
  }), "sell");
});

test("computeInitialSeedSide resolves the cross transition region by the nearest side midpoint", () => {
  assert.equal(computeInitialSeedSide({
    mode: "cross",
    markPrice: 68600,
    lowerPrice: 58000,
    upperPrice: 76000,
    crossSideConfig: {
      long: { lowerPrice: 58000, upperPrice: 66000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 76000, gridCount: 9 }
    }
  }), "sell");

  assert.equal(computeInitialSeedSide({
    mode: "cross",
    markPrice: 67400,
    lowerPrice: 58000,
    upperPrice: 76000,
    crossSideConfig: {
      long: { lowerPrice: 58000, upperPrice: 66000, gridCount: 6 },
      short: { lowerPrice: 70000, upperPrice: 76000, gridCount: 9 }
    }
  }), "buy");
});

test("computeInitialSeedSide leaves long short and neutral behavior unchanged", () => {
  assert.equal(computeInitialSeedSide({
    mode: "long",
    markPrice: 70000,
    lowerPrice: 60000,
    upperPrice: 80000
  }), "buy");

  assert.equal(computeInitialSeedSide({
    mode: "short",
    markPrice: 70000,
    lowerPrice: 60000,
    upperPrice: 80000
  }), "sell");

  assert.equal(computeInitialSeedSide({
    mode: "neutral",
    markPrice: 69000,
    lowerPrice: 60000,
    upperPrice: 80000
  }), "buy");

  assert.equal(computeInitialSeedSide({
    mode: "neutral",
    markPrice: 71000,
    lowerPrice: 60000,
    upperPrice: 80000
  }), "sell");
});

test("hasSignalMarketSnapshot detects ticker metadata even when no mark price is parsed", () => {
  assert.equal(hasSignalMarketSnapshot({
    metadata: {
      ticker: {
        symbol: "BTCUSDT"
      }
    }
  } as any), true);
});

test("resolveGridMarketDataFailure reports market_snapshot_unavailable when no snapshot exists", () => {
  const failure = resolveGridMarketDataFailure({
    signal: {
      metadata: null
    } as any,
    adapterPresent: true,
    adapterMarkPriceDiagnostic: {
      ok: false,
      price: null,
      priceSource: null,
      snapshotAvailable: false,
      snapshotSource: "none",
      endpointFailures: [],
      retryCount: 0,
      staleCacheAgeMs: null,
      errorCategory: "network",
      symbol: "BTCUSDT",
      exchangeSymbol: "BTC-PERP",
      attemptedSources: ["markPx", "mid"],
      usedCachedSnapshot: false
    }
  });

  assert.equal(failure.code, "market_snapshot_unavailable");
  assert.equal(failure.reason, "grid_market_snapshot_unavailable");
  assert.equal(failure.details.marketSnapshotAvailable, false);
});

test("resolveGridMarketDataFailure reports mark_price_unavailable when a snapshot exists without price", () => {
  const failure = resolveGridMarketDataFailure({
    signal: {
      metadata: {
        ticker: {
          symbol: "BTCUSDT"
        }
      }
    } as any,
    adapterPresent: true,
    adapterMarkPriceDiagnostic: {
      ok: false,
      price: null,
      priceSource: null,
      snapshotAvailable: true,
      snapshotSource: "cache",
      endpointFailures: [],
      retryCount: 0,
      staleCacheAgeMs: 1000,
      errorCategory: "timeout",
      symbol: "BTCUSDT",
      exchangeSymbol: "BTC-PERP",
      attemptedSources: ["markPx", "mid"],
      usedCachedSnapshot: true
    }
  });

  assert.equal(failure.code, "mark_price_unavailable");
  assert.equal(failure.reason, "grid_mark_price_unavailable");
  assert.equal(failure.details.marketSnapshotAvailable, true);
  assert.equal(failure.details.snapshotSource, "signal");
});

test("resolveGridOrderPlacementFailure isolates blocked order placement results", () => {
  const failure = resolveGridOrderPlacementFailure([
    {
      status: "blocked",
      reason: "grid_set_protection_failed:timeout",
      metadata: {}
    },
    {
      status: "blocked",
      reason: "adapter_place_order_failed:exchange_down",
      metadata: {
        retryCategory: "safe_retry",
        retryReasonCode: "upstream_5xx"
      }
    }
  ] as any);

  assert.deepEqual(failure, {
    reason: "adapter_place_order_failed:exchange_down",
    details: {
      retryCategory: "safe_retry",
      retryReasonCode: "upstream_5xx",
      txHash: null,
      candidateOrderId: null
    }
  });
});

test("buildGridPlanRequest preserves cross side config for live planner payloads", () => {
  const crossSideConfig = {
    long: { lowerPrice: 60000, upperPrice: 70000, gridCount: 6 },
    short: { lowerPrice: 72000, upperPrice: 80000, gridCount: 9 }
  };

  const payload = buildGridPlanRequest({
    instance: {
      id: "grid_1",
      mode: "cross",
      gridMode: "arithmetic",
      allocationMode: "EQUAL_NOTIONAL_PER_GRID",
      budgetSplitPolicy: "FIXED_50_50",
      longBudgetPct: 50,
      shortBudgetPct: 50,
      lowerPrice: 60000,
      upperPrice: 80000,
      gridCount: 9,
      crossSideConfig,
      activeOrderWindowSize: 100,
      recenterDriftLevels: 1,
      investUsd: 500,
      leverage: 5,
      slippagePct: 0.1,
      triggerPrice: null,
      tpPct: null,
      slPrice: null,
      extraMarginUsd: 0,
      initialSeedEnabled: true,
      initialSeedPct: 30
    },
    markPrice: 70000,
    openOrders: [],
    position: null,
    stateJson: {},
    fillEvents: [],
    venueConstraints: {
      minQty: 0.001,
      qtyStep: 0.001,
      priceTick: 0.1,
      minNotional: 10,
      feeRate: 0.0005
    },
    feeBufferPct: 0.1,
    mmrPct: 0.5,
    liqDistanceMinPct: 1
  });

  assert.deepEqual(payload.crossSideConfig, crossSideConfig);
});

test("buildGridPlanRequest preserves snapshot cross config even when the template later changes", () => {
  const snapshot = resolveGridCoreSnapshot({
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

  const payload = buildGridPlanRequest({
    instance: {
      id: "grid_snapshot_1",
      allocationMode: "EQUAL_NOTIONAL_PER_GRID",
      budgetSplitPolicy: "FIXED_50_50",
      longBudgetPct: 50,
      shortBudgetPct: 50,
      activeOrderWindowSize: 100,
      recenterDriftLevels: 1,
      investUsd: 500,
      leverage: 5,
      slippagePct: 0.1,
      triggerPrice: null,
      tpPct: null,
      slPrice: null,
      extraMarginUsd: 0,
      initialSeedEnabled: true,
      initialSeedPct: 30,
      ...snapshot
    },
    markPrice: 70000,
    openOrders: [],
    position: null,
    stateJson: {},
    fillEvents: [],
    venueConstraints: {
      minQty: 0.001,
      qtyStep: 0.001,
      priceTick: 0.1,
      minNotional: 10,
      feeRate: 0.0005
    },
    feeBufferPct: 0.1,
    mmrPct: 0.5,
    liqDistanceMinPct: 1
  });

  assert.equal(payload.mode, "cross");
  assert.equal(payload.gridMode, "geometric");
  assert.equal(payload.lowerPrice, 50000);
  assert.equal(payload.upperPrice, 90000);
  assert.equal(payload.gridCount, 9);
  assert.deepEqual(payload.crossSideConfig, {
    long: { lowerPrice: 50000, upperPrice: 65000, gridCount: 6 },
    short: { lowerPrice: 70000, upperPrice: 90000, gridCount: 9 }
  });
});

test("resolveGridRiskNoopReason suppresses hard risk-block noops once a position is open", () => {
  assert.equal(resolveGridRiskNoopReason({
    riskBlockingActive: true,
    hasOpenPosition: false
  }), "grid_entry_blocked_by_risk");

  assert.equal(resolveGridRiskNoopReason({
    riskBlockingActive: true,
    hasOpenPosition: true
  }), "grid_no_order_changes");

  assert.equal(resolveGridRiskNoopReason({
    riskBlockingActive: false,
    hasOpenPosition: true
  }), "grid_no_order_changes");
});

test("resolveGridOrderResubmitGuardReason blocks client order ids that hit the orphan resubmit limit", () => {
  assert.equal(resolveGridOrderResubmitGuardReason({
    currentStateJson: {
      executionRecovery: {
        orderResubmissionGuards: {
          "grid-inst-long-18": {
            clientOrderId: "grid-inst-long-18",
            exchangeOrderId: "cloid:0:123",
            orphanCount: 10,
            lastSubmittedAt: "2026-04-15T14:20:00.000Z",
            lastOrphanedAt: "2026-04-15T14:25:00.000Z",
            lastSeenVenueAt: null,
            blockedAt: "2026-04-15T14:25:00.000Z",
            blockReason: "grid_order_resubmit_limit_reached"
          }
        }
      }
    },
    clientOrderId: "grid-inst-long-18"
  }), "grid_order_resubmit_limit_reached");

  assert.equal(resolveGridOrderResubmitGuardReason({
    currentStateJson: {
      executionRecovery: {
        orderResubmissionGuards: {
          "grid-inst-long-18": {
            clientOrderId: "grid-inst-long-18",
            exchangeOrderId: "cloid:0:123",
            orphanCount: 4,
            lastSubmittedAt: "2026-04-15T14:20:00.000Z",
            lastOrphanedAt: "2026-04-15T14:25:00.000Z",
            lastSeenVenueAt: null,
            blockedAt: null,
            blockReason: null
          }
        }
      }
    },
    clientOrderId: "grid-inst-long-18"
  }), null);
});

test("resolveVaultReconciliationBlockReason escalates critical position drifts", () => {
  assert.equal(resolveVaultReconciliationBlockReason({
    status: "critical",
    drifts: [{
      key: "position:missing-local",
      severity: "critical",
      scope: "positions",
      sourceOfTruth: "live_venue",
      handling: "block_execution",
      kind: "live_position_missing_local",
      message: "unexpected live position"
    }]
  }), "grid_vault_position_reconciliation_required");
});

test("resolveVaultReconciliationBlockReason ignores warning-only reconciliation drift", () => {
  assert.equal(resolveVaultReconciliationBlockReason({
    status: "warning",
    drifts: [{
      key: "missing-local:order-1",
      severity: "warning",
      scope: "orders",
      sourceOfTruth: "live_venue",
      handling: "recoverable",
      kind: "live_open_missing_local",
      message: "unexpected live order"
    }]
  }), null);
});

test("resolvePlannerFillEventsForExecution surfaces newly synced live fills exactly once", () => {
  const first = resolvePlannerFillEventsForExecution({
    currentStateJson: {},
    paperFillEvents: [],
    liveFillEvents: [{
      exchangeOrderId: "oid-1",
      clientOrderId: "grid-1",
      side: "buy",
      fillPrice: 71699,
      fillQty: 0.00074,
      fillTs: new Date("2026-04-08T13:44:13.617Z"),
      gridIndex: 0
    }]
  });

  assert.equal(first.plannerFillEvents.length, 1);
  assert.equal(first.latestProcessedFillTs, "2026-04-08T13:44:13.617Z");

  const second = resolvePlannerFillEventsForExecution({
    currentStateJson: {
      lastProcessedGridFillTs: first.latestProcessedFillTs
    },
    paperFillEvents: [],
    liveFillEvents: []
  });

  assert.equal(second.plannerFillEvents.length, 0);
  assert.equal(second.latestProcessedFillTs, "2026-04-08T13:44:13.617Z");
});

test("refreshTradeStateForVaultReconciliation reanchors expected position when new live fills exist", async () => {
  const calls: string[] = [];
  const plannerPositionResolution = {
    position: {
      side: "long" as const,
      qty: 0.00017,
      entryPrice: 71056.9
    },
    source: "adapter" as const,
    degraded: false,
    readError: null
  };
  const initialTradeState = {
    openSide: "long",
    openQty: 0.00031,
    openEntryPrice: 71057
  } as any;
  const syncedTradeState = {
    ...initialTradeState,
    openQty: 0.00017,
    openEntryPrice: 71056.9
  };

  const result = await refreshTradeStateForVaultReconciliation({
    executionExchange: "hyperliquid",
    liveFillEvents: [{
      exchangeOrderId: "oid-75000",
      side: "sell",
      fillPrice: 75000,
      fillQty: 0.00014,
      fillTs: "2026-04-14T13:42:10.981Z",
      gridIndex: 15
    }],
    tradeState: initialTradeState,
    resolvePlannerPosition: async () => {
      calls.push("resolve");
      return plannerPositionResolution;
    },
    syncTradeState: async (plannerPosition) => {
      calls.push(`sync:${plannerPosition?.qty ?? "flat"}`);
      return syncedTradeState as any;
    }
  });

  assert.deepEqual(calls, ["resolve", "sync:0.00017"]);
  assert.equal(result.plannerPositionResolution, plannerPositionResolution);
  assert.equal(result.tradeState.openQty, 0.00017);
  assert.equal(result.tradeState.openEntryPrice, 71056.9);
});

test("refreshTradeStateForVaultReconciliation skips reanchor when no new live fills exist", async () => {
  const result = await refreshTradeStateForVaultReconciliation({
    executionExchange: "hyperliquid",
    liveFillEvents: [],
    tradeState: {
      openSide: "long",
      openQty: 0.00031,
      openEntryPrice: 71057
    } as any,
    resolvePlannerPosition: async () => {
      throw new Error("should_not_run");
    },
    syncTradeState: async () => {
      throw new Error("should_not_run");
    }
  });

  assert.equal(result.plannerPositionResolution, null);
  assert.equal(result.tradeState.openQty, 0.00031);
});

test("buildExecutedGridInitialSeedMetrics persists nested initialSeed details", () => {
  const metrics = buildExecutedGridInitialSeedMetrics({
    seedSide: "long",
    seedQty: 0.00327,
    seedNotionalUsd: 219.14559,
    seedMarginUsd: 10.9572795,
    seedPct: 30,
    seedPrice: 67017
  });

  assert.deepEqual(metrics, {
    initialSeed: {
      enabled: true,
      seedSide: "long",
      seedQty: 0.00327,
      seedNotionalUsd: 219.14559,
      seedMarginUsd: 10.9572795,
      seedPct: 30,
      seedPrice: 67017
    },
    initialSeedExecuted: true,
    initialSeedPending: false,
    initialSeedQty: 0.00327,
    initialSeedSide: "long",
    initialSeedPct: 30,
    initialSeedNotionalUsd: 219.14559,
    initialSeedMarginUsd: 10.9572795,
    initialSeedPrice: 67017
  });
});

test("resolveInitialSeedOrderQty adds one step of min-notional buffer for borderline seeds", () => {
  assert.equal(resolveInitialSeedOrderQty({
    seedNotionalUsdRaw: 8.16,
    markPrice: 68203,
    minQty: 0.00001,
    qtyStep: 0.00001,
    minNotional: 10
  }), 0.00016);
});

test("buildVaultBalanceSnapshot rejects inconsistent account state for sizing", () => {
  const snapshot = buildVaultBalanceSnapshot({
    now: new Date("2026-04-13T10:00:00.000Z"),
    accountState: {
      equity: 100,
      availableMargin: 125
    },
    coreSpotBalance: {
      amountUsd: 20
    },
    accountRead: {
      fromCache: false,
      stale: false,
      degraded: false,
      cacheAgeMs: 0,
      reason: null
    },
    spotRead: {
      fromCache: false,
      stale: false,
      degraded: false,
      cacheAgeMs: 0,
      reason: null
    },
    requireSpotBalance: true
  });

  assert.equal(snapshot.usableForSizing, false);
  assert.equal(snapshot.usableForTransfers, false);
  assert.ok(snapshot.issues.includes("available_margin_exceeds_equity"));
});

test("buildVaultBalanceSnapshot rejects degraded spot reads for transfer decisions", () => {
  const snapshot = buildVaultBalanceSnapshot({
    now: new Date("2026-04-13T10:00:00.000Z"),
    accountState: {
      equity: 100,
      availableMargin: 75
    },
    coreSpotBalance: {
      amountUsd: 10
    },
    accountRead: {
      fromCache: false,
      stale: false,
      degraded: false,
      cacheAgeMs: 0,
      reason: null
    },
    spotRead: {
      fromCache: true,
      stale: true,
      degraded: true,
      cacheAgeMs: 18_000,
      reason: "rate limited"
    },
    requireSpotBalance: true
  });

  assert.equal(snapshot.usableForTransfers, false);
  assert.ok(snapshot.issues.includes("spot_balance_not_fresh"));
});

test("filterGridIntentsForRiskGate preserves maintenance entries for a running grid when only min-investment blocks", () => {
  const intents = filterGridIntentsForRiskGate({
    intents: [
      {
        type: "place_order",
        side: "buy",
        price: 72000,
        qty: 0.00014,
        reduceOnly: false,
        gridLeg: "long",
        gridIndex: 12,
        clientOrderId: "grid-inst-long-12"
      },
      {
        type: "cancel_order",
        clientOrderId: "grid-inst-long-17",
        exchangeOrderId: "venue-17"
      },
      {
        type: "set_protection",
        tpPrice: 78000,
        slPrice: 62000
      } as any
    ],
    currentStateJson: {
      initialSeedExecuted: true
    },
    openOrdersCount: 14,
    hasOpenPosition: true,
    entryBlockedByLiq: false,
    entryBlockedByMinInvestment: true,
    autoMarginRiskBlocked: false
  });

  assert.equal(intents.length, 3);
  assert.equal(intents[0]?.type, "place_order");
  assert.equal(intents[1]?.type, "cancel_order");
  assert.equal(intents[2]?.type, "set_protection");
});

test("filterGridIntentsForRiskGate keeps blocking fresh entry intents when the grid has no open position", () => {
  const intents = filterGridIntentsForRiskGate({
    intents: [
      {
        type: "place_order",
        side: "buy",
        price: 72000,
        qty: 0.00014,
        reduceOnly: false,
        gridLeg: "long",
        gridIndex: 12,
        clientOrderId: "grid-inst-long-12"
      },
      {
        type: "cancel_order",
        clientOrderId: "grid-inst-long-17",
        exchangeOrderId: "venue-17"
      }
    ],
    currentStateJson: {},
    openOrdersCount: 0,
    hasOpenPosition: false,
    entryBlockedByLiq: false,
    entryBlockedByMinInvestment: true,
    autoMarginRiskBlocked: false
  });

  assert.deepEqual(intents, [{
    type: "cancel_order",
    clientOrderId: "grid-inst-long-17",
    exchangeOrderId: "venue-17"
  }]);
});

test("filterGridIntentsForRiskGate does not preserve non-reduce entries when liq risk blocks", () => {
  const intents = filterGridIntentsForRiskGate({
    intents: [
      {
        type: "place_order",
        side: "buy",
        price: 72000,
        qty: 0.00014,
        reduceOnly: false,
        gridLeg: "long",
        gridIndex: 12,
        clientOrderId: "grid-inst-long-12"
      },
      {
        type: "place_order",
        side: "sell",
        price: 75000,
        qty: 0.00014,
        reduceOnly: true,
        gridLeg: "long",
        gridIndex: 15,
        clientOrderId: "grid-inst-long-15"
      }
    ],
    currentStateJson: {
      initialSeedExecuted: true
    },
    openOrdersCount: 14,
    hasOpenPosition: true,
    entryBlockedByLiq: true,
    entryBlockedByMinInvestment: false,
    autoMarginRiskBlocked: false
  });

  assert.deepEqual(intents, [{
    type: "place_order",
    side: "sell",
    price: 75000,
    qty: 0.00014,
    reduceOnly: true,
    gridLeg: "long",
    gridIndex: 15,
    clientOrderId: "grid-inst-long-15"
  }]);
});

test("shouldRetryInitialSeedSubmission resets a stale pending seed without a submitted order", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true,
      initialSeedLastContext: {
        stage: "confirmation_pending",
        venueOpenOrders: {
          matchingCount: 0
        },
        positions: {
          matchingCount: 0
        },
        plannerPosition: {
          qty: 0
        }
      }
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    }
  }), true);
});

test("shouldRetryInitialSeedSubmission keeps waiting when restart diagnostics already show matching fills", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true,
      initialSeedAt: "2026-03-29T22:00:00.000Z"
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    pendingSeedContext: {
      submitResult: {
        orderId: "cloid:0:123"
      },
      venueOpenOrders: {
        matchingCount: 0
      },
      positions: {
        matchingCount: 0
      },
      recentFills: {
        matchingCount: 1
      }
    },
    now: new Date("2026-03-29T22:05:00.000Z")
  }), false);
});

test("shouldRetryInitialSeedSubmission keeps waiting when restart diagnostics are incomplete", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    pendingSeedContext: {
      openOrdersReadError: "network timeout"
    }
  }), false);
});

test("shouldRetryInitialSeedSubmission retries immediately when the submitted seed order is terminally rejected", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true,
      initialSeedAt: "2026-03-29T22:09:30.000Z"
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    pendingSeedContext: {
      submitResult: {
        orderId: "cloid:0:123"
      },
      terminalOrderStatus: "REJECTED",
      venueOpenOrders: {
        matchingCount: 0
      },
      positions: {
        matchingCount: 0
      }
    },
    now: new Date("2026-03-29T22:09:45.000Z")
  }), true);
});

test("shouldRetryInitialSeedSubmission keeps waiting when a submitted order id exists", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true,
      initialSeedAt: "2026-03-29T22:09:30.000Z"
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    pendingSeedContext: {
      submitResult: {
        orderId: "corewriter:1:123"
      },
      venueOpenOrders: {
        matchingCount: 0
      },
      positions: {
        matchingCount: 0
      }
    },
    now: new Date("2026-03-29T22:10:00.000Z")
  }), false);
});

test("shouldRetryInitialSeedSubmission resets a stale submitted seed when the order never appears", () => {
  assert.equal(shouldRetryInitialSeedSubmission({
    currentStateJson: {
      initialSeedPending: true,
      initialSeedAt: "2026-03-29T22:00:00.000Z"
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    pendingSeedContext: {
      submitResult: {
        orderId: "cloid:0:123"
      },
      venueOpenOrders: {
        matchingCount: 0
      },
      positions: {
        matchingCount: 0
      }
    },
    now: new Date("2026-03-29T22:05:00.000Z")
  }), true);
});

test("resolveRestartRecoveryGuardReason blocks restart seeding when HyperCore still has unknown live orders", () => {
  assert.equal(resolveRestartRecoveryGuardReason({
    currentStateJson: {
      initialSeedNeedsReseed: true
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    openOrdersCount: 0,
    reconciliationResult: {
      drifts: [{
        key: "live-open-missing-local",
        severity: "warning",
        scope: "orders",
        sourceOfTruth: "live_venue",
        handling: "recoverable",
        kind: "live_open_missing_local",
        message: "unknown live order"
      }],
      newFills: []
    }
  }), "grid_restart_live_orders_reconciliation_required");
});

test("resolveRestartRecoveryGuardReason blocks restart seeding while fresh restart fills are still reconciling", () => {
  assert.equal(resolveRestartRecoveryGuardReason({
    currentStateJson: {
      initialSeedNeedsReseed: true
    },
    plannerPosition: {
      side: null,
      qty: 0,
      entryPrice: null
    },
    openOrdersCount: 0,
    reconciliationResult: {
      drifts: [],
      newFills: [{
        key: "fill-1"
      }] as any
    }
  }), "grid_restart_fill_reconciliation_pending");
});

test("stabilizeHyperliquidVaultGridIntents preserves missing new place orders while deduping existing ones", () => {
  const intents = stabilizeHyperliquidVaultGridIntents({
    isHyperliquidVault: true,
    botVaultState: "active",
    hasFreshGridFills: false,
    openOrders: [
      {
        clientOrderId: "grid-existing-buy"
      }
    ],
    intents: [
      {
        type: "place_order",
        side: "buy",
        qty: 0.00008,
        price: 66900,
        reduceOnly: false,
        gridLeg: "long",
        gridIndex: 46,
        clientOrderId: "grid-existing-buy"
      },
      {
        type: "place_order",
        side: "sell",
        qty: 0.00008,
        price: 67200,
        reduceOnly: true,
        gridLeg: "long",
        gridIndex: 48,
        clientOrderId: "grid-new-sell"
      },
      {
        type: "set_protection",
        tpPrice: 70000,
        slPrice: 65000
      } as any
    ]
  });

  assert.equal(intents.length, 2);
  assert.equal(intents[0]?.type, "place_order");
  assert.equal(intents[0]?.clientOrderId, "grid-new-sell");
  assert.equal(intents[1]?.type, "set_protection");
});

test("applyGridProtectionIntent executes setPositionTpSl on supported adapters", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await applyGridProtectionIntent({
    executionExchange: "hyperliquid",
    exchangeAccountId: "acct-1",
    botSymbol: "BTCUSDT",
    plannerIntent: {
      type: "set_protection",
      tpPrice: 70250,
      slPrice: 64850
    },
    adapter: {
      async getPositions() {
        return [
          {
            symbol: "BTCUSDT",
            side: "long",
            size: 0.01,
            entryPrice: 67000
          }
        ];
      },
      async setPositionTpSl(params: Record<string, unknown>) {
        calls.push(params);
        return { ok: true as const };
      }
    } as any
  });

  assert.equal(result.status, "executed");
  assert.equal(result.reason, "grid_adapter_protection_set");
  assert.deepEqual(calls, [{
    symbol: "BTCUSDT",
    side: "long",
    takeProfitPrice: 70250,
    stopLossPrice: 64850
  }]);
});

test("applyGridProtectionIntent returns noop when no position exists yet", async () => {
  const result = await applyGridProtectionIntent({
    executionExchange: "hyperliquid",
    exchangeAccountId: "acct-1",
    botSymbol: "BTCUSDT",
    plannerIntent: {
      type: "set_protection",
      tpPrice: 70250,
      slPrice: 64850
    },
    adapter: {
      async getPositions() {
        return [];
      }
    } as any
  });

  assert.equal(result.status, "noop");
  assert.equal(result.reason, "grid_set_protection_no_position");
});

test("applyGridProtectionIntent blocks explicitly when the adapter does not support protection", async () => {
  const result = await applyGridProtectionIntent({
    executionExchange: "ccxt",
    exchangeAccountId: "acct-1",
    botSymbol: "BTCUSDT",
    plannerIntent: {
      type: "set_protection",
      tpPrice: 70250,
      slPrice: 64850
    },
    adapter: {
      async getPositions() {
        return [
          {
            symbol: "BTCUSDT",
            side: "short",
            size: 0.02,
            entryPrice: 67000
          }
        ];
      }
    } as any
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "grid_set_protection_unsupported_exchange:ccxt");
  assert.equal(result.metadata?.exchange, "ccxt");
});

test("findBlockingPendingGridCancel blocks replace intents until cancel confirmation clears", () => {
  const blocked = findBlockingPendingGridCancel({
    plannerIntent: {
      type: "replace_order",
      clientOrderId: "grid-btc-long-4",
      exchangeOrderId: "12345",
      side: "buy",
      price: 67000,
      qty: 0.01,
      reduceOnly: false,
      gridLeg: "long",
      gridIndex: 4
    },
    pendingExecutions: [{
      actionType: "cancel_order",
      clientOrderId: "grid-btc-long-4",
      exchangeOrderId: "12345"
    }]
  });

  assert.deepEqual(blocked, {
    clientOrderId: "grid-btc-long-4",
    exchangeOrderId: "12345"
  });
});

test("findBlockingPendingGridCancel ignores unrelated pending cancel state", () => {
  const blocked = findBlockingPendingGridCancel({
    plannerIntent: {
      type: "replace_order",
      clientOrderId: "grid-btc-long-5",
      exchangeOrderId: "67890",
      side: "buy",
      price: 67100,
      qty: 0.01,
      reduceOnly: false,
      gridLeg: "long",
      gridIndex: 5
    },
    pendingExecutions: [{
      actionType: "cancel_order",
      clientOrderId: "grid-btc-long-4",
      exchangeOrderId: "12345"
    }]
  });

  assert.equal(blocked, null);
});

test("summarizeGridDelegatedResults does not let protection-only blocks override executed order work", () => {
  const summary = summarizeGridDelegatedResults([
    {
      status: "executed",
      reason: "grid_adapter_executed",
      metadata: {},
      legacy: {
        outcome: "ok",
        intent: { type: "none" } as any,
        gate: {} as any
      }
    },
    {
      status: "blocked",
      reason: "grid_set_protection_unsupported_exchange:ccxt",
      metadata: {},
      legacy: {
        outcome: "blocked",
        intent: { type: "none" } as any,
        gate: {} as any
      }
    }
  ]);

  assert.equal(summary.executedResults.length, 1);
  assert.equal(summary.protectionBlockedResults.length, 1);
  assert.equal(summary.blockingResult, null);
});

test("summarizeGridDelegatedResults still blocks when only protection fails", () => {
  const summary = summarizeGridDelegatedResults([
    {
      status: "blocked",
      reason: "grid_set_protection_unsupported_exchange:ccxt",
      metadata: {},
      legacy: {
        outcome: "blocked",
        intent: { type: "none" } as any,
        gate: {} as any
      }
    }
  ]);

  assert.equal(summary.executedResults.length, 0);
  assert.equal(summary.protectionBlockedResults.length, 1);
  assert.equal(summary.blockingResult?.reason, "grid_set_protection_unsupported_exchange:ccxt");
});

test("extractHyperliquidLiveOrderRefs keeps venue oid and cloid fingerprints", () => {
  const refs = extractHyperliquidLiveOrderRefs({
    orderId: "98123",
      raw: {
        oid: "98123",
        cloid: COREWRITER_CLOID_DECIMAL,
        clientOid: "grid-instance-long-1"
      }
  });

  assert.equal(refs.clientOrderId, "grid-instance-long-1");
  assert.ok(refs.exchangeOrderRefs.includes("98123"));
  assert.ok(refs.exchangeOrderRefs.includes(COREWRITER_CLOID_DECIMAL));
  assert.ok(refs.exchangeOrderRefs.includes(COREWRITER_CLOID_HEX));
});

test("liveOrderMatchesLocalOpenOrder matches venue cloid fingerprints against local corewriter ids", () => {
  assert.equal(liveOrderMatchesLocalOpenOrder({
    openOrders: [{
      clientOrderId: "grid-instance-long-1",
      exchangeOrderId: `cloid:0:${COREWRITER_CLOID_DECIMAL}`
    }],
    exchangeOrderRefs: [COREWRITER_CLOID_DECIMAL]
  }), true);
});

test("resolveInitialPerpFundingAmountUsd caps the first perp funding transfer to the live core spot balance", () => {
  assert.equal(resolveInitialPerpFundingAmountUsd({
    requestedAmountUsd: 73,
    coreSpotBalanceUsd: 72
  }), 72);
});

test("resolveInitialPerpFundingAmountUsd keeps the requested amount when the live core spot balance is unavailable", () => {
  assert.equal(resolveInitialPerpFundingAmountUsd({
    requestedAmountUsd: 73,
    coreSpotBalanceUsd: null
  }), 73);
});

test("resolveInitialPerpFundingAmountUsd returns zero for invalid requests", () => {
  assert.equal(resolveInitialPerpFundingAmountUsd({
    requestedAmountUsd: 0,
    coreSpotBalanceUsd: 72
  }), 0);
});

test("resolveInitialCoreSpotDepositAmountUsd skips a repeated core spot deposit when balance already exists", () => {
  assert.equal(resolveInitialCoreSpotDepositAmountUsd({
    requestedAmountUsd: 5,
    coreSpotBalanceUsd: 5
  }), 0);

  assert.equal(resolveInitialCoreSpotDepositAmountUsd({
    requestedAmountUsd: 5,
    coreSpotBalanceUsd: 0.4
  }), 0);
});

test("resolveInitialCoreSpotDepositAmountUsd keeps the requested amount when the live core spot balance is empty", () => {
  assert.equal(resolveInitialCoreSpotDepositAmountUsd({
    requestedAmountUsd: 5,
    coreSpotBalanceUsd: 0
  }), 5);

  assert.equal(resolveInitialCoreSpotDepositAmountUsd({
    requestedAmountUsd: 5,
    coreSpotBalanceUsd: null
  }), 5);
});

test("shouldRetryCloseOnlySettlementTransfer retries immediately when no prior transfer was recorded", () => {
  assert.equal(shouldRetryCloseOnlySettlementTransfer({
    recordedAt: null,
    sourceBalanceUsd: 5.939281,
    now: new Date("2026-04-08T11:20:00.000Z")
  }), true);
});

test("shouldRetryCloseOnlySettlementTransfer re-arms settlement retries after the cooldown when source balance remains", () => {
  assert.equal(shouldRetryCloseOnlySettlementTransfer({
    recordedAt: "2026-04-08T11:08:02.753Z",
    sourceBalanceUsd: 5.939281,
    now: new Date("2026-04-08T11:20:00.000Z")
  }), false);

  assert.equal(shouldRetryCloseOnlySettlementTransfer({
    recordedAt: "2026-04-08T11:19:45.000Z",
    sourceBalanceUsd: 5.939281,
    now: new Date("2026-04-08T11:20:00.000Z")
  }), false);
});

test("shouldAllowHyperliquidVaultBootstrap blocks funding during close-only and withdraw-pending lifecycle states", () => {
  assert.equal(shouldAllowHyperliquidVaultBootstrap({
    status: "CLOSE_ONLY",
    executionStatus: "close_only",
    executionMetadata: {
      lifecycleOverrideState: "withdraw_pending"
    }
  }), false);

  assert.equal(shouldAllowHyperliquidVaultBootstrap({
    status: "ACTIVE",
    executionStatus: "running",
    executionMetadata: {
      lifecycleOverrideState: "settling"
    }
  }), false);
});

test("shouldAllowHyperliquidVaultBootstrap keeps bootstrap enabled for active vault execution", () => {
  assert.equal(shouldAllowHyperliquidVaultBootstrap({
    status: "ACTIVE",
    executionStatus: "running",
    executionMetadata: null
  }), true);

  assert.equal(shouldAllowHyperliquidVaultBootstrap({
    status: "ACTIVE",
    executionStatus: "created",
    executionMetadata: null
  }), true);
});

test("evaluateHyperliquidBotVaultExecutionReadiness blocks transfer-pending BotVault v3 state", () => {
  const readiness = evaluateHyperliquidBotVaultExecutionReadiness({
    vaultAddress: `0x${"1".repeat(40)}`,
    status: "ACTIVE",
    executionStatus: "created",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "pending",
    executionMetadata: {
      marginAddFinalization: {
        verificationState: "transfer_submitted",
        verificationBlockingReason: "transfer_not_yet_observed"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_hypercore_transfer_not_observed");
});

test("evaluateHyperliquidBotVaultExecutionReadiness allows verified funded BotVault v3 state", () => {
  const readiness = evaluateHyperliquidBotVaultExecutionReadiness({
    vaultAddress: `0x${"2".repeat(40)}`,
    status: "ACTIVE",
    executionStatus: "running",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionMetadata: {
      marginAddFinalization: {
        verificationState: "funding_verified"
      }
    }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
});

test("resolveVenueMinNotional applies a hyperliquid minimum floor", () => {
  assert.equal(resolveVenueMinNotional({
    executionExchange: "hyperliquid",
    fallbackMinNotional: 5,
    dynamicMinNotional: 0.7
  }), 10);
});

test("normalizeGridOrderIntentForVenueConstraints scales entry orders up to min notional", () => {
  const normalized = normalizeGridOrderIntentForVenueConstraints({
    plannerIntent: {
      type: "place_order",
      side: "buy",
      qty: 0.00008,
      price: 65100,
      reduceOnly: false
    },
    minQty: 0.00001,
    qtyStep: 0.00001,
    minNotional: 10
  });

  assert.equal(normalized?.qty, 0.00016);
});

test("normalizeGridOrderIntentForVenueConstraints keeps reduce-only qty unchanged", () => {
  const normalized = normalizeGridOrderIntentForVenueConstraints({
    plannerIntent: {
      type: "place_order",
      side: "sell",
      qty: 0.00008,
      price: 65100,
      reduceOnly: true
    },
    minQty: 0.00001,
    qtyStep: 0.00001,
    minNotional: 10
  });

  assert.equal(normalized?.qty, 0.00008);
});

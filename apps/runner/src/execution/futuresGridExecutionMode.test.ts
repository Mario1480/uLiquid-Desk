import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureGridLeverageConfigured,
  extractHyperliquidLiveOrderRefs,
  liveOrderMatchesLocalOpenOrder,
  normalizeGridOrderIntentForVenueConstraints,
  resolveInitialPerpFundingAmountUsd,
  resolveAllowedGridExchangesForBot,
  resolvePlannerPositionForExecution,
  resolveVenueMinNotional,
  shouldMarkInitialSeedExecuted,
  shouldRetryInitialSeedSubmission,
  stabilizeHyperliquidVaultGridIntents
} from "./futuresGridExecutionMode.js";

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

test("extractHyperliquidLiveOrderRefs keeps venue oid and cloid fingerprints", () => {
  const refs = extractHyperliquidLiveOrderRefs({
    orderId: "98123",
    raw: {
      oid: "98123",
      cloid: "208456784328589790982014142665896995042",
      clientOid: "grid-instance-long-1"
    }
  });

  assert.equal(refs.clientOrderId, "grid-instance-long-1");
  assert.ok(refs.exchangeOrderRefs.includes("98123"));
  assert.ok(refs.exchangeOrderRefs.includes("208456784328589790982014142665896995042"));
  assert.ok(refs.exchangeOrderRefs.includes("0x9cd84f3332c76d5aee7d12c4f31a5802"));
});

test("liveOrderMatchesLocalOpenOrder matches venue cloid fingerprints against local corewriter ids", () => {
  assert.equal(liveOrderMatchesLocalOpenOrder({
    openOrders: [{
      clientOrderId: "grid-instance-long-1",
      exchangeOrderId: "cloid:0:208456784328589790982014142665896995042"
    }],
    exchangeOrderRefs: ["208456784328589790982014142665896995042"]
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

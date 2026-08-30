import assert from "node:assert/strict";
import test from "node:test";
import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import { BinanceFuturesAdapter } from "../binance/binance.adapter.js";
import { BingxFuturesAdapter } from "../bingx/bingx.adapter.js";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter } from "../mexc/mexc.adapter.js";
import {
  createPaperExecutionContextForVenueResolution,
  createResolvedFuturesAdapter,
  FuturesAdapterFactoryError,
  createFuturesAdapter,
  resolveFuturesVenue
} from "./create-futures-adapter.js";
import { createPaperExecutionContext } from "../core/paper-runtime.js";
import {
  getFuturesVenueCapabilities,
  validateFuturesVenueRequirements
} from "../core/exchange-capabilities.js";

const credentials = {
  apiKey: "k",
  apiSecret: "s",
  passphrase: "p"
};

test("createFuturesAdapter creates adapter by exchange", async () => {
  const bitget = createFuturesAdapter({ exchange: "bitget", ...credentials });
  assert.equal(bitget instanceof BitgetFuturesAdapter, true);

  const hyper = createFuturesAdapter({ exchange: "hyperliquid", ...credentials });
  assert.equal(hyper instanceof HyperliquidFuturesAdapter, true);

  const mexc = createFuturesAdapter(
    { exchange: "mexc", ...credentials },
    { allowMexcPerp: true }
  );
  assert.equal(mexc instanceof MexcFuturesAdapter, true);

  const binance = createFuturesAdapter({ exchange: "binance", ...credentials });
  assert.equal(binance instanceof BinanceFuturesAdapter, true);

  const bingx = createFuturesAdapter({ exchange: "bingx", ...credentials });
  assert.equal(bingx instanceof BingxFuturesAdapter, true);

  await Promise.all([
    bitget.close(),
    hyper.close(),
    mexc.close(),
    binance.close(),
    bingx.close()
  ]);
});

test("createFuturesAdapter enforces exchange policy flags", async () => {
  assert.throws(
    () => createFuturesAdapter({ exchange: "paper", ...credentials }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError
      && error.code === "paper_account_requires_market_data_resolution"
  );

  assert.throws(
    () => createFuturesAdapter({ exchange: "mexc", ...credentials }, { allowMexcPerp: false }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "mexc_perp_disabled"
  );

  assert.throws(
    () => createFuturesAdapter({ exchange: "binance", ...credentials }, { allowBinancePerp: false }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "binance_perp_disabled"
  );

  assert.throws(
    () => createFuturesAdapter({ exchange: "bingx", ...credentials }, { allowBingxPerp: false }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "bingx_perp_disabled"
  );

  const binance = createFuturesAdapter({ exchange: "binance", ...credentials });
  assert.equal(binance instanceof BinanceFuturesAdapter, true);
  const bingx = createFuturesAdapter({ exchange: "bingx", ...credentials });
  assert.equal(bingx instanceof BingxFuturesAdapter, true);
  await Promise.all([binance.close(), bingx.close()]);
});

test("createResolvedFuturesAdapter exposes paper/runtime resolution without throwing", async () => {
  const live = createResolvedFuturesAdapter({ exchange: "hyperliquid", ...credentials });
  assert.equal(live.kind, "adapter");
  assert.equal(live.adapter instanceof HyperliquidFuturesAdapter, true);
  if (live.kind === "adapter") {
    await live.adapter.close();
  }

  const paper = createResolvedFuturesAdapter({ exchange: "paper", ...credentials });
  assert.equal(paper.kind, "paper");
  assert.equal(paper.adapter, null);
  if (paper.kind === "paper" && paper.resolution.kind === "paper") {
    assert.equal(paper.resolution.paperRuntime.executionVenue, "paper");
  }
});

test("resolveFuturesVenue exposes explicit capabilities and policy shape", () => {
  const paper = resolveFuturesVenue({ exchange: "paper", ...credentials });
  assert.equal(paper.kind, "paper");
  assert.equal(paper.code, "paper_account_requires_market_data_resolution");
  assert.equal(paper.capabilities.supportsPerpExecution, true);
  assert.equal(paper.capabilities.requiresLinkedMarketData, true);
  assert.equal(paper.capabilities.adapterFactoryAvailable, false);
  if (paper.kind === "paper") {
    assert.equal(paper.paperRuntime.executionVenue, "paper");
    assert.equal(paper.paperRuntime.marketDataLinkMode, "linked_live_venue");
    assert.deepEqual(paper.paperRuntime.supportedMarketTypes, ["spot", "perp"]);
  }

  const binance = resolveFuturesVenue({ exchange: "binance", ...credentials });
  assert.equal(binance.kind, "adapter");
  assert.equal(binance.code, null);
  assert.equal(binance.capabilities.supportsPerpMarketData, true);
  assert.equal(binance.capabilities.supportsPerpExecution, true);
  assert.equal(binance.capabilities.supportsGridExecution, true);
  assert.equal(binance.capabilities.supportsOrderEditing, true);

  const bingx = resolveFuturesVenue({ exchange: "bingx", ...credentials });
  assert.equal(bingx.kind, "adapter");
  assert.equal(bingx.code, null);
  assert.equal(bingx.capabilities.supportsPerpMarketData, true);
  assert.equal(bingx.capabilities.supportsPerpExecution, true);
  assert.equal(bingx.capabilities.supportsGridExecution, true);
  assert.equal(bingx.capabilities.supportsOrderEditing, true);

  const mexcBlocked = resolveFuturesVenue(
    { exchange: "mexc", ...credentials },
    { allowMexcPerp: false }
  );
  assert.equal(mexcBlocked.kind, "blocked");
  assert.equal(mexcBlocked.code, "mexc_perp_disabled");

  const hyper = resolveFuturesVenue({ exchange: "hyperliquid", ...credentials });
  assert.equal(hyper.kind, "adapter");
  assert.equal(hyper.capabilities.supportsGridExecution, true);
  assert.equal(hyper.capabilities.adapterFactoryAvailable, true);
  assert.equal(hyper.capabilities.supportsPositionClose, true);
  assert.equal(hyper.capabilities.supportsPositionTpSl, true);

  const mexc = resolveFuturesVenue({ exchange: "mexc", ...credentials }, { allowMexcPerp: true });
  assert.equal(mexc.kind, "adapter");
  assert.equal(mexc.capabilities.supportsPositionClose, true);
  assert.equal(mexc.capabilities.supportsPositionTpSl, true);
});

test("createPaperExecutionContext uses the shared paper runtime contract", () => {
  const context = createPaperExecutionContext({
    marketType: "perp",
    marketDataExchange: "hyperliquid",
    marketDataExchangeAccountId: "acc_1"
  });

  assert.equal(context.executionVenue, "paper");
  assert.equal(context.runtimeContract.executionVenue, "paper");
  assert.equal(context.runtimeContract.marketDataLinkMode, "linked_live_venue");
  assert.equal(context.linkedMarketData.marketDataVenue, "hyperliquid");
  assert.equal(context.linkedMarketData.exchangeAccountId, "acc_1");
  assert.equal(context.linkedMarketData.supported, true);
  assert.equal(typeof context.simulationPolicy.makerFeeBps, "number");
  assert.equal(typeof context.simulationPolicy.takerFeeBps, "number");
  assert.equal(typeof context.simulationPolicy.marketOrderSlippageBps, "number");
  assert.equal(typeof context.simulationPolicy.stopOrderSlippageBps, "number");
  assert.equal(typeof context.simulationPolicy.limitPartialFillRatio, "number");
  assert.equal(typeof context.simulationPolicy.initialMarginRatio, "number");
  assert.equal(typeof context.simulationPolicy.maintenanceMarginRatio, "number");
});

test("createPaperExecutionContextForVenueResolution reuses the paper runtime from venue resolution", () => {
  const paper = resolveFuturesVenue({ exchange: "paper", ...credentials });
  assert.equal(paper.kind, "paper");
  if (paper.kind !== "paper") return;

  const context = createPaperExecutionContextForVenueResolution(paper, {
    marketType: "perp",
    marketDataExchange: "bitget",
    marketDataExchangeAccountId: "acc_2"
  });

  assert.equal(context.executionVenue, "paper");
  assert.equal(context.runtimeContract, paper.paperRuntime);
  assert.equal(context.linkedMarketData.marketDataVenue, "bitget");
  assert.equal(context.linkedMarketData.exchangeAccountId, "acc_2");
});

test("futures venue capability registry exposes enforceable feature support by venue", () => {
  const bitget = getFuturesVenueCapabilities("bitget");
  assert.deepEqual(bitget.supportedOrderTypes, ["market", "limit"]);
  assert.deepEqual(bitget.supportedPositionModes, ["one-way", "hedge"]);
  assert.equal(bitget.supportsVaultExecution, false);

  const hyperliquid = getFuturesVenueCapabilities("hyperliquid");
  assert.deepEqual(hyperliquid.supportedPositionModes, ["one-way"]);
  assert.equal(hyperliquid.supportsVaultExecution, true);
  assert.equal(hyperliquid.supportsOrderEditing, true);
  assert.equal(hyperliquid.supportsPositionClose, true);
  assert.equal(hyperliquid.supportsPositionTpSl, true);

  const paper = getFuturesVenueCapabilities("paper");
  assert.equal(paper.supportsBalanceReads, true);
  assert.equal(paper.supportsTransfers, false);
  assert.equal(paper.supportsGridExecution, true);
  assert.equal(paper.supportsOrderEditing, true);

  const mexc = getFuturesVenueCapabilities("mexc");
  assert.equal(mexc.supportsPositionClose, true);
  assert.equal(mexc.supportsPositionTpSl, true);
  assert.equal(mexc.supportsOrderEditing, true);

  const binance = getFuturesVenueCapabilities("binance");
  assert.equal(binance.connectorKind, "live_adapter");
  assert.equal(binance.adapterFactoryAvailable, true);
  assert.equal(binance.supportsPerpExecution, true);
  assert.equal(binance.supportsLeverage, true);
  assert.equal(binance.supportsMarginModeControl, true);
  assert.equal(binance.supportsOrderEditing, true);

  const bingx = getFuturesVenueCapabilities("bingx");
  assert.equal(bingx.connectorKind, "live_adapter");
  assert.equal(bingx.adapterFactoryAvailable, true);
  assert.equal(bingx.supportsPerpExecution, true);
  assert.equal(bingx.supportsLeverage, true);
  assert.equal(bingx.supportsMarginModeControl, true);
  assert.equal(bingx.supportsOrderEditing, true);
  assert.equal(bingx.supportsPositionTpSl, true);
});

test("futures venue capability validation blocks high-risk mismatches per venue", () => {
  const hyperliquid = validateFuturesVenueRequirements(
    getFuturesVenueCapabilities("hyperliquid"),
    [{ feature: "position_mode", positionMode: "hedge" }]
  );
  assert.equal(hyperliquid.ok, false);
  if (!hyperliquid.ok) {
    assert.equal(hyperliquid.reason, "venue_position_mode_unsupported");
  }

  const binance = validateFuturesVenueRequirements(
    getFuturesVenueCapabilities("binance"),
    [{ feature: "perp_execution" }]
  );
  assert.equal(binance.ok, true);

  const bingx = validateFuturesVenueRequirements(
    getFuturesVenueCapabilities("bingx"),
    [{ feature: "position_tpsl" }, { feature: "position_close" }]
  );
  assert.equal(bingx.ok, true);

  const bitget = validateFuturesVenueRequirements(
    getFuturesVenueCapabilities("bitget"),
    [{ feature: "order_editing" }]
  );
  assert.equal(bitget.ok, true);
});

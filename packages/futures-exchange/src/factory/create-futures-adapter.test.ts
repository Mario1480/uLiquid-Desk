import assert from "node:assert/strict";
import test from "node:test";
import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter } from "../mexc/mexc.adapter.js";
import {
  FuturesAdapterFactoryError,
  createFuturesAdapter,
  resolveFuturesVenue
} from "./create-futures-adapter.js";

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

  await Promise.all([
    bitget.close(),
    hyper.close(),
    mexc.close()
  ]);
});

test("createFuturesAdapter enforces exchange policy flags", () => {
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
    () => createFuturesAdapter({ exchange: "binance", ...credentials }),
    (error: unknown) =>
      error instanceof FuturesAdapterFactoryError && error.code === "binance_market_data_only"
  );
});

test("resolveFuturesVenue exposes explicit capabilities and policy shape", () => {
  const paper = resolveFuturesVenue({ exchange: "paper", ...credentials });
  assert.equal(paper.kind, "paper");
  assert.equal(paper.code, "paper_account_requires_market_data_resolution");
  assert.equal(paper.capabilities.supportsPerpExecution, true);
  assert.equal(paper.capabilities.requiresLinkedMarketData, true);
  assert.equal(paper.capabilities.adapterFactoryAvailable, false);
  assert.equal(paper.paperRuntime?.executionVenue, "paper");
  assert.equal(paper.paperRuntime?.marketDataLinkMode, "linked_live_venue");
  assert.deepEqual(paper.paperRuntime?.supportedMarketTypes, ["spot", "perp"]);

  const binance = resolveFuturesVenue({ exchange: "binance", ...credentials });
  assert.equal(binance.kind, "market_data_only");
  assert.equal(binance.code, "binance_market_data_only");
  assert.equal(binance.capabilities.supportsPerpMarketData, true);
  assert.equal(binance.capabilities.supportsPerpExecution, false);

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
});

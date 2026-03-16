import assert from "node:assert/strict";
import test from "node:test";
import { createPaperExecutionContext } from "@mm/futures-exchange";
import {
  buildSharedExecutionVenue,
  executeSharedExecutionPipeline,
  normalizeSharedExecutionResponse,
  validateSharedExecutionVenue
} from "./executionFoundation.js";

test("shared execution pipeline blocks market-data-only venues before execution", async () => {
  let executed = false;

  const response = await executeSharedExecutionPipeline({
    request: {
      domain: "runner",
      action: "place_order",
      symbol: "BTC/USDT",
      venue: buildSharedExecutionVenue({
        executionVenue: "binance",
        marketDataVenue: "binance"
      })
    },
    execute: async () => {
      executed = true;
      return {
        status: "executed",
        reason: "should_not_run"
      };
    }
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.reason, "execution_venue_market_data_only");
  assert.equal(executed, false);
});

test("shared execution pipeline blocks unsupported paper market-data links", async () => {
  const paperContext = createPaperExecutionContext({
    marketType: "perp",
    marketDataExchange: "paper"
  });

  const response = validateSharedExecutionVenue({
    domain: "manual",
    action: "place_order",
    symbol: "BTCUSDT",
    venue: buildSharedExecutionVenue({
      executionVenue: "paper",
      marketDataVenue: "paper",
      paperContext
    })
  });

  assert.equal(response?.status, "blocked");
  assert.equal(response?.reason, "paper_perp_requires_supported_market_data");
});

test("shared execution pipeline normalizes engine responses and emits metadata", async () => {
  const events: string[] = [];

  const response = await executeSharedExecutionPipeline({
    request: {
      domain: "prediction_copier",
      action: "place_order",
      symbol: "btc-usdt",
      metadata: {
        usedPreparedPlan: true
      },
      venue: buildSharedExecutionVenue({
        executionVenue: "hyperliquid"
      })
    },
    emitEvent: async (event) => {
      events.push(event.phase);
    },
    execute: async () => ({
      status: "accepted",
      orderId: "ord_123"
    })
  });

  assert.equal(response.status, "executed");
  assert.deepEqual(response.orderIds, ["ord_123"]);
  assert.equal(response.request.symbol, "BTCUSDT");
  assert.equal(response.metadata.executionFoundation, "shared_execution_pipeline_v1");
  assert.equal(response.metadata.executionVenue, "hyperliquid");
  assert.equal(response.metadata.engineStatus, "accepted");
  assert.deepEqual(events, ["requested", "executed"]);
});

test("normalizeSharedExecutionResponse preserves custom statuses", () => {
  const response = normalizeSharedExecutionResponse(
    {
      domain: "vault",
      action: "provider_control",
      metadata: {
        providerKey: "mock"
      }
    },
    {
      status: "noop",
      reason: "already_running",
      metadata: {
        providerAction: "start"
      }
    }
  );

  assert.equal(response.status, "noop");
  assert.equal(response.reason, "already_running");
  assert.equal(response.metadata.providerKey, "mock");
  assert.equal(response.metadata.providerAction, "start");
});

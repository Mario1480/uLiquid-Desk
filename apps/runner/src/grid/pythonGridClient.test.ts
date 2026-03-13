import assert from "node:assert/strict";
import test from "node:test";
import {
  GridPlannerClientError,
  runGridPlan,
  type GridPlanRequest,
} from "./pythonGridClient.js";

const originalFetch = globalThis.fetch;
const originalEnv = {
  PY_GRID_ENABLED: process.env.PY_GRID_ENABLED,
  PY_GRID_URL: process.env.PY_GRID_URL,
  PY_GRID_FALLBACK_URL: process.env.PY_GRID_FALLBACK_URL,
  PY_GRID_AUTH_TOKEN: process.env.PY_GRID_AUTH_TOKEN,
  PY_STRATEGY_AUTH_TOKEN: process.env.PY_STRATEGY_AUTH_TOKEN,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function installBaseEnv(): void {
  process.env.PY_GRID_ENABLED = "true";
  process.env.PY_GRID_URL = "http://grid.test";
  delete process.env.PY_GRID_FALLBACK_URL;
  delete process.env.PY_GRID_AUTH_TOKEN;
  delete process.env.PY_STRATEGY_AUTH_TOKEN;
}

function makePlanPayload(): GridPlanRequest {
  return {
    instanceId: "grid_1",
    mode: "long",
    gridMode: "arithmetic",
    lowerPrice: 60000,
    upperPrice: 80000,
    gridCount: 10,
    investUsd: 500,
    leverage: 5,
    markPrice: 70000,
    slippagePct: 0.1,
    openOrders: [],
  };
}

function makePlanResponse() {
  return {
    intents: [],
    nextStateJson: {},
    metricsDelta: {},
    windowMeta: {},
    risk: {},
    reasonCodes: [],
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test("runGridPlan prefers v2 envelope responses", async () => {
  installBaseEnv();
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      protocolVersion: "grid.v2",
      requestId: "req_1",
      ok: true,
      payload: makePlanResponse(),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await runGridPlan(makePlanPayload());

  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(calls, ["http://grid.test/v2/grid/plan"]);
});

test("runGridPlan falls back to v1 when v2 is unavailable", async () => {
  installBaseEnv();
  const calls: string[] = [];
  let callIndex = 0;
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    callIndex += 1;
    if (callIndex === 1) {
      return new Response(JSON.stringify({ detail: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(makePlanResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await runGridPlan(makePlanPayload());

  assert.deepEqual(result.intents, []);
  assert.deepEqual(calls, [
    "http://grid.test/v2/grid/plan",
    "http://grid.test/v1/grid/plan",
  ]);
});

test("runGridPlan surfaces structured v2 envelope errors", async () => {
  installBaseEnv();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_2",
    ok: false,
    error: {
      code: "grid_plan_failed",
      message: "planner exploded",
      retryable: false,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

  await assert.rejects(
    () => runGridPlan(makePlanPayload()),
    (error: unknown) => {
      assert.ok(error instanceof GridPlannerClientError);
      assert.equal(error.code, "grid_plan_failed");
      assert.match(error.message, /planner exploded/i);
      return true;
    }
  );
});

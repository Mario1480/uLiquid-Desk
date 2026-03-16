import assert from "node:assert/strict";
import test from "node:test";
import {
  GridPythonClientError,
  requestGridPlan,
  requestGridPreview,
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

function makePreviewPayload() {
  return {
    mode: "long",
    gridMode: "arithmetic",
    lowerPrice: 60000,
    upperPrice: 80000,
    gridCount: 10,
    investUsd: 500,
    leverage: 5,
    markPrice: 70000,
    slippagePct: 0.1,
  };
}

function makePreviewResponse() {
  return {
    levels: [{ index: 0, price: 60000 }],
    perGridQty: 0.01,
    perGridNotional: 100,
    profitPerGridNetPct: 0.2,
    profitPerGridNetUsd: 0.2,
    warnings: [],
    validationErrors: [],
  };
}

function makePlanPayload() {
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

test("requestGridPreview prefers v2 envelope responses", async () => {
  installBaseEnv();
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      protocolVersion: "grid.v2",
      requestId: "req_1",
      ok: true,
      payload: makePreviewResponse(),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await requestGridPreview(makePreviewPayload());

  assert.equal(result.perGridQty, 0.01);
  assert.deepEqual(calls, ["http://grid.test/v2/grid/preview"]);
});

test("requestGridPreview falls back to v1 when v2 is unavailable", async () => {
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
    return new Response(JSON.stringify(makePreviewResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await requestGridPreview(makePreviewPayload());

  assert.equal(result.perGridNotional, 100);
  assert.deepEqual(calls, [
    "http://grid.test/v2/grid/preview",
    "http://grid.test/v1/grid/preview",
  ]);
});

test("requestGridPreview forwards crossSideConfig in v2 envelope payload", async () => {
  installBaseEnv();
  let requestBody: any = null;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({
      protocolVersion: "grid.v2",
      requestId: "req_cross",
      ok: true,
      payload: makePreviewResponse(),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await requestGridPreview({
    ...makePreviewPayload(),
    mode: "cross",
    crossSideConfig: {
      long: { lowerPrice: 60000, upperPrice: 70000, gridCount: 6 },
      short: { lowerPrice: 72000, upperPrice: 80000, gridCount: 9 },
    },
  });

  assert.deepEqual(requestBody?.payload?.crossSideConfig, {
    long: { lowerPrice: 60000, upperPrice: 70000, gridCount: 6 },
    short: { lowerPrice: 72000, upperPrice: 80000, gridCount: 9 },
  });
});

test("requestGridPlan surfaces structured v2 envelope errors", async () => {
  installBaseEnv();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    protocolVersion: "grid.v2",
    requestId: "req_2",
    ok: false,
    error: {
      code: "grid_payload_invalid",
      message: "grid plan payload validation failed",
      retryable: false,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

  await assert.rejects(
    () => requestGridPlan(makePlanPayload()),
    (error: unknown) => {
      assert.ok(error instanceof GridPythonClientError);
      assert.equal(error.code, "grid_payload_invalid");
      assert.match(error.message, /validation failed/i);
      return true;
    }
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PythonStrategyClientError,
  listPythonStrategies,
  runPythonStrategy
} from "./pythonClient.js";

const originalFetch = globalThis.fetch;

function withMockFetch(fn: typeof fetch) {
  (globalThis as any).fetch = fn;
}

function restoreFetch() {
  (globalThis as any).fetch = originalFetch;
}

test("runPythonStrategy normalizes successful response", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async (input) => {
    assert.equal(String(input), "http://python.local/v2/strategies/run");
    return new Response(JSON.stringify({
      protocolVersion: "strategy.v2",
      requestId: "123",
      ok: true,
      payload: {
        allow: true,
        score: 92,
        reasonCodes: ["ok"],
        tags: ["trend_up"],
        explanation: "ok",
        meta: { runtimeMs: 12 }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await runPythonStrategy({
    strategyType: "regime_gate",
    config: {},
    featureSnapshot: {},
    context: {},
    trace: { runId: "123" }
  });
  assert.equal(result.allow, true);
  assert.equal(result.score, 92);
  assert.equal(result.meta.engine, "python");
  restoreFetch();
});

test("listPythonStrategies prefers v2 registry envelope", async () => {
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async (input) => {
    assert.equal(String(input), "http://python.local/v2/strategies");
    return new Response(JSON.stringify({
      protocolVersion: "strategy.v2",
      requestId: null,
      ok: true,
      payload: {
        items: [{
          type: "smart_money_concept",
          name: "SMC",
          version: "1.0.0",
          defaultConfig: { enabled: true },
          uiSchema: { title: "SMC" }
        }]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const items = await listPythonStrategies();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.type, "smart_money_concept");
  restoreFetch();
});

test("runPythonStrategy falls back to v1 when v2 is unavailable", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  const calls: string[] = [];
  withMockFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v2/strategies/run")) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      allow: true,
      score: 74,
      reasonCodes: ["legacy"],
      tags: ["legacy_ok"],
      explanation: "legacy",
      meta: {}
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await runPythonStrategy({
    strategyType: "regime_gate",
    config: {},
    featureSnapshot: {},
    context: {}
  });
  assert.deepEqual(calls, [
    "http://python.local/v2/strategies/run",
    "http://python.local/v1/strategies/run"
  ]);
  assert.equal(result.score, 74);
  restoreFetch();
});

test("runPythonStrategy surfaces structured v2 errors", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async () => {
    return new Response(JSON.stringify({
      protocolVersion: "strategy.v2",
      requestId: "abc",
      ok: false,
      error: {
        code: "strategy_payload_invalid",
        message: "payload invalid",
        retryable: false,
        details: {}
      }
    }), { status: 422, headers: { "content-type": "application/json" } });
  });

  await assert.rejects(
    () => runPythonStrategy({
      strategyType: "regime_gate",
      config: {},
      featureSnapshot: {},
      context: {},
      trace: { runId: "abc" }
    }),
    (error: unknown) => {
      assert.equal(error instanceof PythonStrategyClientError, true);
      assert.equal((error as PythonStrategyClientError).code, "strategy_payload_invalid");
      assert.equal((error as PythonStrategyClientError).message, "payload invalid");
      return true;
    }
  );
  restoreFetch();
});

test("runPythonStrategy throws for invalid json", async () => {
  process.env.PY_STRATEGY_ENABLED = "true";
  process.env.PY_STRATEGY_URL = "http://python.local";
  withMockFetch(async () => {
    return new Response("{invalid", { status: 200, headers: { "content-type": "application/json" } });
  });

  await assert.rejects(
    () => runPythonStrategy({
      strategyType: "regime_gate",
      config: {},
      featureSnapshot: {},
      context: {}
    }),
    (error: unknown) => {
      assert.equal(error instanceof PythonStrategyClientError, true);
      assert.equal((error as PythonStrategyClientError).code, "invalid_json");
      return true;
    }
  );
  restoreFetch();
});

test("runPythonStrategy throws when disabled", async () => {
  process.env.PY_STRATEGY_ENABLED = "false";
  await assert.rejects(
    () => runPythonStrategy({
      strategyType: "regime_gate",
      config: {},
      featureSnapshot: {},
      context: {}
    }),
    (error: unknown) => {
      assert.equal(error instanceof PythonStrategyClientError, true);
      assert.equal((error as PythonStrategyClientError).code, "disabled");
      return true;
    }
  );
});

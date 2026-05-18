import assert from "node:assert/strict";
import test from "node:test";
import {
  getSaladRuntimeStatus,
  validateSaladRuntimeApiBaseUrl
} from "./saladRuntime.js";

async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test("validateSaladRuntimeApiBaseUrl blocks private production targets", async () => {
  assert.deepEqual(
    await validateSaladRuntimeApiBaseUrl("https://127.0.0.1:9000/api/public", { production: true }),
    { ok: false, reason: "private_network_blocked" }
  );
});

test("validateSaladRuntimeApiBaseUrl blocks non-Salad production hosts", async () => {
  assert.deepEqual(
    await validateSaladRuntimeApiBaseUrl("https://93.184.216.34/api/public", { production: true }),
    { ok: false, reason: "salad_api_host_not_allowed" }
  );
});

test("validateSaladRuntimeApiBaseUrl allows local development targets", async () => {
  const safe = await validateSaladRuntimeApiBaseUrl("http://127.0.0.1:9000/api/public", {
    production: false
  });
  assert.equal(safe.ok, true);
  if (safe.ok) {
    assert.equal(safe.baseUrl, "http://127.0.0.1:9000/api/public");
  }
});

test("getSaladRuntimeStatus rejects unsafe targets before sending Salad-Api-Key", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    await withNodeEnv("production", async () => {
      const result = await getSaladRuntimeStatus({
        apiBaseUrl: "https://127.0.0.1:9000/api/public",
        organization: "org",
        project: "project",
        container: "container"
      }, "salad-secret-key");

      assert.equal(fetchCalled, false);
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, "request_failed");
      assert.equal(result.message, "unsafe_salad_api_base_url:private_network_blocked");
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

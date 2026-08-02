import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOllamaProxyHealthUrl,
  createExternalHealthService,
  describeOllamaHealthFailure
} from "./externalHealth.js";

test("buildOllamaProxyHealthUrl maps /v1 base URLs to /health", () => {
  assert.equal(
    buildOllamaProxyHealthUrl("http://salad-proxy:8088/v1"),
    "http://salad-proxy:8088/health"
  );
  assert.equal(
    buildOllamaProxyHealthUrl("http://localhost:11434/v1/"),
    "http://localhost:11434/health"
  );
});

test("describeOllamaHealthFailure explains proxy-healthy 404 failures", () => {
  assert.equal(
    describeOllamaHealthFailure({
      httpStatus: 404,
      payload: null,
      baseUrl: "http://salad-proxy:8088/v1",
      model: "qwen3:30b",
      proxyHealthy: true
    }),
    'salad_proxy_healthy_but_chat_404: configured model "qwen3:30b" not available; check AI model, base URL, or Salad upstream host'
  );
});

test("describeOllamaHealthFailure falls back to provider status message otherwise", () => {
  assert.equal(
    describeOllamaHealthFailure({
      httpStatus: 404,
      payload: { error: { message: "model not found" } },
      baseUrl: "http://salad-proxy:8088/v1",
      model: "qwen3:30b",
      proxyHealthy: false
    }),
    "model not found"
  );
});

function createAiHealthDeps(overrides: {
  provider?: string;
  model?: string;
  apiKey?: string | null;
  baseUrl?: string;
}) {
  const provider = overrides.provider ?? "vllm";
  const model = overrides.model ?? "Qwen/Qwen2.5-32B-Instruct";
  return {
    db: {
      globalSetting: {
        findUnique: async () => ({ value: {} })
      }
    },
    GLOBAL_SETTING_API_KEYS_KEY: "admin.apiKeys",
    parseStoredApiKeysSettings: (value: unknown) => value,
    resolveEffectiveAiProvider: () => ({ provider, source: "db" }),
    resolveEffectiveAiBaseUrl: () => ({ baseUrl: overrides.baseUrl ?? "http://salad-vllm-proxy:8089/v1", source: "db" }),
    resolveEffectiveAiModel: () => ({ model, source: model ? "db" : "default" }),
    resolveEffectiveAiApiKey: () => ({
      apiKey: overrides.apiKey === undefined ? "vllm-key" : overrides.apiKey,
      source: overrides.apiKey ? "db" : "none",
      decryptError: false
    }),
    resolveOllamaProfileAiApiKey: () => ({ apiKey: null, source: "none", decryptError: false }),
    resolveAiProfileApiKey: () => ({ apiKey: "vllm-key", source: "db", decryptError: false }),
    resolveEffectiveFmpApiKey: () => ({ apiKey: null, source: "none", decryptError: false }),
    fetchFmpEconomicEvents: async () => [],
    getSaladRuntimeStatus: async () => ({ ok: true }),
    resolveSaladRuntimeConfig: () => ({
      isConfigured: true,
      missingFields: [],
      config: { apiBaseUrl: "https://api.salad.com/api/public", organization: "org", project: "proj", container: "ctr" }
    })
  };
}

test("checkAi uses a usable completion budget for OpenAI GPT-5 health checks", async () => {
  const previousFetch = globalThis.fetch;
  let requestedBody: any = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const service = createExternalHealthService(createAiHealthDeps({
      provider: "openai",
      model: "gpt-5-nano",
      apiKey: "openai-key",
      baseUrl: "https://api.openai.com/v1"
    }));
    const result = await service.checkAi();
    assert.equal(result.status, "ok");
    assert.equal(requestedBody.model, "gpt-5-nano");
    assert.equal(requestedBody.max_completion_tokens, 128);
    assert.equal("max_tokens" in requestedBody, false);
    assert.equal("temperature" in requestedBody, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("checkAi reports missing_model for vllm without configured model", async () => {
  const service = createExternalHealthService(createAiHealthDeps({ model: "" }));
  const result = await service.checkAi();
  assert.equal(result.provider, "vllm");
  assert.equal(result.status, "missing_model");
  assert.equal(result.state, "skipped");
});

test("checkAi pings vllm chat completions successfully", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const service = createExternalHealthService(createAiHealthDeps({}));
    const result = await service.checkAi();
    assert.equal(requestedUrl, "http://salad-vllm-proxy:8089/v1/chat/completions");
    assert.equal(result.provider, "vllm");
    assert.equal(result.status, "ok");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("checkAi uses neutral OpenAI-compatible vllm health errors", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "model not found" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  try {
    const service = createExternalHealthService(createAiHealthDeps({}));
    const result = await service.checkAi();
    assert.equal(result.provider, "vllm");
    assert.equal(result.status, "error");
    assert.equal(result.message, "model not found");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

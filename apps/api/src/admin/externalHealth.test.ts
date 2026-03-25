import test from "node:test";
import assert from "node:assert/strict";
import { buildOllamaProxyHealthUrl, describeOllamaHealthFailure } from "./externalHealth.js";

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

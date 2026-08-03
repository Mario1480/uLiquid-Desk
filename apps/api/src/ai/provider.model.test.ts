import test from "node:test";
import assert from "node:assert/strict";
import {
  hasUsableAiChatMessageOutput,
  isSelfHostedAiProvider,
  normalizeAiProvider,
  resolveAiModelFromConfig,
  shouldChargeAiTokens
} from "./provider.js";

test("hasUsableAiChatMessageOutput rejects empty completions and accepts text or tool calls", () => {
  assert.equal(hasUsableAiChatMessageOutput({ role: "assistant", content: null }), false);
  assert.equal(hasUsableAiChatMessageOutput({ role: "assistant", content: "  " }), false);
  assert.equal(hasUsableAiChatMessageOutput({ role: "assistant", content: "analysis ready" }), true);
  assert.equal(hasUsableAiChatMessageOutput({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call-1", type: "function", function: { name: "market_get_quote", arguments: "{}" } }]
  }), true);
});

test("resolveAiModelFromConfig prefers db model over env model", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: "gpt-5-mini",
    envModel: "gpt-4o-mini"
  });
  assert.equal(resolved.model, "gpt-5-mini");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig falls back to env model when db model is missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: "gpt-4.1-nano"
  });
  assert.equal(resolved.model, "gpt-4.1-nano");
  assert.equal(resolved.source, "env");
});

test("resolveAiModelFromConfig falls back to default when db and env are missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "gpt-4o-mini");
  assert.equal(resolved.source, "default");
});

test("resolveAiModelFromConfig ignores invalid db model and uses env when valid", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: "gpt-4o",
    envModel: "gpt-5-nano"
  });
  assert.equal(resolved.model, "gpt-5-nano");
  assert.equal(resolved.source, "env");
});

test("resolveAiModelFromConfig ignores invalid env model and uses default", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: "gpt-4o"
  });
  assert.equal(resolved.model, "gpt-4o-mini");
  assert.equal(resolved.source, "default");
});

test("resolveAiModelFromConfig allows free-form ollama model names", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "ollama",
    dbModel: "qwen3:8b",
    envModel: "llama3.1:8b"
  });
  assert.equal(resolved.model, "qwen3:8b");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig allows free-form vllm model names", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "vllm",
    dbModel: "Qwen/Qwen2.5-32B-Instruct",
    envModel: "NousResearch/Hermes-3-Llama-3.1-8B"
  });
  assert.equal(resolved.model, "Qwen/Qwen2.5-32B-Instruct");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig falls back to ollama default model", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "ollama",
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "qwen3:8b");
  assert.equal(resolved.source, "default");
});

test("resolveAiModelFromConfig requires explicit vllm model", () => {
  const resolved = resolveAiModelFromConfig({
    provider: "vllm",
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "");
  assert.equal(resolved.source, "default");
});

test("normalizeAiProvider accepts vllm and self-hosted helper includes vllm", () => {
  assert.equal(normalizeAiProvider("vllm"), "vllm");
  assert.equal(isSelfHostedAiProvider("ollama"), true);
  assert.equal(isSelfHostedAiProvider("vllm"), true);
  assert.equal(isSelfHostedAiProvider("openai"), false);
});

test("shouldChargeAiTokens only charges token billing for openai", () => {
  assert.equal(shouldChargeAiTokens("openai"), true);
  assert.equal(shouldChargeAiTokens("ollama"), false);
  assert.equal(shouldChargeAiTokens("vllm"), false);
});

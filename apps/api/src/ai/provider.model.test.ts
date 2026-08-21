import test from "node:test";
import assert from "node:assert/strict";
import {
  getAiFailureBillingSettlement,
  hasUsableAiChatMessageOutput,
  isSelfHostedAiProvider,
  normalizeAiProvider,
  resolveAiBillingAttribution,
  resolveAiModelFromConfig,
  settleIncompleteAiFailureUsage,
  shouldChargeAiCredits
} from "./provider.js";
import { OpenAiResponsesIncompleteError } from "./credits/responsesProvider.js";

test("AI billing attribution requires a scope and makes platform calls explicit", () => {
  assert.deepEqual(resolveAiBillingAttribution({
    billingUserId: "  user-1  ",
    billingScope: "  position_copilot  "
  }), {
    userId: "user-1",
    scope: "position_copilot",
    mode: "user"
  });
  assert.deepEqual(resolveAiBillingAttribution({
    billingUserId: null,
    billingScope: "prediction_explainer"
  }), {
    userId: null,
    scope: "prediction_explainer",
    mode: "platform"
  });
  assert.throws(() => resolveAiBillingAttribution({ billingUserId: "user-1", billingScope: "  " }), /ai_billing_scope_missing/);
});

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
    dbModel: "gpt-5.6-terra",
    envModel: "gpt-5.6-luna"
  });
  assert.equal(resolved.model, "gpt-5.6-terra");
  assert.equal(resolved.source, "db");
});

test("resolveAiModelFromConfig falls back to env model when db model is missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: "gpt-5.6-sol"
  });
  assert.equal(resolved.model, "gpt-5.6-sol");
  assert.equal(resolved.source, "env");
});

test("resolveAiModelFromConfig falls back to default when db and env are missing", () => {
  const resolved = resolveAiModelFromConfig({
    dbModel: null,
    envModel: null
  });
  assert.equal(resolved.model, "gpt-5.6-luna");
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
  assert.equal(resolved.model, "gpt-5.6-luna");
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

test("shouldChargeAiCredits only charges token billing for openai", () => {
  assert.equal(shouldChargeAiCredits("openai"), true);
  assert.equal(shouldChargeAiCredits("ollama"), false);
  assert.equal(shouldChargeAiCredits("vllm"), false);
});

test("failed provider calls can carry an idempotent billing settlement to outer runtimes", () => {
  const error = Object.assign(new Error("max_output_tokens"), {
    aiBillingSettlement: { chargedCredits: 7n, remainingBalance: 93n }
  });
  assert.deepEqual(getAiFailureBillingSettlement(error), {
    chargedCredits: 7n,
    remainingBalance: 93n
  });
  assert.equal(getAiFailureBillingSettlement(new Error("plain failure")), null);
});

test("incomplete provider usage is recorded and settled before the failure escapes", async () => {
  const error = new OpenAiResponsesIncompleteError(
    "max_output_tokens",
    "resp_1",
    "req_1",
    "default",
    { inputTokens: 120n, cachedInputTokens: 10n, cacheWriteTokens: 0n, outputTokens: 80n, reasoningTokens: 20n }
  );
  const calls: Array<{ name: string; params: any }> = [];
  const settlement = await settleIncompleteAiFailureUsage({
    database: { marker: "db" },
    error,
    runId: "run_1",
    callIndex: 2,
    routing: {
      model: "gpt-5.6-luna",
      modelClass: "standard",
      reasoningEffort: "low",
      maxOutputTokens: 80,
      maxToolRounds: 0,
      reasonCode: "test"
    },
    latencyMs: 250
  }, {
    recordUsage: async (params: any) => {
      calls.push({ name: "record", params });
      return {};
    },
    settleRun: async (params: any) => {
      calls.push({ name: "settle", params });
      return { chargedCredits: 7n, remainingBalance: 93n };
    }
  });

  assert.deepEqual(calls.map((call) => call.name), ["record", "settle"]);
  assert.equal(calls[0].params.status, "FAILED");
  assert.equal(calls[0].params.errorCode, "max_output_tokens");
  assert.deepEqual(calls[0].params.usage, error.usage);
  assert.deepEqual(settlement, { chargedCredits: 7n, remainingBalance: 93n });
  assert.deepEqual(getAiFailureBillingSettlement(error), settlement);
});

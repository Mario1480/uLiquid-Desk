import assert from "node:assert/strict";
import test from "node:test";
import { callOpenAiResponses } from "./responsesProvider.js";

test("Responses provider sends fixed default tier and parses structured usage", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      id: "resp_test",
      status: "completed",
      model: "gpt-5.6-luna",
      service_tier: "default",
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
        output_tokens: 40,
        output_tokens_details: { reasoning_tokens: 12 },
        total_tokens: 140
      }
    }), { status: 200, headers: { "x-request-id": "req_test" } });
  }) as typeof fetch;
  try {
    const result = await callOpenAiResponses({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-luna",
      messages: [{ role: "system", content: "Be concise" }, { role: "user", content: "Hello" }],
      maxOutputTokens: 200,
      reasoningEffort: "low",
      signal: new AbortController().signal
    });
    assert.equal(requestBody.service_tier, "default");
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.instructions, "Be concise");
    assert.deepEqual(result.usage, { inputTokens: 100n, cachedInputTokens: 20n, cacheWriteTokens: 10n, outputTokens: 40n, reasoningTokens: 12n });
    assert.equal(result.requestId, "req_test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses provider maps chat tool calls and tool outputs", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      id: "resp_tool",
      status: "completed",
      model: "gpt-5.6-terra",
      service_tier: "default",
      output: [{ type: "function_call", call_id: "call_2", name: "market_get", arguments: "{\"symbol\":\"BTC\"}" }],
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 } }
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await callOpenAiResponses({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-terra",
      messages: [
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "market_get", arguments: "{}" } }] },
        { role: "tool", content: "{\"price\":1}", tool_call_id: "call_1", name: "market_get" }
      ],
      tools: [{ type: "function", function: { name: "market_get", parameters: { type: "object" } } }],
      toolChoice: "auto",
      maxOutputTokens: 200,
      signal: new AbortController().signal
    });
    assert.equal(requestBody.input[0].type, "function_call");
    assert.equal(requestBody.input[1].type, "function_call_output");
    assert.equal(requestBody.tools[0].name, "market_get");
    assert.equal(result.toolCalls[0].id, "call_2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

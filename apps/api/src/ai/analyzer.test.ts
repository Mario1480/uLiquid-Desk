import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithAiGuards, resetAiAnalyzerState } from "./analyzer.js";

test("analyzeWithAiGuards does not cache provider fallback results", async () => {
  resetAiAnalyzerState();
  let computeCalls = 0;

  const first = await analyzeWithAiGuards({
    cacheKey: "same-input",
    ttlSec: 60,
    compute: async () => {
      computeCalls += 1;
      throw new Error("provider_down");
    },
    fallback: () => "fallback"
  });

  assert.equal(first.fallbackUsed, true);
  assert.equal(first.cacheHit, false);

  const second = await analyzeWithAiGuards({
    cacheKey: "same-input",
    ttlSec: 60,
    compute: async () => {
      computeCalls += 1;
      return "real-ai";
    },
    fallback: () => "fallback"
  });

  assert.equal(second.value, "real-ai");
  assert.equal(second.fallbackUsed, false);
  assert.equal(second.cacheHit, false);
  assert.equal(computeCalls, 2);
});

test("analyzeWithAiGuards does not turn rate-limit fallback into cache hit", async () => {
  resetAiAnalyzerState();
  let fallbackCalls = 0;

  const first = await analyzeWithAiGuards({
    cacheKey: "rate-limited-input",
    rateLimitPerMin: 0,
    ttlSec: 60,
    compute: async () => "real-ai",
    fallback: () => {
      fallbackCalls += 1;
      return "fallback";
    }
  });

  const second = await analyzeWithAiGuards({
    cacheKey: "rate-limited-input",
    rateLimitPerMin: 0,
    ttlSec: 60,
    compute: async () => "real-ai",
    fallback: () => {
      fallbackCalls += 1;
      return "fallback";
    }
  });

  assert.equal(first.fallbackUsed, true);
  assert.equal(first.rateLimited, true);
  assert.equal(first.cacheHit, false);
  assert.equal(second.fallbackUsed, true);
  assert.equal(second.rateLimited, true);
  assert.equal(second.cacheHit, false);
  assert.equal(fallbackCalls, 2);
});

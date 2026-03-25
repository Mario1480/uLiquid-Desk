import test from "node:test";
import assert from "node:assert/strict";
import { parseStoredAiSettings } from "./provider.js";

test("parseStoredAiSettings reads nested ollama profile for active ollama provider", () => {
  const settings = parseStoredAiSettings({
    aiProvider: "ollama",
    aiProfiles: {
      ollama: {
        aiBaseUrl: "http://salad-proxy:8088/v1",
        aiModel: "qwen3:30b"
      }
    }
  });

  assert.equal(settings.aiProvider, "ollama");
  assert.equal(settings.aiApiKey, null);
  assert.equal(settings.aiBaseUrl, "http://salad-proxy:8088/v1");
  assert.equal(settings.aiModel, "qwen3:30b");
});

test("parseStoredAiSettings falls back to legacy top-level values when nested provider values are absent", () => {
  const settings = parseStoredAiSettings({
    aiProvider: "ollama",
    aiBaseUrl: "http://salad-proxy:8088/v1",
    aiModel: "qwen3:30b"
  });

  assert.equal(settings.aiProvider, "ollama");
  assert.equal(settings.aiBaseUrl, "http://salad-proxy:8088/v1");
  assert.equal(settings.aiModel, "qwen3:30b");
});

test("parseStoredAiSettings prefers nested openai profile when active provider is openai", () => {
  const settings = parseStoredAiSettings({
    aiProvider: "openai",
    aiBaseUrl: "http://legacy-ignored.invalid/v1",
    aiModel: "gpt-4o-mini",
    aiProfiles: {
      openai: {
        aiBaseUrl: "https://api.openai.com/v1",
        aiModel: "gpt-5-mini"
      },
      ollama: {
        aiBaseUrl: "http://salad-proxy:8088/v1",
        aiModel: "qwen3:30b"
      }
    }
  });

  assert.equal(settings.aiProvider, "openai");
  assert.equal(settings.aiBaseUrl, "https://api.openai.com/v1");
  assert.equal(settings.aiModel, "gpt-5-mini");
});

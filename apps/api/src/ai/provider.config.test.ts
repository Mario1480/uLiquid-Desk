import test from "node:test";
import assert from "node:assert/strict";
import { parseStoredAiSettings, validateAiProviderBaseUrl } from "./provider.js";

async function withPrivateAiBaseUrlEnvCleared<T>(fn: () => Promise<T>): Promise<T> {
  const previousOllama = process.env.AI_ALLOW_PRIVATE_OLLAMA_BASE_URL;
  const previousVllm = process.env.AI_ALLOW_PRIVATE_VLLM_BASE_URL;
  delete process.env.AI_ALLOW_PRIVATE_OLLAMA_BASE_URL;
  delete process.env.AI_ALLOW_PRIVATE_VLLM_BASE_URL;
  try {
    return await fn();
  } finally {
    if (previousOllama === undefined) delete process.env.AI_ALLOW_PRIVATE_OLLAMA_BASE_URL;
    else process.env.AI_ALLOW_PRIVATE_OLLAMA_BASE_URL = previousOllama;
    if (previousVllm === undefined) delete process.env.AI_ALLOW_PRIVATE_VLLM_BASE_URL;
    else process.env.AI_ALLOW_PRIVATE_VLLM_BASE_URL = previousVllm;
  }
}

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

test("parseStoredAiSettings reads nested vllm profile for active vllm provider", () => {
  const settings = parseStoredAiSettings({
    aiProvider: "vllm",
    aiBaseUrl: "http://legacy-ignored.invalid/v1",
    aiModel: "legacy-model",
    aiProfiles: {
      vllm: {
        aiBaseUrl: "http://salad-vllm-proxy:8089/v1",
        aiModel: "Qwen/Qwen2.5-32B-Instruct"
      },
      ollama: {
        aiBaseUrl: "http://salad-proxy:8088/v1",
        aiModel: "qwen3:30b"
      }
    }
  });

  assert.equal(settings.aiProvider, "vllm");
  assert.equal(settings.aiBaseUrl, "http://salad-vllm-proxy:8089/v1");
  assert.equal(settings.aiModel, "Qwen/Qwen2.5-32B-Instruct");
});

test("validateAiProviderBaseUrl blocks unsafe OpenAI-compatible production targets", async () => {
  assert.deepEqual(
    await validateAiProviderBaseUrl("openai", "http://1.1.1.1/v1", { production: true }),
    { ok: false, reason: "https_required" }
  );
  assert.deepEqual(
    await validateAiProviderBaseUrl("openai", "https://localhost/v1", { production: true }),
    { ok: false, reason: "local_hostname_blocked" }
  );
  assert.deepEqual(
    await validateAiProviderBaseUrl("openai", "https://169.254.169.254/latest", { production: true }),
    { ok: false, reason: "private_network_blocked" }
  );

  const safe = await validateAiProviderBaseUrl("openai", "https://1.1.1.1/v1", { production: true });
  assert.equal(safe.ok, true);
});

test("validateAiProviderBaseUrl only allows private vllm when explicitly enabled", async () => {
  await withPrivateAiBaseUrlEnvCleared(async () => {
    assert.deepEqual(
      await validateAiProviderBaseUrl("vllm", "http://127.0.0.1:8000/v1", {
        production: true,
        allowPrivateVllm: false
      }),
      { ok: false, reason: "https_required" }
    );

    const safe = await validateAiProviderBaseUrl("vllm", "http://127.0.0.1:8000/v1", {
      production: true,
      allowPrivateVllm: true
    });
    assert.equal(safe.ok, true);
  });
});

test("validateAiProviderBaseUrl only allows private ollama when explicitly enabled", async () => {
  await withPrivateAiBaseUrlEnvCleared(async () => {
    assert.deepEqual(
      await validateAiProviderBaseUrl("ollama", "http://127.0.0.1:11434/v1", {
        production: true,
        allowPrivateOllama: false
      }),
      { ok: false, reason: "https_required" }
    );

    const safe = await validateAiProviderBaseUrl("ollama", "http://127.0.0.1:11434/v1", {
      production: true,
      allowPrivateOllama: true
    });
    assert.equal(safe.ok, true);
  });
});

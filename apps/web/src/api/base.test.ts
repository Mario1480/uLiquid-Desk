import assert from "node:assert/strict";
import test from "node:test";
import { apiGet, apiPost, resolveBrowserApiBase } from "../../lib/api.js";
import {
  AUTH_CSRF_COOKIE_NAME,
  resolveAuthCookieNames
} from "../../lib/authCookies.js";

test("derives isolated browser auth cookie names from the environment prefix", () => {
  assert.deepEqual(resolveAuthCookieNames("mm_staging"), {
    prefix: "mm_staging",
    session: "mm_staging_session",
    csrf: "mm_staging_csrf"
  });
  assert.throws(
    () => resolveAuthCookieNames("staging.cookie"),
    /Invalid NEXT_PUBLIC_AUTH_COOKIE_PREFIX/
  );
});

test("keeps production api host when browser host already matches the public panel", () => {
  const resolved = resolveBrowserApiBase("https://api.desk.uliquid.vip", {
    protocol: "https:",
    hostname: "desk.uliquid.vip"
  });

  assert.equal(resolved, "https://api.desk.uliquid.vip");
});

test("maps localhost browser sessions back to the local api even when NEXT_PUBLIC_API_URL points at production", () => {
  const resolved = resolveBrowserApiBase("https://api.desk.uliquid.vip", {
    protocol: "http:",
    hostname: "localhost"
  });

  assert.equal(resolved, "http://localhost:4000");
});

test("maps LAN browser sessions to the same host instead of api.<ip>", () => {
  const resolved = resolveBrowserApiBase("http://localhost:4000", {
    protocol: "http:",
    hostname: "192.168.1.55"
  });

  assert.equal(resolved, "http://192.168.1.55:4000");
});

test("defaults .local hosts to the same machine and port 4000", () => {
  const resolved = resolveBrowserApiBase("", {
    protocol: "http:",
    hostname: "desk.local"
  });

  assert.equal(resolved, "http://desk.local:4000");
});

test("normalizes www hosts to the api subdomain when no explicit browser api is configured", () => {
  const resolved = resolveBrowserApiBase("", {
    protocol: "https:",
    hostname: "www.example.com"
  });

  assert.equal(resolved, "https://api.example.com");
});

test("apiGet avoids JSON content-type so live reads do not trigger CORS preflight", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    await apiGet<{ ok: boolean }>("/health");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const headers = capturedInit?.headers as Record<string, string> | undefined;
  assert.equal(headers?.["Content-Type"], undefined);
  assert.equal(capturedInit?.body, undefined);
});

test("apiPost keeps JSON content-type when a JSON body is sent", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    await apiPost<{ ok: boolean }>("/api/probe", { value: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const headers = capturedInit?.headers as Record<string, string> | undefined;
  assert.equal(headers?.["Content-Type"], "application/json");
  assert.equal(capturedInit?.body, JSON.stringify({ value: 1 }));
});

test("apiPost reads the CSRF token from the configured auth cookie namespace", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let capturedInit: RequestInit | undefined;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: `${AUTH_CSRF_COOKIE_NAME}=csrf-from-configured-cookie` }
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    await apiPost<{ ok: boolean }>("/api/probe", { value: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete (globalThis as { document?: unknown }).document;
  }

  const headers = capturedInit?.headers as Record<string, string> | undefined;
  assert.equal(headers?.["x-csrf-token"], "csrf-from-configured-cookie");
});

test("apiGet retries transient network fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(await apiGet<{ ok: boolean }>("/health"), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 2);
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserApiBase } from "../../lib/api.js";

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

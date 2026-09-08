import assert from "node:assert/strict";
import test from "node:test";
import { TurnstileError, turnstileConfig, verifyTurnstile } from "./turnstileSecurity.js";

const config = {
  hostnames: ["desk.example.test"],
  siteKey: "site-key",
  secret: "secret-key",
  ready: true
};

test("Turnstile configuration rejects incomplete and production test-key configuration", () => {
  assert.equal(turnstileConfig({}).ready, false);
  assert.equal(turnstileConfig({
    NODE_ENV: "production",
    TURNSTILE_ALLOWED_HOSTNAMES: "desk.example.test",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "secret"
  }).ready, false);
  assert.equal(turnstileConfig({
    NODE_ENV: "development",
    TURNSTILE_ALLOWED_HOSTNAMES: "Desk.Example.Test",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret"
  }).ready, true);
});

test("Turnstile validates the exact action and allowed hostname", async () => {
  let requestBody: Record<string, string> | null = null;
  await verifyTurnstile("token", "signup", { ip: "203.0.113.7" } as any, config, async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, hostname: "desk.example.test", action: "signup" }));
  });
  assert.deepEqual(requestBody, {
    secret: "secret-key",
    response: "token",
    remoteip: "203.0.113.7"
  });

  await assert.rejects(
    verifyTurnstile("token", "login", undefined, config, async () => new Response(JSON.stringify({ success: true, hostname: "desk.example.test", action: "signup" }))),
    (error: unknown) => error instanceof TurnstileError && error.code === "turnstile_invalid"
  );
  await assert.rejects(
    verifyTurnstile("token", "signup", undefined, config, async () => new Response(JSON.stringify({ success: true, hostname: "other.example.test", action: "signup" }))),
    (error: unknown) => error instanceof TurnstileError && error.code === "turnstile_invalid"
  );
});

test("Turnstile fails closed when configuration or provider validation is unavailable", async () => {
  await assert.rejects(
    verifyTurnstile("token", "signup", undefined, { ...config, ready: false }),
    (error: unknown) => error instanceof TurnstileError && error.code === "turnstile_unavailable"
  );
  await assert.rejects(
    verifyTurnstile("token", "signup", undefined, config, async () => { throw new Error("network"); }),
    (error: unknown) => error instanceof TurnstileError && error.code === "turnstile_unavailable"
  );
});

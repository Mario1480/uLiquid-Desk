import assert from "node:assert/strict";
import test from "node:test";
import { assertApiEnv } from "./env.js";

function baseProductionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://uliquid:uliquid@localhost:5432/uliquid",
    SECRET_MASTER_KEY: "a".repeat(64),
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD: "CorrectHorseBatteryStaple!",
    POSTGRES_PASSWORD: "postgres-production-password",
    API_PORT: "4000",
    CORS_ORIGINS: "https://desk.example.com",
    SIWE_ALLOWED_DOMAINS: "desk.example.com",
    REDIS_URL: "redis://redis:6379",
    ...overrides
  };
}

test("assertApiEnv requires Redis-backed traffic control in production", () => {
  assert.throws(
    () => assertApiEnv(baseProductionEnv({
      REDIS_URL: undefined,
      API_RATE_LIMIT_REDIS_URL: undefined
    })),
    /API_RATE_LIMIT_REDIS_URL or REDIS_URL is required in production/
  );
});

test("assertApiEnv accepts dedicated Redis traffic control URL in production", () => {
  assert.doesNotThrow(() => assertApiEnv(baseProductionEnv({
    REDIS_URL: undefined,
    API_RATE_LIMIT_REDIS_URL: "rediss://redis.example.com:6379"
  })));
});

test("assertApiEnv rejects non-Redis traffic control URLs", () => {
  assert.throws(
    () => assertApiEnv(baseProductionEnv({
      API_RATE_LIMIT_REDIS_URL: "http://redis.example.com:6379"
    })),
    /API_RATE_LIMIT_REDIS_URL or REDIS_URL must use redis or rediss/
  );
});

test("assertApiEnv does not require Redis traffic control in development", () => {
  assert.doesNotThrow(() => assertApiEnv({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://uliquid:uliquid@localhost:5432/uliquid",
    SECRET_MASTER_KEY: "a".repeat(64)
  }));
});

test("assertApiEnv accepts isolated auth cookie prefixes", () => {
  assert.doesNotThrow(() => assertApiEnv(baseProductionEnv({
    NEXT_PUBLIC_AUTH_COOKIE_PREFIX: "mm_staging"
  })));
});

test("assertApiEnv rejects unsafe auth cookie prefixes", () => {
  assert.throws(
    () => assertApiEnv(baseProductionEnv({
      NEXT_PUBLIC_AUTH_COOKIE_PREFIX: "staging.cookie"
    })),
    /NEXT_PUBLIC_AUTH_COOKIE_PREFIX must start with a letter/
  );
});

test("assertApiEnv requires a dedicated key when the ULIQ auto finalizer is enabled", () => {
  assert.throws(
    () => assertApiEnv(baseProductionEnv({
      ULIQ_ENABLED: "true",
      ULIQ_PRESALE_ENABLED: "true",
      ULIQ_AUTO_FINALIZER_ENABLED: "true"
    })),
    /ULIQ_FINALIZER_PRIVATE_KEY is required/
  );
});

test("assertApiEnv rejects enabling the ULIQ auto finalizer without its parent features", () => {
  assert.throws(
    () => assertApiEnv(baseProductionEnv({
      ULIQ_AUTO_FINALIZER_ENABLED: "true",
      ULIQ_FINALIZER_PRIVATE_KEY: "1".repeat(64)
    })),
    /requires ULIQ_ENABLED=true and ULIQ_PRESALE_ENABLED=true/
  );
});

test("assertApiEnv accepts a scoped ULIQ auto finalizer configuration", () => {
  assert.doesNotThrow(() => assertApiEnv(baseProductionEnv({
    ULIQ_ENABLED: "true",
    ULIQ_PRESALE_ENABLED: "true",
    ULIQ_AUTO_FINALIZER_ENABLED: "true",
    ULIQ_FINALIZER_PRIVATE_KEY: "1".repeat(64),
    ULIQ_AUTO_FINALIZER_BATCH_SIZE: "5"
  })));
});

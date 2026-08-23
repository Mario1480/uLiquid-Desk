import {
  isEnvEnabled,
  isProductionEnv,
  readEnvValue,
  validateDomainList,
  validatePositiveInteger,
  validateSecretKeyMaterial,
  validateServiceEnv,
  type EnvMap
} from "@mm/core";
import { validateAuthCookiePrefix } from "./auth/cookieNames.js";

let validated = false;

const BLOCKED_PRODUCTION_ADMIN_PASSWORDS = new Set([
  "TempAdmin1234!",
  "ChangeMe123!",
  "change_me",
  "changeme",
  "password",
  "admin"
]);

function validateAdminPassword(value: string): string | null {
  if (BLOCKED_PRODUCTION_ADMIN_PASSWORDS.has(value)) {
    return "must not use a known default or placeholder password";
  }
  if (value.length < 16) {
    return "must be at least 16 characters";
  }
  return null;
}

function validatePostgresPassword(value: string): string | null {
  if (["mm", "postgres", "password", "change_me", "changeme"].includes(value)) {
    return "must not use a known default or placeholder password";
  }
  return null;
}

function validateNonPlaceholderToken(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (["change_me", "changeme", "secret", "token"].includes(normalized)) {
    return "must not use a placeholder token";
  }
  if (value.length < 24) {
    return "must be at least 24 characters";
  }
  return null;
}

function validateRedisUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "redis:" || parsed.protocol === "rediss:") {
      return null;
    }
    return "must use redis or rediss";
  } catch {
    return "must be a valid URL";
  }
}

function validateCorsOriginList(value: string): string | null {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return "must include at least one origin";
  for (const entry of entries) {
    if (entry === "*") continue;
    try {
      const parsed = new URL(entry);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") continue;
      if (
        (parsed.protocol === "capacitor:" || parsed.protocol === "ionic:")
        && parsed.hostname === "localhost"
      ) {
        continue;
      }
      return "must use http/https or mobile webview origins capacitor://localhost/ionic://localhost";
    } catch {
      return "must be a valid origin URL";
    }
  }
  return null;
}

export function assertApiEnv(env: EnvMap = process.env): void {
  const cacheValidation = env === process.env;
  if (cacheValidation && validated) return;

  const production = isProductionEnv(env);
  const orchestrationMode = String(env.ORCHESTRATION_MODE ?? "poll").trim().toLowerCase();
  const pythonRuntimeEnabled =
    isEnvEnabled(env.PY_STRATEGY_ENABLED, false)
    || isEnvEnabled(env.PY_GRID_ENABLED, false);

  validateServiceEnv("apps/api", [
    {
      names: ["DATABASE_URL"],
      required: true
    },
    {
      names: ["SECRET_MASTER_KEY"],
      required: true,
      validate: (value) => validateSecretKeyMaterial(value)
    },
    {
      names: ["ADMIN_EMAIL"],
      required: production,
      message: "ADMIN_EMAIL is required in production."
    },
    {
      names: ["ADMIN_PASSWORD"],
      required: production,
      message: "ADMIN_PASSWORD is required in production.",
      validate: (value) => production ? validateAdminPassword(value) : null
    },
    {
      names: ["POSTGRES_PASSWORD"],
      required: production,
      message: "POSTGRES_PASSWORD is required in production.",
      validate: (value) => production ? validatePostgresPassword(value) : null
    },
    {
      names: ["API_PORT"],
      validate: (value) => validatePositiveInteger(value)
    },
    {
      names: ["SESSION_TTL_DAYS"],
      validate: (value) => validatePositiveInteger(value)
    },
    {
      names: ["NEXT_PUBLIC_AUTH_COOKIE_PREFIX"],
      validate: (value) => validateAuthCookiePrefix(value)
    },
    {
      names: ["API_REQUEST_TIMEOUT_MS"],
      validate: (value) => validatePositiveInteger(value)
    },
    {
      names: ["CORS_ORIGINS"],
      required: production,
      message: "CORS_ORIGINS is required in production.",
      validate: (value) => validateCorsOriginList(value)
    },
    {
      names: ["SIWE_ALLOWED_DOMAINS"],
      required: production,
      message: "SIWE_ALLOWED_DOMAINS is required in production.",
      validate: (value) => validateDomainList(value)
    },
    {
      names: ["REDIS_URL"],
      required: orchestrationMode === "queue",
      message: "REDIS_URL is required when ORCHESTRATION_MODE=queue.",
      validate: (value) => validateRedisUrl(value)
    },
    {
      names: ["API_RATE_LIMIT_REDIS_URL", "REDIS_URL"],
      required: production,
      message: "API_RATE_LIMIT_REDIS_URL or REDIS_URL is required in production for rate limits and idempotency.",
      validate: (value) => validateRedisUrl(value)
    },
    {
      names: ["PY_STRATEGY_AUTH_TOKEN", "PY_GRID_AUTH_TOKEN"],
      required: pythonRuntimeEnabled,
      message: "Set PY_STRATEGY_AUTH_TOKEN (or PY_GRID_AUTH_TOKEN) when Python strategy/grid runtime is enabled.",
      validate: (value) => production ? validateNonPlaceholderToken(value) : null
    }
  ], env);

  if (production) {
    const cookieSecure = String(env.COOKIE_SECURE ?? "").trim().toLowerCase();
    if (cookieSecure === "0" || cookieSecure === "false") {
      throw new Error(
        "[uLiquid Desk] apps/api environment validation failed:\n"
        + "- COOKIE_SECURE must not be disabled in production."
      );
    }

    const strategyToken = readEnvValue(env, "PY_STRATEGY_AUTH_TOKEN");
    const gridToken = readEnvValue(env, "PY_GRID_AUTH_TOKEN");
    if (pythonRuntimeEnabled && strategyToken && gridToken && strategyToken !== gridToken) {
      throw new Error(
        "[uLiquid Desk] apps/api environment validation failed:\n"
        + "- PY_STRATEGY_AUTH_TOKEN and PY_GRID_AUTH_TOKEN must match in the single py-strategy-service deployment.\n"
        + "Use local env files created from .env.example / .env.prod.example or set the variables explicitly."
      );
    }
  }

  if (cacheValidation) validated = true;
}

import {
  isEnvEnabled,
  isProductionEnv,
  readEnvValue,
  validateDomainList,
  validateHttpUrl,
  validatePositiveInteger,
  validateSecretKeyMaterial,
  validateServiceEnv,
  validateUrlList,
  type EnvMap
} from "@mm/core";

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

export function assertApiEnv(env: EnvMap = process.env): void {
  if (validated) return;

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
      names: ["CORS_ORIGINS"],
      required: production,
      message: "CORS_ORIGINS is required in production.",
      validate: (value) => validateUrlList(value)
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
      validate: (value) => validateHttpUrl(value.replace(/^redis:/, "http:"))
    },
    {
      names: ["PY_STRATEGY_AUTH_TOKEN", "PY_GRID_AUTH_TOKEN"],
      required: pythonRuntimeEnabled,
      message: "Set PY_STRATEGY_AUTH_TOKEN (or PY_GRID_AUTH_TOKEN) when Python strategy/grid runtime is enabled.",
      validate: (value) => production ? validateNonPlaceholderToken(value) : null
    }
  ], env);

  if (production) {
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

  validated = true;
}

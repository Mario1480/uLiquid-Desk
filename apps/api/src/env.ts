import {
  isEnvEnabled,
  isProductionEnv,
  validateDomainList,
  validateHttpUrl,
  validatePositiveInteger,
  validateSecretKeyMaterial,
  validateServiceEnv,
  validateUrlList,
  type EnvMap
} from "@mm/core";

let validated = false;

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
      message: "Set PY_STRATEGY_AUTH_TOKEN (or PY_GRID_AUTH_TOKEN) when Python strategy/grid runtime is enabled."
    }
  ], env);

  validated = true;
}

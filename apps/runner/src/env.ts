import {
  isEnvEnabled,
  validatePositiveInteger,
  validateSecretKeyMaterial,
  validateServiceEnv,
  type EnvMap
} from "@mm/core";

let validated = false;

export function assertRunnerEnv(env: EnvMap = process.env): void {
  if (validated) return;

  const orchestrationMode = String(env.ORCHESTRATION_MODE ?? "poll").trim().toLowerCase();
  const provider = String(env.RUNNER_AGENT_SECRET_PROVIDER ?? "encrypted_env").trim().toLowerCase();
  const gridEnabled = isEnvEnabled(env.PY_GRID_ENABLED, false);

  validateServiceEnv("apps/runner", [
    {
      names: ["DATABASE_URL"],
      required: true
    },
    {
      names: ["RUNNER_PORT"],
      validate: (value) => validatePositiveInteger(value)
    },
    {
      names: ["REDIS_URL"],
      required: orchestrationMode === "queue",
      message: "REDIS_URL is required when ORCHESTRATION_MODE=queue."
    },
    {
      names: ["AGENT_SECRET_ENCRYPTION_KEY", "SECRET_MASTER_KEY"],
      required: provider === "encrypted_env",
      message: "Set AGENT_SECRET_ENCRYPTION_KEY or SECRET_MASTER_KEY when RUNNER_AGENT_SECRET_PROVIDER=encrypted_env.",
      validate: (value) => validateSecretKeyMaterial(value)
    },
    {
      names: ["PY_GRID_AUTH_TOKEN", "PY_STRATEGY_AUTH_TOKEN"],
      required: gridEnabled,
      message: "Set PY_GRID_AUTH_TOKEN (or PY_STRATEGY_AUTH_TOKEN) when grid runtime is enabled."
    }
  ], env);

  validated = true;
}

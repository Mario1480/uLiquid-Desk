import {
  isProductionEnv,
  validateHttpUrl,
  validatePositiveInteger,
  validateServiceEnv,
  type EnvMap
} from "@mm/core";

let validated = false;

export function assertWebEnv(env: EnvMap = process.env): void {
  if (validated) return;

  const production = isProductionEnv(env);

  validateServiceEnv("apps/web", [
    {
      names: ["NEXT_PUBLIC_API_URL", "API_URL", "API_BASE_URL"],
      required: production,
      message: "Set NEXT_PUBLIC_API_URL, API_URL, or API_BASE_URL in production.",
      validate: (value) => validateHttpUrl(value)
    },
    {
      names: ["API_URL"],
      validate: (value) => validateHttpUrl(value)
    },
    {
      names: ["API_BASE_URL"],
      validate: (value) => validateHttpUrl(value)
    },
    {
      names: ["NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID"],
      validate: (value) => validatePositiveInteger(value)
    },
    {
      names: ["NEXT_PUBLIC_HYPEREVM_RPC_URL"],
      validate: (value) => validateHttpUrl(value)
    },
    {
      names: ["NEXT_PUBLIC_HYPEREVM_EXPLORER_URL"],
      validate: (value) => validateHttpUrl(value)
    }
  ], env);

  validated = true;
}

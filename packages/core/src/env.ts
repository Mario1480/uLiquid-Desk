export type EnvMap = Record<string, string | undefined>;

export type EnvCheck = {
  names: string[];
  required?: boolean;
  message?: string;
  validate?: (value: string, env: EnvMap) => string | null;
};

export function isEnvEnabled(raw: string | undefined, fallback = false): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function isProductionEnv(env: EnvMap = process.env): boolean {
  return String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export function readEnvValue(env: EnvMap, ...names: string[]): string {
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function validatePositiveInteger(value: string): string | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "must be a positive integer";
  }
  return null;
}

export function validateHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "must use http or https";
    }
    return null;
  } catch {
    return "must be a valid URL";
  }
}

export function validateUrlList(value: string): string | null {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return "must include at least one URL";
  for (const entry of entries) {
    const issue = validateHttpUrl(entry);
    if (issue) return issue;
  }
  return null;
}

export function validateDomainList(value: string): string | null {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return "must include at least one domain";
  for (const entry of entries) {
    const normalized = entry.includes("://")
      ? (() => {
          try {
            return new URL(entry).host.trim().toLowerCase();
          } catch {
            return "";
          }
        })()
      : entry.trim().toLowerCase();

    if (!normalized || normalized.includes("/") || normalized.includes(" ")) {
      return "must contain hostnames like desk.example.com";
    }
  }
  return null;
}

export function validateSecretKeyMaterial(value: string): string | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return null;
  if (value.length === 32) return null;

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return null;
  } catch {
    // ignore and fall through
  }

  return "must be 32-byte raw, 64-char hex, or base64-encoded 32 bytes";
}

export function validateServiceEnv(serviceName: string, checks: EnvCheck[], env: EnvMap = process.env): void {
  const issues: string[] = [];

  for (const check of checks) {
    const value = readEnvValue(env, ...check.names);
    const label = check.names.join(" or ");

    if (check.required && !value) {
      issues.push(check.message ?? `${label} is required.`);
      continue;
    }

    if (!value || !check.validate) continue;
    const validationIssue = check.validate(value, env);
    if (validationIssue) {
      issues.push(`${label} ${validationIssue}.`);
    }
  }

  if (issues.length === 0) return;

  const error = new Error(
    [
      `[uLiquid Desk] ${serviceName} environment validation failed:`,
      ...issues.map((issue) => `- ${issue}`),
      "Use local env files created from .env.example / .env.prod.example or set the variables explicitly."
    ].join("\n")
  );
  error.name = "EnvValidationError";
  throw error;
}

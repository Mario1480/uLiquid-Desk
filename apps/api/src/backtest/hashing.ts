import crypto from "node:crypto";

export const BACKTEST_SCHEMA_VERSION = 1;

function stableSortObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const row = value[key];
    if (Array.isArray(row)) {
      out[key] = row.map((item) => normalizeForStableJson(item));
      continue;
    }
    out[key] = normalizeForStableJson(row);
  }
  return out;
}

export function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return stableSortObject(value as Record<string, unknown>);
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashStable(value: unknown): string {
  return sha256Hex(stableJsonStringify(value));
}

export function resolveBacktestEngineHash(): string {
  const gitCommit = String(process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  const runtime = {
    schemaVersion: BACKTEST_SCHEMA_VERSION,
    gitCommit: gitCommit || "unknown",
    node: process.version
  };
  return hashStable(runtime);
}


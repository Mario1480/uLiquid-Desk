import type { PluginHealthState } from "@mm/plugin-sdk";

type RunPluginHookParams<T> = {
  pluginId: string;
  fallbackPluginId: string;
  timeoutMs?: number;
  run: () => Promise<T>;
  runFallback: () => Promise<T>;
  onRuntimeError?: (params: {
    pluginId: string;
    stage: "primary" | "fallback";
    error: string;
    timedOut: boolean;
    health: PluginHealthState;
  }) => Promise<void>;
  onFallbackUsed?: (params: {
    pluginId: string;
    fallbackPluginId: string;
    reason: string;
  }) => Promise<void>;
};

type MutableHealth = {
  status: PluginHealthState["status"];
  consecutiveFailures: number;
  lastErrorAt?: string;
  cooldownUntil?: string;
};

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

const healthByPlugin = new Map<string, MutableHealth>();

function getHealth(pluginId: string): MutableHealth {
  const existing = healthByPlugin.get(pluginId);
  if (existing) return existing;
  const next: MutableHealth = {
    status: "healthy",
    consecutiveFailures: 0
  };
  healthByPlugin.set(pluginId, next);
  return next;
}

function cloneHealth(health: MutableHealth): PluginHealthState {
  return {
    status: health.status,
    consecutiveFailures: health.consecutiveFailures,
    lastErrorAt: health.lastErrorAt,
    cooldownUntil: health.cooldownUntil
  };
}

function isInCooldown(health: MutableHealth): boolean {
  if (!health.cooldownUntil) return false;
  const until = new Date(health.cooldownUntil).getTime();
  if (!Number.isFinite(until)) return false;
  if (Date.now() < until) return true;
  health.cooldownUntil = undefined;
  if (health.status === "disabled") {
    health.status = health.consecutiveFailures > 0 ? "degraded" : "healthy";
  }
  return false;
}

function markSuccess(pluginId: string) {
  const health = getHealth(pluginId);
  health.consecutiveFailures = 0;
  health.status = "healthy";
  health.cooldownUntil = undefined;
}

function markFailure(pluginId: string): PluginHealthState {
  const health = getHealth(pluginId);
  health.consecutiveFailures += 1;
  health.lastErrorAt = new Date().toISOString();
  if (health.consecutiveFailures >= DEFAULT_FAILURE_THRESHOLD) {
    health.status = "disabled";
    health.cooldownUntil = new Date(Date.now() + DEFAULT_COOLDOWN_MS).toISOString();
  } else {
    health.status = "degraded";
  }
  return cloneHealth(health);
}

async function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: string }> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(200, Math.trunc(timeoutMs)) : DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`plugin_timeout_after_${ms}ms`));
      }, ms);
    });
    const value = await Promise.race([run(), timeoutPromise]);
    return { ok: true, value: value as T };
  } catch (error) {
    const message = String(error);
    return {
      ok: false,
      timedOut: message.includes("plugin_timeout_after_"),
      error: message
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runPluginHookWithFallback<T>(params: RunPluginHookParams<T>): Promise<{ value: T; pluginIdUsed: string; fallbackUsed: boolean; reason: string | null }> {
  const primaryHealth = getHealth(params.pluginId);

  if (isInCooldown(primaryHealth)) {
    const reason = "primary_plugin_in_cooldown";
    await params.onFallbackUsed?.({
      pluginId: params.pluginId,
      fallbackPluginId: params.fallbackPluginId,
      reason
    });

    const fallback = await withTimeout(params.runFallback, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!fallback.ok) {
      const health = markFailure(params.fallbackPluginId);
      await params.onRuntimeError?.({
        pluginId: params.fallbackPluginId,
        stage: "fallback",
        error: fallback.error,
        timedOut: fallback.timedOut,
        health
      });
      throw new Error(`fallback_plugin_failed:${fallback.error}`);
    }

    markSuccess(params.fallbackPluginId);
    return {
      value: fallback.value,
      pluginIdUsed: params.fallbackPluginId,
      fallbackUsed: true,
      reason
    };
  }

  const primary = await withTimeout(params.run, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (primary.ok) {
    markSuccess(params.pluginId);
    return {
      value: primary.value,
      pluginIdUsed: params.pluginId,
      fallbackUsed: false,
      reason: null
    };
  }

  const health = markFailure(params.pluginId);
  await params.onRuntimeError?.({
    pluginId: params.pluginId,
    stage: "primary",
    error: primary.error,
    timedOut: primary.timedOut,
    health
  });

  const fallbackReason = `primary_plugin_failed:${params.pluginId}`;
  await params.onFallbackUsed?.({
    pluginId: params.pluginId,
    fallbackPluginId: params.fallbackPluginId,
    reason: fallbackReason
  });

  const fallback = await withTimeout(params.runFallback, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!fallback.ok) {
    const fallbackHealth = markFailure(params.fallbackPluginId);
    await params.onRuntimeError?.({
      pluginId: params.fallbackPluginId,
      stage: "fallback",
      error: fallback.error,
      timedOut: fallback.timedOut,
      health: fallbackHealth
    });
    throw new Error(`fallback_plugin_failed:${fallback.error}`);
  }

  markSuccess(params.fallbackPluginId);

  return {
    value: fallback.value,
    pluginIdUsed: params.fallbackPluginId,
    fallbackUsed: true,
    reason: fallbackReason
  };
}

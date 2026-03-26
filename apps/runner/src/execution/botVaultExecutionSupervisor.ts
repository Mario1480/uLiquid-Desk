import type { ActiveFuturesBot } from "../db.js";
import { deriveBotVaultLifecycleState } from "@mm/core";
import {
  appendBotVaultExecutionEvent,
  getEffectiveVaultExecutionMode,
  getVaultSafetyControls,
  isBotVaultRunnerManaged,
  loadActiveBotVaultExecutions,
  updateBotVaultExecutionRuntime,
  type VaultExecutionMode
} from "../db.js";
import { loopOnce } from "../loop.js";
import { log } from "../logger.js";
import { publishRunnerRiskEventNotification } from "../notifications/publisher.js";
import type { AgentSecretProvider } from "./agentSecretProvider.js";
import { BotVaultCommandQueue } from "./botVaultCommandQueue.js";

type ExecutorHandle = {
  botVaultId: string;
  queue: BotVaultCommandQueue;
  bot: ActiveFuturesBot;
  nextTickAt: number;
  running: boolean;
  lastObservedStatus: string | null;
  lastError: string | null;
  lastAgentWalletVersion: number | null;
  alerts: {
    nonce: number[];
    signing: number[];
    reject: number[];
    divergence: number[];
    lastAlertAtByType: Record<string, number>;
  };
};

export type BotVaultExecutionSupervisor = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): {
    running: boolean;
    activeHandles: number;
    alertCounters: {
      nonce: number;
      signing: number;
      reject: number;
      divergence: number;
    };
  };
};

function normalizeExecutionStatus(bot: ActiveFuturesBot): string {
  const vault = bot.botVaultExecution;
  const lifecycle = deriveBotVaultLifecycleState({
    status: vault?.status,
    executionStatus: vault?.executionStatus,
    executionLastError: vault?.executionLastError,
    executionMetadata: vault?.executionMetadata
  });
  if (lifecycle.state === "closed") return "closed";
  if (lifecycle.state === "error") return "error";
  if (lifecycle.mode === "close_only") return "close_only";
  if (lifecycle.state === "paused" || lifecycle.state === "settling" || lifecycle.state === "withdraw_pending") {
    return "paused";
  }
  return "running";
}

function buildSourceKey(parts: string[]): string {
  return parts.map((part) => String(part ?? "").trim() || "na").join(":");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNullableAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw : null;
}

export function resolveHyperliquidExecutionVaultAddress(params: {
  executionMetadata?: Record<string, unknown> | null;
  fallbackPassphrase?: string | null;
}): string | null {
  const metadata = asRecord(params.executionMetadata);
  const providerState = asRecord(metadata?.providerState);
  return (
    toNullableAddress(providerState?.vaultAddress)
    ?? toNullableAddress(metadata?.vaultAddress)
    ?? toNullableAddress(params.fallbackPassphrase)
    ?? null
  );
}

function sanitizeRunnerError(error: unknown): string {
  return String(error ?? "")
    .replace(/0x[a-fA-F0-9]{64}/g, "[redacted_secret]")
    .replace(/v1\.[A-Za-z0-9+/=._-]+\.[A-Za-z0-9+/=._-]+\.[A-Za-z0-9+/=._-]+/g, "[redacted_ciphertext]");
}

function classifyOperationalError(reason: string): "nonce" | "signing" | "reject" | "divergence" | null {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("nonce")) return "nonce";
  if (normalized.includes("sign") || normalized.includes("signature")) return "signing";
  if (normalized.includes("reject")) return "reject";
  if (normalized.includes("divergence") || normalized.includes("state_mismatch") || normalized.includes("exchange state")) {
    return "divergence";
  }
  return null;
}

function alertThresholdForType(type: "nonce" | "signing" | "reject" | "divergence"): number {
  if (type === "signing") return 3;
  if (type === "reject") return 5;
  return 3;
}

async function emitStatusEvent(params: {
  bot: ActiveFuturesBot;
  fromStatus: string | null;
  toStatus: string;
  result: "succeeded" | "failed";
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const vault = params.bot.botVaultExecution;
  if (!vault?.botVaultId) return;
  await appendBotVaultExecutionEvent({
    userId: params.bot.userId,
    botVaultId: vault.botVaultId,
    gridInstanceId: vault.gridInstanceId,
    botId: params.bot.id,
    providerKey: vault.executionProvider ?? "hyperliquid_runner",
    executionUnitId: vault.executionUnitId,
    action: params.action,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    result: params.result,
    reason: params.reason ?? null,
    sourceKey: buildSourceKey([
      "runner",
      vault.botVaultId,
      params.action,
      params.fromStatus ?? "none",
      params.toStatus,
      params.reason ?? "ok"
    ]),
    metadata: params.metadata ?? null
  });
}

async function materializeExecutionBot(
  bot: ActiveFuturesBot,
  agentSecretProvider: AgentSecretProvider,
  safetyControls: {
    closeOnlyAllUserIds: string[];
  }
): Promise<ActiveFuturesBot> {
  const vault = bot.botVaultExecution;
  if (!vault?.botVaultId) {
    throw new Error("bot_vault_execution_missing");
  }
  const providerKey = String(vault.executionProvider ?? "").trim().toLowerCase();
  const fallbackAddress = String(bot.credentials.apiKey ?? "").trim().toLowerCase() || null;
  const fallbackPrivateKey = String(bot.credentials.apiSecret ?? "").trim() || null;
  const fallbackVaultAddress =
    providerKey === "hyperliquid" || providerKey === "hyperliquid_demo" || String(bot.exchange).trim().toLowerCase() === "hyperliquid"
      ? resolveHyperliquidExecutionVaultAddress({
          executionMetadata: vault.executionMetadata,
          fallbackPassphrase: bot.credentials.passphrase
        })
      : (String(vault.vaultAddress ?? bot.credentials.passphrase ?? "").trim() || null);

  let agentAddress = String(vault.agentWallet ?? "").trim().toLowerCase() || fallbackAddress;
  let agentPrivateKey: string | null = null;
  let cacheScope: string | null = null;
  const cacheScopeSuffix = fallbackVaultAddress ?? "novault";

  if (agentAddress) {
    const credentials = await agentSecretProvider.getAgentCredentials({
      botVaultId: vault.botVaultId,
      agentWalletAddress: agentAddress,
      agentWalletVersion: vault.agentWalletVersion,
      agentSecretRef: vault.agentSecretRef
    }).catch((error) => {
      if (providerKey === "hyperliquid" && fallbackAddress && fallbackPrivateKey) return null;
      throw error;
    });
    if (credentials) {
      agentAddress = credentials.address;
      agentPrivateKey = credentials.privateKey;
      cacheScope = `${vault.botVaultId}:${credentials.address}:${cacheScopeSuffix}`;
    }
  }

  if (!agentAddress && providerKey !== "hyperliquid") {
    throw new Error("agent_wallet_missing");
  }

  if (!agentPrivateKey) {
    if (providerKey === "hyperliquid" && fallbackAddress && fallbackPrivateKey) {
      agentAddress = fallbackAddress;
      agentPrivateKey = fallbackPrivateKey;
      cacheScope = `${vault.botVaultId}:${fallbackAddress}:${cacheScopeSuffix}`;
    } else {
      throw new Error("agent_secret_missing");
    }
  }

  const forceCloseOnly = safetyControls.closeOnlyAllUserIds.includes(bot.userId);
  return {
    ...bot,
    botVaultExecution: forceCloseOnly
      ? {
          ...vault,
          status: vault.status === "CLOSED" ? "CLOSED" : "CLOSE_ONLY"
        }
      : vault,
    executionIdentity: {
      exchange: bot.exchange,
      apiKey: agentAddress ?? fallbackAddress ?? "",
      apiSecret: agentPrivateKey,
      passphrase: fallbackVaultAddress,
      cacheScope: cacheScope ?? `${vault.botVaultId}:${agentAddress ?? "unknown"}:${cacheScopeSuffix}`,
      agentWallet: agentAddress ?? fallbackAddress ?? "",
      providerKey: vault.executionProvider ?? null
    }
  };
}

async function maybeEmitOperationalAlert(params: {
  handle: ExecutorHandle;
  bot: ActiveFuturesBot;
  reason: string;
}) {
  const kind = classifyOperationalError(params.reason);
  if (!kind) return;
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const entries = params.handle.alerts[kind].filter((ts) => now - ts <= windowMs);
  entries.push(now);
  params.handle.alerts[kind] = entries;
  const threshold = alertThresholdForType(kind);
  const lastAlertAt = params.handle.alerts.lastAlertAtByType[kind] ?? 0;
  if (entries.length < threshold || now - lastAlertAt < windowMs) return;
  params.handle.alerts.lastAlertAtByType[kind] = now;
  log.warn({
    botVaultId: params.handle.botVaultId,
    botId: params.bot.id,
    alertType: kind,
    occurrences: entries.length
  }, `runner_${kind === "reject" ? "repeated_order_rejects" : kind === "signing" ? "failed_signing" : kind === "divergence" ? "exchange_divergence" : "nonce_stuck"}`);
  void publishRunnerRiskEventNotification({
    bot: params.bot,
    type: "BOT_ERROR",
    message: `runner_${kind}`,
    meta: {
      botVaultId: params.handle.botVaultId,
      alertType: kind,
      occurrences: entries.length
    }
  });
}

export function createBotVaultExecutionSupervisor(params: {
  workerId: string;
  agentSecretProvider: AgentSecretProvider;
}) : BotVaultExecutionSupervisor {
  const handles = new Map<string, ExecutorHandle>();
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  const scanMs = Math.max(250, Number(process.env.RUNNER_BOT_VAULT_SCAN_MS ?? process.env.RUNNER_SCAN_MS ?? "500"));

  async function syncHandles(mode: VaultExecutionMode) {
    if (!running) return;

    if (mode === "offchain_shadow") {
      handles.clear();
      return;
    }

    const bots = await loadActiveBotVaultExecutions();
    const activeIds = new Set<string>();
    for (const bot of bots) {
      const vaultId = bot.botVaultExecution?.botVaultId;
      if (!vaultId) continue;
      activeIds.add(vaultId);
      const existing = handles.get(vaultId);
      if (existing) {
        const nextVersion = bot.botVaultExecution?.agentWalletVersion ?? null;
        existing.bot = bot;
        if (existing.lastAgentWalletVersion !== nextVersion) {
          existing.lastAgentWalletVersion = nextVersion;
          existing.nextTickAt = 0;
          existing.lastObservedStatus = null;
        }
        continue;
      }
      handles.set(vaultId, {
        botVaultId: vaultId,
        queue: new BotVaultCommandQueue(),
        bot,
        nextTickAt: 0,
        running: false,
        lastObservedStatus: bot.botVaultExecution?.executionStatus ?? null,
        lastError: null,
        lastAgentWalletVersion: bot.botVaultExecution?.agentWalletVersion ?? null,
        alerts: {
          nonce: [],
          signing: [],
          reject: [],
          divergence: [],
          lastAlertAtByType: {}
        }
      });
    }

    for (const [vaultId] of handles) {
      if (!activeIds.has(vaultId)) {
        handles.delete(vaultId);
      }
    }
  }

  async function tickHandle(handle: ExecutorHandle) {
    if (handle.running) return;
    const vault = handle.bot.botVaultExecution;
    if (!vault?.botVaultId) return;
    handle.running = true;

    await handle.queue.enqueue(async () => {
      const safetyControls = await getVaultSafetyControls();
      const targetStatus = safetyControls.closeOnlyAllUserIds.includes(handle.bot.userId)
        ? "close_only"
        : normalizeExecutionStatus(handle.bot);
      try {
        const execBot = await materializeExecutionBot(handle.bot, params.agentSecretProvider, safetyControls);
        const tickResult = await loopOnce(execBot, params.workerId, {
          publishRiskNotificationFn: publishRunnerRiskEventNotification
        });
        await updateBotVaultExecutionRuntime({
          botVaultId: vault.botVaultId,
          executionStatus: targetStatus,
          executionLastSyncedAt: new Date(),
          executionLastError: null,
          executionLastErrorAt: null,
          executionMetadataPatch: {
            runnerMode: "bot_vault_executor",
            lastTickReason: tickResult.reason,
            lastTickAt: new Date().toISOString(),
            agentWallet: execBot.executionIdentity?.agentWallet ?? vault.agentWallet,
            cacheScope: execBot.executionIdentity?.cacheScope ?? null,
            agentWalletVersion: vault.agentWalletVersion,
            haltNewOrders: safetyControls.haltNewOrders,
            closeOnlyAllActive: safetyControls.closeOnlyAllUserIds.includes(handle.bot.userId)
          }
        });
        if (handle.lastObservedStatus !== targetStatus) {
          await emitStatusEvent({
            bot: handle.bot,
            fromStatus: handle.lastObservedStatus,
            toStatus: targetStatus,
            result: "succeeded",
            action: targetStatus === "running" ? "start_execution" : targetStatus
          });
          handle.lastObservedStatus = targetStatus;
        }
        handle.lastError = null;
      } catch (error) {
        const reason = sanitizeRunnerError(error);
        const previousError = handle.lastError;
        handle.lastError = reason;
        await updateBotVaultExecutionRuntime({
          botVaultId: vault.botVaultId,
          executionStatus: "error",
          executionLastSyncedAt: new Date(),
          executionLastError: reason,
          executionLastErrorAt: new Date(),
          executionMetadataPatch: {
            runnerMode: "bot_vault_executor",
            lastTickFailedAt: new Date().toISOString(),
            lastTickFailure: reason,
            agentWalletVersion: vault.agentWalletVersion
          }
        });
        if (handle.lastObservedStatus !== "error" || reason !== previousError) {
          await emitStatusEvent({
            bot: handle.bot,
            fromStatus: handle.lastObservedStatus,
            toStatus: "error",
            result: "failed",
            action: "tick_execution",
            reason
          });
        }
        handle.lastObservedStatus = "error";
        await maybeEmitOperationalAlert({
          handle,
          bot: handle.bot,
          reason
        });
        log.warn({ botVaultId: vault.botVaultId, botId: handle.bot.id, err: reason }, "bot vault executor tick failed");
      } finally {
        handle.nextTickAt = Date.now() + Math.max(250, handle.bot.tickMs);
        handle.running = false;
      }
    });
  }

  async function runCycle() {
    if (!running) return;
    const mode = await getEffectiveVaultExecutionMode();
    await syncHandles(mode);
    const now = Date.now();
    for (const handle of handles.values()) {
      if (!isBotVaultRunnerManaged(handle.bot, mode)) continue;
      if (handle.running) continue;
      if (now < handle.nextTickAt) continue;
      void tickHandle(handle);
    }
  }

  async function start() {
    if (running) return;
    running = true;
    await runCycle();
    timer = setInterval(() => {
      void runCycle().catch((error) => {
        log.warn({ err: String(error) }, "bot vault execution supervisor cycle failed");
      });
    }, scanMs);
  }

  async function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    handles.clear();
  }

  return {
    start,
    stop,
    getStatus() {
      const alertCounters = {
        nonce: 0,
        signing: 0,
        reject: 0,
        divergence: 0
      };
      for (const handle of handles.values()) {
        alertCounters.nonce += handle.alerts.nonce.length;
        alertCounters.signing += handle.alerts.signing.length;
        alertCounters.reject += handle.alerts.reject.length;
        alertCounters.divergence += handle.alerts.divergence.length;
      }
      return {
        running,
        activeHandles: handles.size,
        alertCounters
      };
    }
  };
}

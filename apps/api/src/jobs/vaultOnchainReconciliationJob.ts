import { logger } from "../logger.js";
import { normalizeBotVaultStatus } from "@mm/core";
import { formatUnits } from "viem";
import type { VaultReconciliationStatus } from "../vaults/reconciliation.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import { resolveOnchainAddressBook } from "../vaults/onchainAddressBook.js";
import { createOnchainPublicClient, readBotVaultState, readMasterVaultState } from "../vaults/onchainProvider.js";
import type { ExecutionLifecycleService } from "../vaults/executionLifecycle.service.js";

const POLL_MS = Math.max(15, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_INTERVAL_SECONDS ?? "60")) * 1000;
const MASTER_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_MASTER_LIMIT ?? "100"));
const BOT_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_BOT_LIMIT ?? "200"));
const EPSILON = 0.000001;
const LOW_HYPE_STATE_KEY_PREFIX = "vault.agent_low_hype.v1:";

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readClosedRecoveryCompensationUsd(event: { amount?: unknown; metadata?: unknown }): number {
  const metadata = toRecord(event.metadata);
  if (String(metadata.sourceType ?? "") !== "admin_closed_vault_compensation") return 0;
  if (metadata.creditToMasterVaultBalance !== true) return 0;
  const amount = Number(event.amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw as `0x${string}` : null;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deriveLowHypeState(balanceWei: string | null, thresholdHype: number, stale: boolean): "ok" | "low" | "unavailable" {
  if (!balanceWei) return "unavailable";
  if (stale) return "unavailable";
  const formatted = Number(formatUnits(BigInt(balanceWei), 18));
  if (!Number.isFinite(formatted)) return "unavailable";
  return formatted <= Math.max(0, thresholdHype) + EPSILON ? "low" : "ok";
}

export type VaultOnchainReconciliationStatus = {
  enabled: boolean;
  mode: string;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastDriftCount: number;
  lastStatus: VaultReconciliationStatus;
  totalCycles: number;
  totalDrifts: number;
  totalFailedCycles: number;
};

export function createVaultOnchainReconciliationJob(
  db: any,
  deps?: {
    executionLifecycleService?: Pick<ExecutionLifecycleService, "startExecution"> | null;
    readMasterVaultState?: typeof readMasterVaultState;
    readBotVaultState?: typeof readBotVaultState;
    readNativeBalance?: ((client: any, address: `0x${string}`) => Promise<bigint>) | null;
    dispatchAgentLowHypeNotification?: ((payload: {
      userId: string;
      masterVaultId: string;
      masterVaultAddress?: string | null;
      agentWalletAddress: string;
      hypeBalance: string | null;
      lowHypeThreshold: number;
      lowHypeState: "ok" | "low" | "unavailable";
      updatedAt?: string | null;
    }) => Promise<void>) | null;
  }
) {
  const executionLifecycleService = deps?.executionLifecycleService ?? null;
  const readMasterVaultStateFn = deps?.readMasterVaultState ?? readMasterVaultState;
  const readBotVaultStateFn = deps?.readBotVaultState ?? readBotVaultState;
  const readNativeBalance = deps?.readNativeBalance ?? ((client: any, address: `0x${string}`) => client.getBalance({ address }));
  const dispatchAgentLowHypeNotification = deps?.dispatchAgentLowHypeNotification ?? null;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastMode = "offchain_shadow";
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastDriftCount = 0;
  let totalCycles = 0;
  let totalDrifts = 0;
  let totalFailedCycles = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (running) return { enabled: false, mode: lastMode, drifts: 0 };
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const mode = await getEffectiveVaultExecutionMode(db);
      lastMode = mode;
      if (!isOnchainMode(mode)) {
        lastDriftCount = 0;
        lastError = null;
        lastErrorAt = null;
        return { enabled: false, mode, drifts: 0 };
      }

      const addressBook = resolveOnchainAddressBook(mode);
      const client = createOnchainPublicClient(addressBook);

      const masters = await db.masterVault.findMany({
        where: { onchainAddress: { not: null } },
        select: {
          id: true,
          userId: true,
          onchainAddress: true,
          freeBalance: true,
          reservedBalance: true,
          agentWallet: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        },
        take: MASTER_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      const bots = await db.botVault.findMany({
        where: { vaultAddress: { not: null } },
        select: {
          id: true,
          userId: true,
          vaultAddress: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          feePaidTotal: true,
          highWaterMark: true,
          status: true,
          executionStatus: true
        },
        take: BOT_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      let driftCount = 0;

      for (const row of masters) {
        const address = String(row.onchainAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const onchain = await readMasterVaultStateFn(client, address).catch(() => null);
        if (!onchain) continue;
        const agentWallet = normalizeAddress(row.agentWallet);
        const lowHypeThreshold = readPositiveNumber(row.agentHypeWarnThreshold, 0.05);
        let agentBalanceWei = typeof row.agentLastBalanceWei === "string" && row.agentLastBalanceWei.trim()
          ? row.agentLastBalanceWei.trim()
          : null;
        let agentBalanceFormatted = typeof row.agentLastBalanceFormatted === "string" && row.agentLastBalanceFormatted.trim()
          ? row.agentLastBalanceFormatted.trim()
          : null;
        let agentLastBalanceAt = row.agentLastBalanceAt instanceof Date ? row.agentLastBalanceAt : null;
        let agentBalanceStale = true;
        if (agentWallet) {
          try {
            const balanceWei = await readNativeBalance(client, agentWallet);
            agentBalanceWei = balanceWei.toString();
            agentBalanceFormatted = formatUnits(balanceWei, 18);
            agentLastBalanceAt = new Date();
            agentBalanceStale = false;
            await db.masterVault.update({
              where: { id: row.id },
              data: {
                agentLastBalanceAt,
                agentLastBalanceWei: agentBalanceWei,
                agentLastBalanceFormatted: agentBalanceFormatted
              }
            }).catch(() => undefined);
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_agent_balance_read_failed", {
              reason,
              masterVaultId: row.id,
              agentWallet,
              error: String(error)
            });
            agentBalanceStale = true;
          }
        }
        const lowHypeState = deriveLowHypeState(agentBalanceWei, lowHypeThreshold, agentBalanceStale);
        const notificationStateKey = `${LOW_HYPE_STATE_KEY_PREFIX}${row.id}`;
        if (dispatchAgentLowHypeNotification && agentWallet && lowHypeState === "low") {
          const existingState = typeof db.globalSetting?.findUnique === "function"
            ? await db.globalSetting.findUnique({
                where: { key: notificationStateKey },
                select: { value: true }
              }).catch(() => null)
            : null;
          const previousState = typeof existingState?.value?.state === "string" ? String(existingState.value.state) : null;
          if (previousState !== "low") {
            await dispatchAgentLowHypeNotification({
              userId: String(row.userId),
              masterVaultId: String(row.id),
              masterVaultAddress: String(row.onchainAddress ?? "").trim() || null,
              agentWalletAddress: agentWallet,
              hypeBalance: agentBalanceFormatted,
              lowHypeThreshold,
              lowHypeState,
              updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
            }).catch((error) => {
              logger.warn("vault_onchain_reconciliation_agent_low_hype_notify_failed", {
                reason,
                masterVaultId: row.id,
                agentWallet,
                error: String(error)
              });
            });
          }
        }
        if (typeof db.globalSetting?.upsert === "function" && agentWallet) {
          await db.globalSetting.upsert({
            where: { key: notificationStateKey },
            update: {
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            },
            create: {
              key: notificationStateKey,
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            }
          }).catch(() => undefined);
        }
        const compensationEvents = typeof db.cashEvent?.findMany === "function"
          ? await db.cashEvent.findMany({
              where: {
                masterVaultId: row.id,
                eventType: "ADJUSTMENT"
              },
              select: {
                amount: true,
                metadata: true
              }
            }).catch(() => [] as Array<{ amount: unknown; metadata: unknown }>)
          : [];
        const offchainCompensationUsd = compensationEvents.reduce(
          (sum, event) => sum + readClosedRecoveryCompensationUsd(event),
          0
        );
        const expectedFreeBalance = onchain.freeBalance + offchainCompensationUsd;

        const freeDiff = Math.abs(Number(row.freeBalance ?? 0) - expectedFreeBalance);
        const reservedDiff = Math.abs(Number(row.reservedBalance ?? 0) - onchain.reservedBalance);
        if (freeDiff <= EPSILON && reservedDiff <= EPSILON) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", {
          reason,
          entityType: "master_vault",
          masterVaultId: row.id,
          onchainAddress: address,
          dbFreeBalance: Number(row.freeBalance ?? 0),
          dbReservedBalance: Number(row.reservedBalance ?? 0),
          chainFreeBalance: onchain.freeBalance,
          chainReservedBalance: onchain.reservedBalance,
          offchainCompensationUsd,
          expectedFreeBalance
        });

        await db.masterVault.update({
          where: { id: row.id },
          data: {
            freeBalance: expectedFreeBalance,
            reservedBalance: onchain.reservedBalance,
            availableUsd: expectedFreeBalance
          }
        }).catch((error: unknown) => {
          logger.warn("vault_onchain_reconciliation_master_repair_failed", {
            reason,
            masterVaultId: row.id,
            onchainAddress: address,
            error: String(error)
          });
        });
      }

      for (const row of bots) {
        const address = String(row.vaultAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const onchain = await readBotVaultStateFn(client, address).catch(() => null);
        if (!onchain) continue;

        const normalizedDbStatus = normalizeBotVaultStatus(row.status);
        const dbStatus = normalizedDbStatus === "STOPPED" ? "PAUSED" : normalizedDbStatus;
        const chainStatus = onchain.status === 0
          ? "ACTIVE"
          : onchain.status === 1
            ? "PAUSED"
            : onchain.status === 2
              ? "CLOSE_ONLY"
              : onchain.status === 3
              ? "CLOSED"
                : "ERROR";

        const executionStatus = String(row.executionStatus ?? "").trim().toLowerCase();
        const shouldAutoStart = executionLifecycleService
          && dbStatus === "ACTIVE"
          && chainStatus === "ACTIVE"
          && (executionStatus === "" || executionStatus === "created");
        if (shouldAutoStart) {
          try {
            await executionLifecycleService.startExecution({
              userId: String(row.userId),
              botVaultId: String(row.id),
              sourceKey: `bot_vault:${row.id}:onchain_reconciliation_autostart`,
              reason: "bot_vault_onchain_reconciliation_autostart",
              metadata: {
                sourceType: "onchain_reconciliation_autostart"
              }
            });
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_autostart_failed", {
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              error: String(error)
            });
          }
        }

        const diffs = {
          principalAllocated: Math.abs(Number(row.principalAllocated ?? 0) - onchain.principalAllocated),
          principalReturned: Math.abs(Number(row.principalReturned ?? 0) - onchain.principalReturned),
          realizedPnlNet: Math.abs(Number(row.realizedPnlNet ?? 0) - onchain.realizedPnlNet),
          feePaidTotal: Math.abs(Number(row.feePaidTotal ?? 0) - onchain.feePaidTotal),
          highWaterMark: Math.abs(Number(row.highWaterMark ?? 0) - onchain.highWaterMark)
        };

        const hasNumericDrift = Object.values(diffs).some((value) => value > EPSILON);
        const hasStatusDrift = dbStatus !== chainStatus;
        if (!hasNumericDrift && !hasStatusDrift) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", {
          reason,
          entityType: "bot_vault",
          botVaultId: row.id,
          vaultAddress: address,
          dbStatus,
          chainStatus,
          dbPrincipalAllocated: Number(row.principalAllocated ?? 0),
          chainPrincipalAllocated: onchain.principalAllocated,
          dbPrincipalReturned: Number(row.principalReturned ?? 0),
          chainPrincipalReturned: onchain.principalReturned,
          dbRealizedPnlNet: Number(row.realizedPnlNet ?? 0),
          chainRealizedPnlNet: onchain.realizedPnlNet,
          dbFeePaidTotal: Number(row.feePaidTotal ?? 0),
          chainFeePaidTotal: onchain.feePaidTotal,
          dbHighWaterMark: Number(row.highWaterMark ?? 0),
          chainHighWaterMark: onchain.highWaterMark
        });

        await db.botVault.update({
          where: { id: row.id },
          data: {
            principalAllocated: onchain.principalAllocated,
            principalReturned: onchain.principalReturned,
            realizedPnlNet: onchain.realizedPnlNet,
            realizedNetUsd: onchain.realizedPnlNet,
            feePaidTotal: onchain.feePaidTotal,
            highWaterMark: onchain.highWaterMark,
            status: chainStatus
          }
        }).catch((error: unknown) => {
          logger.warn("vault_onchain_reconciliation_bot_repair_failed", {
            reason,
            botVaultId: row.id,
            vaultAddress: address,
            error: String(error)
          });
        });
      }

      lastDriftCount = driftCount;
      totalDrifts += driftCount;
      lastError = null;
      lastErrorAt = null;

      if (driftCount > 0) {
        logger.info("vault_onchain_reconciliation_cycle", {
          reason,
          mode,
          drifts: driftCount
        });
      }

      return { enabled: true, mode, drifts: driftCount };
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      logger.warn("vault_onchain_reconciliation_cycle_failed", {
        reason,
        error: lastError
      });
      return { enabled: false, mode: lastMode, drifts: 0 };
    } finally {
      running = false;
      lastFinishedAt = new Date();
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): VaultOnchainReconciliationStatus {
    return {
      enabled: isOnchainMode((lastMode as any) ?? "offchain_shadow"),
      mode: lastMode,
      running,
      pollMs: POLL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastDriftCount,
      lastStatus: lastError ? "blocked" : lastDriftCount > 0 ? "drift_detected" : "clean",
      totalCycles,
      totalDrifts,
      totalFailedCycles
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}

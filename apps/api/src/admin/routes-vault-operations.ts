import express from "express";
import { z } from "zod";
import { deriveBotVaultLifecycleState } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";

const adminVaultExecutionModeSchema = z.object({
  mode: z.enum(["offchain_shadow", "onchain_simulated", "onchain_live"]).optional(),
  provider: z.enum(["mock", "hyperliquid_demo", "hyperliquid"]).optional(),
  hyperliquidPilot: z.object({
    enabled: z.boolean().optional(),
    allowedUserIds: z.array(z.string().trim().min(1)).optional(),
    allowedWorkspaceIds: z.array(z.string().trim().min(1)).optional()
  }).optional()
});

const adminVaultProfitShareTreasurySchema = z.object({
  enabled: z.boolean().optional(),
  walletAddress: z.string().trim().max(128).nullable().optional(),
  feeRatePct: z.number().int().min(0).max(100).optional()
});

const adminVaultProfitShareTreasuryConfigTxSchema = z.object({
  kind: z.enum(["recipient", "fee_rate"]).optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const adminVaultSafetyControlsSchema = z.object({
  haltNewOrders: z.boolean().optional(),
  closeOnlyAllUserIds: z.array(z.string().trim().min(1)).optional(),
  reason: z.string().trim().max(500).nullable().optional()
});

const adminCloseOnlyAllSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1)
});

const adminVaultInterventionSchema = z.object({
  action: z.enum(["sync_execution_state", "pause", "activate", "set_close_only", "close"]),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
  forceClose: z.boolean().optional()
});

export type RegisterAdminVaultOperationsRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  getVaultExecutionModeSettings(db: any): Promise<any>;
  setVaultExecutionModeSettings(db: any, mode: any): Promise<any>;
  getVaultExecutionProviderSettings(db: any): Promise<any>;
  setVaultExecutionProviderSettings(db: any, provider: any): Promise<any>;
  getGridHyperliquidPilotSettings(db: any): Promise<any>;
  setGridHyperliquidPilotSettings(db: any, input: any): Promise<any>;
  GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY: string;
  getVaultProfitShareTreasurySettings(db: any): Promise<any>;
  setVaultProfitShareTreasurySettings(db: any, input: any): Promise<any>;
  normalizeTreasuryWalletAddress(value: string): string | null;
  normalizeProfitShareFeeRatePct(value: unknown): number | null;
  onchainActionService: any;
  ONCHAIN_TREASURY_PAYOUT_MODEL: string;
  parseJsonObject(value: unknown): Record<string, unknown>;
  ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null>;
  getVaultSafetyControlsSettings(): Promise<any>;
  setVaultSafetyControlsSettings(input: any): Promise<any>;
  vaultService: any;
  vaultAccountingJob: { getStatus(): any };
  botVaultRiskJob: { getStatus(): any };
  botVaultTradingReconciliationJob: { getStatus(): any };
  vaultOnchainIndexerJob: { getStatus(): any };
  vaultOnchainReconciliationJob: { getStatus(): any };
};

export function registerAdminVaultOperationsRoutes(app: express.Express, deps: RegisterAdminVaultOperationsRoutesDeps) {
  app.get("/admin/settings/vault-execution-mode", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const [settings, providerSettings, hyperliquidPilot] = await Promise.all([
      deps.getVaultExecutionModeSettings(deps.db),
      deps.getVaultExecutionProviderSettings(deps.db),
      deps.getGridHyperliquidPilotSettings(deps.db)
    ]);
    const row = await deps.db.globalSetting.findUnique({ where: { key: deps.GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY }, select: { updatedAt: true } });
    return res.json({ ...settings, updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : settings.updatedAt, provider: providerSettings.provider, providerSource: providerSettings.source, providerUpdatedAt: providerSettings.updatedAt, defaults: { mode: settings.defaults.mode, provider: providerSettings.defaults.provider }, availableProviders: providerSettings.availableProviders, hyperliquidPilot, hyperliquidPilotUpdatedAt: hyperliquidPilot.updatedAt });
  });

  app.put("/admin/settings/vault-execution-mode", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminVaultExecutionModeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    if (!parsed.data.mode && !parsed.data.provider && !parsed.data.hyperliquidPilot) {
      return res.status(400).json({ error: "invalid_payload", reason: "mode_or_provider_or_pilot_required" });
    }
    if (parsed.data.mode) await deps.setVaultExecutionModeSettings(deps.db, parsed.data.mode);
    if (parsed.data.provider) await deps.setVaultExecutionProviderSettings(deps.db, parsed.data.provider);
    if (parsed.data.hyperliquidPilot) await deps.setGridHyperliquidPilotSettings(deps.db, parsed.data.hyperliquidPilot);
    const [saved, providerSettings, hyperliquidPilot] = await Promise.all([
      deps.getVaultExecutionModeSettings(deps.db),
      deps.getVaultExecutionProviderSettings(deps.db),
      deps.getGridHyperliquidPilotSettings(deps.db)
    ]);
    return res.json({ ...saved, provider: providerSettings.provider, providerSource: providerSettings.source, providerUpdatedAt: providerSettings.updatedAt, defaults: { mode: saved.defaults.mode, provider: providerSettings.defaults.provider }, availableProviders: providerSettings.availableProviders, hyperliquidPilot, hyperliquidPilotUpdatedAt: hyperliquidPilot.updatedAt });
  });

  app.get("/admin/settings/vault-profit-share-treasury", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await deps.getVaultProfitShareTreasurySettings(deps.db));
  });

  app.put("/admin/settings/vault-profit-share-treasury", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminVaultProfitShareTreasurySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    if (parsed.data.enabled == null && parsed.data.walletAddress === undefined && parsed.data.feeRatePct === undefined) {
      return res.status(400).json({ error: "invalid_payload", reason: "enabled_or_wallet_address_or_fee_rate_required" });
    }
    if (parsed.data.walletAddress !== undefined && parsed.data.walletAddress !== null && !deps.normalizeTreasuryWalletAddress(parsed.data.walletAddress)) {
      return res.status(400).json({ error: "invalid_treasury_wallet_address" });
    }
    if (parsed.data.feeRatePct !== undefined && deps.normalizeProfitShareFeeRatePct(parsed.data.feeRatePct) == null) {
      return res.status(400).json({ error: "invalid_profit_share_fee_rate_pct" });
    }
    try {
      const current = await deps.getVaultProfitShareTreasurySettings(deps.db);
      const updated = await deps.setVaultProfitShareTreasurySettings(deps.db, {
        enabled: parsed.data.enabled ?? current.enabled,
        walletAddress: parsed.data.walletAddress === undefined ? current.walletAddress : parsed.data.walletAddress,
        feeRatePct: parsed.data.feeRatePct === undefined ? current.feeRatePct : parsed.data.feeRatePct
      });
      return res.json(updated);
    } catch (error) {
      const reason = String(error ?? "");
      if (reason.includes("invalid_treasury_wallet_address")) return res.status(400).json({ error: "invalid_treasury_wallet_address" });
      if (reason.includes("invalid_profit_share_fee_rate_pct")) return res.status(400).json({ error: "invalid_profit_share_fee_rate_pct" });
      return res.status(500).json({ error: "vault_profit_share_treasury_update_failed", reason });
    }
  });

  app.post("/admin/vault-profit-share/treasury-config-tx", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.onchainActionService) return res.status(503).json({ error: "onchain_action_service_unavailable" });
    const parsed = adminVaultProfitShareTreasuryConfigTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const settings = await deps.getVaultProfitShareTreasurySettings(deps.db);
    const kind = parsed.data.kind ?? "recipient";
    if (!settings.enabled) return res.status(409).json({ error: "treasury_wallet_not_configured" });
    if (kind === "recipient" && !settings.walletAddress) return res.status(409).json({ error: "treasury_wallet_not_configured" });
    try {
      const adminUser = getUserFromLocals(res);
      const result = kind === "fee_rate"
        ? await deps.onchainActionService.buildSetProfitShareFeeRate({
            userId: adminUser.id,
            feeRatePct: settings.feeRatePct,
            actionKey: parsed.data.actionKey
          })
        : await deps.onchainActionService.buildSetTreasuryRecipient({
            userId: adminUser.id,
            treasuryRecipient: settings.walletAddress as `0x${string}`,
            actionKey: parsed.data.actionKey
          });
      return res.json({ ok: true, settings, ...result });
    } catch (error) {
      return res.status(500).json({ error: "vault_profit_share_treasury_tx_build_failed", reason: String(error) });
    }
  });

  app.get("/admin/vault-profit-share/summary", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const rows = await deps.db.feeEvent.findMany({ select: { feeAmount: true, metadata: true } }).catch(() => []);
    let totalFeePaidUsd = 0;
    let totalOnchainPaidUsd = 0;
    let pendingLegacyAccrualUsd = 0;
    for (const row of rows) {
      const feeAmount = Number(row.feeAmount ?? 0);
      totalFeePaidUsd += feeAmount;
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
      if (metadata.treasuryPayoutModel === deps.ONCHAIN_TREASURY_PAYOUT_MODEL) totalOnchainPaidUsd += feeAmount;
      else pendingLegacyAccrualUsd += feeAmount;
    }
    const settings = await deps.getVaultProfitShareTreasurySettings(deps.db);
    return res.json({
      totalFeePaidUsd: Math.round(totalFeePaidUsd * 10_000) / 10_000,
      totalOnchainPaidUsd: Math.round(totalOnchainPaidUsd * 10_000) / 10_000,
      pendingLegacyAccrualUsd: Math.round(pendingLegacyAccrualUsd * 10_000) / 10_000,
      feeRatePct: settings.feeRatePct,
      onchainFeeRatePct: settings.onchainFeeRatePct
    });
  });

  app.get("/admin/vault-profit-share/payouts", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const rows = await deps.db.feeEvent.findMany({ orderBy: [{ createdAt: "desc" }], take: 100, select: { id: true, botVaultId: true, feeAmount: true, profitBase: true, metadata: true, createdAt: true, botVault: { select: { userId: true, gridInstanceId: true } } } }).catch(() => []);
    return res.json({ items: rows.map((row: any) => ({ id: String(row.id), botVaultId: String(row.botVaultId), userId: row.botVault?.userId ? String(row.botVault.userId) : null, gridInstanceId: row.botVault?.gridInstanceId ? String(row.botVault.gridInstanceId) : null, feeAmountUsd: Number(row.feeAmount ?? 0), profitBaseUsd: Number(row.profitBase ?? 0), metadata: row.metadata ?? null, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null })) });
  });

  app.get("/admin/grid-hyperliquid-pilot", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const settings = await deps.getGridHyperliquidPilotSettings(deps.db);
    const [resolvedUserCount, resolvedWorkspaceCount, hyperliquidDemoVaultCount, hyperliquidDemoGridBotCount, activeHyperliquidDemoGridBotCount, recentExecutionEventsRaw, recentVaultErrorsRaw] = await Promise.all([
      settings.allowedUserIds.length > 0 ? deps.db.user.count({ where: { id: { in: settings.allowedUserIds } } }).catch(() => 0) : 0,
      settings.allowedWorkspaceIds.length > 0 ? deps.db.workspace.count({ where: { id: { in: settings.allowedWorkspaceIds } } }).catch(() => 0) : 0,
      deps.ignoreMissingTable(() => deps.db.botVault.count({ where: { executionProvider: "hyperliquid_demo" } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.gridBotInstance.count({ where: { botVault: { executionProvider: "hyperliquid_demo" } } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.gridBotInstance.count({ where: { state: { in: ["created", "running", "paused", "error"] }, botVault: { executionProvider: "hyperliquid_demo" } } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botExecutionEvent.findMany({ where: { providerKey: "hyperliquid_demo", OR: [{ result: "failed" }, { action: "provision_identity", result: "succeeded" }] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, botVaultId: true, gridInstanceId: true, botId: true, providerKey: true, executionUnitId: true, action: true, result: true, reason: true, metadata: true, createdAt: true, botVault: { select: { userId: true, executionStatus: true, user: { select: { email: true } }, gridInstance: { select: { state: true, template: { select: { name: true, symbol: true } } } } } } } })).then((value) => Array.isArray(value) ? value : []).catch(() => []),
      deps.ignoreMissingTable(() => deps.db.botVault.findMany({ where: { executionProvider: "hyperliquid_demo", OR: [{ executionLastError: { not: null } }, { executionStatus: "error" }] }, orderBy: [{ executionLastErrorAt: "desc" }, { updatedAt: "desc" }], take: 12, select: { id: true, userId: true, gridInstanceId: true, executionProvider: true, executionUnitId: true, executionStatus: true, executionLastError: true, executionLastErrorAt: true, executionMetadata: true, user: { select: { email: true } }, gridInstance: { select: { botId: true, state: true, template: { select: { name: true, symbol: true } } } } } })).then((value) => Array.isArray(value) ? value : []).catch(() => [])
    ]);
    const recentExecutionEvents = recentExecutionEventsRaw.map((row: any) => {
      const metadata = deps.parseJsonObject(row.metadata);
      const kind = row.action === "provision_identity" && row.result === "succeeded" ? "GRID_HYPERLIQUID_PROVIDER_SELECTED" : row.action === "sync_state" && row.result === "failed" ? "GRID_HYPERLIQUID_EXECUTION_SYNC_ERROR" : "GRID_HYPERLIQUID_EXECUTION_ERROR";
      return { id: `execution:${row.id}`, kind, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date().toISOString(), provider: row.providerKey ?? "hyperliquid_demo", action: row.action ?? null, result: row.result ?? null, reason: row.reason ?? null, botVaultId: row.botVaultId ? String(row.botVaultId) : null, gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null, botId: row.botId ? String(row.botId) : null, executionUnitId: row.executionUnitId ? String(row.executionUnitId) : null, executionStatus: row.botVault?.executionStatus ? String(row.botVault.executionStatus) : null, gridState: row.botVault?.gridInstance?.state ? String(row.botVault.gridInstance.state) : null, templateName: row.botVault?.gridInstance?.template?.name ? String(row.botVault.gridInstance.template.name) : null, symbol: row.botVault?.gridInstance?.template?.symbol ? String(row.botVault.gridInstance.template.symbol) : null, userId: row.botVault?.userId ? String(row.botVault.userId) : null, userEmail: row.botVault?.user?.email ? String(row.botVault.user.email) : null, providerSelectionReason: typeof metadata.providerSelectionReason === "string" ? metadata.providerSelectionReason : null, pilotScope: typeof metadata.pilotScope === "string" ? metadata.pilotScope : null, message: kind === "GRID_HYPERLIQUID_PROVIDER_SELECTED" ? `Provider selected via ${String(metadata.providerSelectionReason ?? "hyperliquid_demo")}` : (row.reason ? String(row.reason) : null) };
    });
    const recentVaultErrors = recentVaultErrorsRaw.map((row: any) => {
      const metadata = deps.parseJsonObject(row.executionMetadata);
      return { id: `vault:${row.id}:${row.executionLastErrorAt instanceof Date ? row.executionLastErrorAt.toISOString() : "unknown"}`, kind: "GRID_HYPERLIQUID_EXECUTION_ERROR", createdAt: row.executionLastErrorAt instanceof Date ? row.executionLastErrorAt.toISOString() : new Date().toISOString(), provider: row.executionProvider ? String(row.executionProvider) : "hyperliquid_demo", action: typeof metadata.lastAction === "string" ? metadata.lastAction : null, result: "failed", reason: row.executionLastError ? String(row.executionLastError) : null, botVaultId: String(row.id), gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null, botId: row.gridInstance?.botId ? String(row.gridInstance.botId) : null, executionUnitId: row.executionUnitId ? String(row.executionUnitId) : null, executionStatus: row.executionStatus ? String(row.executionStatus) : null, gridState: row.gridInstance?.state ? String(row.gridInstance.state) : null, templateName: row.gridInstance?.template?.name ? String(row.gridInstance.template.name) : null, symbol: row.gridInstance?.template?.symbol ? String(row.gridInstance.template.symbol) : null, userId: row.userId ? String(row.userId) : null, userEmail: row.user?.email ? String(row.user.email) : null, providerSelectionReason: typeof metadata.providerSelectionReason === "string" ? metadata.providerSelectionReason : null, pilotScope: typeof metadata.pilotScope === "string" ? metadata.pilotScope : null, message: row.executionLastError ? String(row.executionLastError) : null };
    });
    const recentEvents = [...recentExecutionEvents, ...recentVaultErrors].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 12);
    return res.json({ settings, counts: { configuredUsers: settings.allowedUserIds.length, resolvedUsers: resolvedUserCount, configuredWorkspaces: settings.allowedWorkspaceIds.length, resolvedWorkspaces: resolvedWorkspaceCount, hyperliquidDemoVaults: hyperliquidDemoVaultCount, hyperliquidDemoGridBots: hyperliquidDemoGridBotCount, activeHyperliquidDemoGridBots: activeHyperliquidDemoGridBotCount, issueCount: recentEvents.filter((entry) => entry.kind !== "GRID_HYPERLIQUID_PROVIDER_SELECTED").length }, recentEvents, updatedAt: new Date().toISOString() });
  });

  app.get("/admin/vault-ops/status", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const lagAlertSeconds = Math.max(30, Math.trunc(Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_LAG_ALERT_SECONDS ?? 120) || 120));
    const lagThreshold = new Date(Date.now() - lagAlertSeconds * 1000);
    const [modeSettings, providerSettings, safety, totalBotVaults, openBotVaults, runningExecutions, executionErrorCount, pendingOnchainActions, failedOnchainActions, laggingReconciliationCount, lifecycleRows, recentExecutionIssues, recentOnchainActions, laggingVaults] = await Promise.all([
      deps.getVaultExecutionModeSettings(deps.db),
      deps.getVaultExecutionProviderSettings(deps.db),
      deps.getVaultSafetyControlsSettings(),
      deps.ignoreMissingTable(() => deps.db.botVault.count()).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botVault.count({ where: { status: { not: "CLOSED" } } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botVault.count({ where: { executionStatus: "running" } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botVault.count({ where: { OR: [{ executionStatus: "error" }, { executionLastError: { not: null } }] } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.onchainAction.count({ where: { status: { in: ["prepared", "submitted"] } } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.onchainAction.count({ where: { status: "failed" } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botVault.count({ where: { status: { not: "CLOSED" }, OR: [{ pnlAggregate: { is: null } }, { pnlAggregate: { is: { lastReconciledAt: { lt: lagThreshold } } } }] } })).then((value) => Number(value ?? 0)).catch(() => 0),
      deps.ignoreMissingTable(() => deps.db.botVault.findMany({
        select: {
          status: true,
          executionStatus: true,
          executionLastError: true,
          executionMetadata: true
        }
      })).then((value) => Array.isArray(value) ? value : []).catch(() => []),
      deps.ignoreMissingTable(() => deps.db.botVault.findMany({ where: { OR: [{ executionStatus: "error" }, { executionLastError: { not: null } }] }, orderBy: [{ executionLastErrorAt: "desc" }, { updatedAt: "desc" }], take: 10, select: { id: true, userId: true, gridInstanceId: true, status: true, executionProvider: true, executionStatus: true, executionLastError: true, executionLastErrorAt: true, executionMetadata: true, agentWalletVersion: true, agentSecretRef: true, user: { select: { email: true } }, gridInstance: { select: { state: true, template: { select: { name: true, symbol: true } } } }, pnlAggregate: { select: { lastReconciledAt: true, isFlat: true, openPositionCount: true } } } })).then((value) => Array.isArray(value) ? value : []).catch(() => []),
      deps.ignoreMissingTable(() => deps.db.onchainAction.findMany({ orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, actionType: true, status: true, txHash: true, userId: true, botVaultId: true, masterVaultId: true, updatedAt: true, createdAt: true, metadata: true, user: { select: { email: true } } } })).then((value) => Array.isArray(value) ? value : []).catch(() => []),
      deps.ignoreMissingTable(() => deps.db.botVault.findMany({ where: { status: { not: "CLOSED" }, OR: [{ pnlAggregate: { is: null } }, { pnlAggregate: { is: { lastReconciledAt: { lt: lagThreshold } } } }] }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, userId: true, gridInstanceId: true, status: true, executionStatus: true, executionMetadata: true, executionLastError: true, updatedAt: true, user: { select: { email: true } }, gridInstance: { select: { template: { select: { name: true, symbol: true } } } }, pnlAggregate: { select: { lastReconciledAt: true, isFlat: true, openPositionCount: true, realizedPnlNet: true, netWithdrawableProfit: true } } } })).then((value) => Array.isArray(value) ? value : []).catch(() => [])
    ]);
    const lifecycleCounts = lifecycleRows.reduce<Record<string, number>>((acc, row: any) => {
      const lifecycle = deriveBotVaultLifecycleState({
        status: row?.status,
        executionStatus: row?.executionStatus,
        executionLastError: row?.executionLastError,
        executionMetadata: row?.executionMetadata
      });
      acc[lifecycle.state] = Number(acc[lifecycle.state] ?? 0) + 1;
      return acc;
    }, {
      bot_creation: 0,
      bot_activation: 0,
      execution_active: 0,
      paused: 0,
      settling: 0,
      withdraw_pending: 0,
      closed: 0,
      error: 0
    });
    return res.json({
      updatedAt: new Date().toISOString(),
      mode: modeSettings.mode,
      modeSource: modeSettings.source,
      provider: providerSettings.provider,
      providerSource: providerSettings.source,
      safety,
      thresholds: { reconciliationLagAlertSeconds: lagAlertSeconds },
      lifecycleCounts,
      health: {
        vaultAccounting: deps.vaultAccountingJob.getStatus(),
        botVaultRisk: deps.botVaultRiskJob.getStatus(),
        botVaultTradingReconciliation: deps.botVaultTradingReconciliationJob.getStatus(),
        vaultOnchainIndexer: deps.vaultOnchainIndexerJob.getStatus(),
        vaultOnchainReconciliation: deps.vaultOnchainReconciliationJob.getStatus()
      },
      counts: { totalBotVaults, openBotVaults, runningExecutions, executionErrorCount, pendingOnchainActions, failedOnchainActions, laggingReconciliationCount },
      recentExecutionIssues: recentExecutionIssues.map((row: any) => { const lifecycle = deriveBotVaultLifecycleState({ status: row.status, executionStatus: row.executionStatus, executionLastError: row.executionLastError, executionMetadata: row.executionMetadata }); return ({ id: String(row.id), userId: String(row.userId), userEmail: row.user?.email ? String(row.user.email) : null, gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null, templateName: row.gridInstance?.template?.name ? String(row.gridInstance.template.name) : null, symbol: row.gridInstance?.template?.symbol ? String(row.gridInstance.template.symbol) : null, executionProvider: row.executionProvider ? String(row.executionProvider) : null, status: String(row.status ?? "ACTIVE"), executionStatus: row.executionStatus ? String(row.executionStatus) : null, lifecycleState: lifecycle.state, lifecycleMode: lifecycle.mode, executionLastError: row.executionLastError ? String(row.executionLastError) : null, executionLastErrorAt: row.executionLastErrorAt instanceof Date ? row.executionLastErrorAt.toISOString() : null, agentWalletVersion: Number(row.agentWalletVersion ?? 1), agentSecretRef: row.agentSecretRef ? String(row.agentSecretRef) : null, gridState: row.gridInstance?.state ? String(row.gridInstance.state) : null, lastReconciledAt: row.pnlAggregate?.lastReconciledAt instanceof Date ? row.pnlAggregate.lastReconciledAt.toISOString() : null, isFlat: typeof row.pnlAggregate?.isFlat === "boolean" ? row.pnlAggregate.isFlat : null, openPositionCount: Number(row.pnlAggregate?.openPositionCount ?? 0) }); }),
      recentOnchainActions: recentOnchainActions.map((row: any) => ({ id: String(row.id), actionType: String(row.actionType), status: String(row.status), txHash: row.txHash ? String(row.txHash) : null, userId: row.userId ? String(row.userId) : null, userEmail: row.user?.email ? String(row.user.email) : null, botVaultId: row.botVaultId ? String(row.botVaultId) : null, masterVaultId: row.masterVaultId ? String(row.masterVaultId) : null, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null, metadata: deps.parseJsonObject(row.metadata) })),
      laggingVaults: laggingVaults.map((row: any) => { const lifecycle = deriveBotVaultLifecycleState({ status: row.status, executionStatus: row.executionStatus, executionLastError: row.executionLastError, executionMetadata: row.executionMetadata }); return ({ id: String(row.id), userId: String(row.userId), userEmail: row.user?.email ? String(row.user.email) : null, gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null, templateName: row.gridInstance?.template?.name ? String(row.gridInstance.template.name) : null, symbol: row.gridInstance?.template?.symbol ? String(row.gridInstance.template.symbol) : null, status: String(row.status), executionStatus: row.executionStatus ? String(row.executionStatus) : null, lifecycleState: lifecycle.state, lifecycleMode: lifecycle.mode, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null, lastReconciledAt: row.pnlAggregate?.lastReconciledAt instanceof Date ? row.pnlAggregate.lastReconciledAt.toISOString() : null, isFlat: typeof row.pnlAggregate?.isFlat === "boolean" ? row.pnlAggregate.isFlat : null, openPositionCount: Number(row.pnlAggregate?.openPositionCount ?? 0), realizedPnlNet: Number(row.pnlAggregate?.realizedPnlNet ?? 0), netWithdrawableProfit: Number(row.pnlAggregate?.netWithdrawableProfit ?? 0) }); })
    });
  });

  app.get("/admin/vault-ops/reconciliation-summary", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const rows = await deps.ignoreMissingTable(() => deps.db.botVault.findMany({
      where: {
        status: { not: "CLOSED" }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        userId: true,
        gridInstanceId: true,
        status: true,
        executionStatus: true,
        executionLastError: true,
        executionMetadata: true,
        updatedAt: true,
        user: { select: { email: true } },
        gridInstance: { select: { template: { select: { name: true, symbol: true } } } }
      }
    })).then((value) => Array.isArray(value) ? value : []).catch(() => []);

    const counts = {
      clean: 0,
      warning: 0,
      drift_detected: 0,
      blocked: 0,
      unknown: 0
    };

    const items = rows.map((row: any) => {
      const executionMetadata = deps.parseJsonObject(row.executionMetadata);
      const tradingReconciliation = deps.parseJsonObject(executionMetadata.tradingReconciliation);
      const result = deps.parseJsonObject(tradingReconciliation.result);
      const derivedLifecycle = deriveBotVaultLifecycleState({
        status: row.status,
        executionStatus: row.executionStatus,
        executionLastError: row.executionLastError,
        executionMetadata: row.executionMetadata
      });
      const status = typeof result.status === "string"
        ? result.status
        : row.executionLastError
          ? "blocked"
          : tradingReconciliation.lastReconciledAt
            ? "warning"
            : "unknown";
      if (status === "clean" || status === "warning" || status === "drift_detected" || status === "blocked") {
        counts[status] += 1;
      } else {
        counts.unknown += 1;
      }
      return {
        id: String(row.id),
        userId: String(row.userId),
        userEmail: row.user?.email ? String(row.user.email) : null,
        gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
        templateName: row.gridInstance?.template?.name ? String(row.gridInstance.template.name) : null,
        symbol: row.gridInstance?.template?.symbol ? String(row.gridInstance.template.symbol) : null,
        status: String(row.status),
        executionStatus: row.executionStatus ? String(row.executionStatus) : null,
        lifecycleState: derivedLifecycle.state,
        lifecycleMode: derivedLifecycle.mode,
        reconciliationStatus: status,
        reconciliationObservedAt: typeof result.observedAt === "string"
          ? result.observedAt
          : typeof tradingReconciliation.lastReconciledAt === "string"
            ? tradingReconciliation.lastReconciledAt
            : null,
        driftCount: Number(result.driftCount ?? 0),
        warningCount: Number(result.warningCount ?? 0),
        blockedReasons: Array.isArray(result.blockedReasons)
          ? result.blockedReasons.map((entry: unknown) => String(entry ?? "")).filter(Boolean)
          : [],
        items: Array.isArray(result.items) ? result.items : [],
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
      };
    });

    return res.json({
      updatedAt: new Date().toISOString(),
      jobs: {
        trading: deps.botVaultTradingReconciliationJob.getStatus(),
        accounting: deps.vaultAccountingJob.getStatus(),
        onchainIndexer: deps.vaultOnchainIndexerJob.getStatus(),
        onchainReconciliation: deps.vaultOnchainReconciliationJob.getStatus()
      },
      counts,
      items: items
        .filter((entry) => entry.reconciliationStatus !== "clean")
        .slice(0, 30)
    });
  });

  app.get("/admin/settings/vault-safety", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await deps.getVaultSafetyControlsSettings());
  });

  app.put("/admin/settings/vault-safety", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminVaultSafetyControlsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    const current = await deps.getVaultSafetyControlsSettings();
    const saved = await deps.setVaultSafetyControlsSettings({ haltNewOrders: parsed.data.haltNewOrders ?? current.haltNewOrders, closeOnlyAllUserIds: parsed.data.closeOnlyAllUserIds ?? current.closeOnlyAllUserIds, reason: parsed.data.reason ?? current.reason, updatedByUserId: user.id });
    return res.json(saved);
  });

  app.post("/admin/users/:id/vaults/close-only-all", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminCloseOnlyAllSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const actor = getUserFromLocals(res);
    try {
      const current = await deps.getVaultSafetyControlsSettings();
      const nextUserIds = Array.from(new Set([...current.closeOnlyAllUserIds, req.params.id]));
      const [settings, result] = await Promise.all([
        deps.setVaultSafetyControlsSettings({ haltNewOrders: current.haltNewOrders, closeOnlyAllUserIds: nextUserIds, reason: parsed.data.reason ?? "admin_close_only_all", updatedByUserId: actor.id }),
        deps.vaultService.setAllUserBotVaultsCloseOnly({ userId: req.params.id, actorUserId: actor.id, reason: parsed.data.reason ?? "admin_close_only_all", idempotencyKeyPrefix: parsed.data.idempotencyKey })
      ]);
      return res.json({ ok: true, safety: settings, result });
    } catch (error) {
      return res.status(500).json({ error: "vault_close_only_all_failed", reason: String(error) });
    }
  });

  app.get("/admin/vault-ops/bot-vaults/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const snapshot = await deps.vaultService.getBotVaultLifecycleSnapshot({
        botVaultId: req.params.id
      });
      if (!snapshot) return res.status(404).json({ error: "bot_vault_not_found" });
      return res.json({ ok: true, vault: snapshot });
    } catch (error) {
      return res.status(500).json({ error: "vault_lifecycle_snapshot_failed", reason: String(error) });
    }
  });

  app.post("/admin/vault-ops/bot-vaults/:id/intervene", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminVaultInterventionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const snapshot = await deps.vaultService.getBotVaultLifecycleSnapshot({
      botVaultId: req.params.id
    });
    if (!snapshot) return res.status(404).json({ error: "bot_vault_not_found" });

    const action = parsed.data.action;
    const reason = parsed.data.reason ?? `admin_${action}`;

    try {
      let result: unknown;
      if (action === "sync_execution_state") {
        result = await deps.vaultService.syncBotVaultExecutionState({
          userId: snapshot.userId,
          botVaultId: snapshot.id,
          sourceKey: `admin:${snapshot.id}:sync_execution_state:${Date.now()}`
        });
      } else if (action === "pause") {
        result = await deps.vaultService.pauseBotVault({
          userId: snapshot.userId,
          botVaultId: snapshot.id,
          reason
        });
      } else if (action === "activate") {
        result = await deps.vaultService.activateBotVault({
          userId: snapshot.userId,
          botVaultId: snapshot.id,
          reason
        });
      } else if (action === "set_close_only") {
        result = await deps.vaultService.setBotVaultCloseOnly({
          userId: snapshot.userId,
          botVaultId: snapshot.id,
          reason
        });
      } else {
        if (!parsed.data.idempotencyKey) {
          return res.status(400).json({ error: "idempotency_key_required" });
        }
        result = await deps.vaultService.closeBotVault({
          userId: snapshot.userId,
          botVaultId: snapshot.id,
          idempotencyKey: parsed.data.idempotencyKey,
          forceClose: parsed.data.forceClose === true,
          metadata: {
            sourceType: "admin_vault_intervention",
            reason
          }
        });
      }

      const updated = await deps.vaultService.getBotVaultLifecycleSnapshot({
        botVaultId: snapshot.id
      });
      return res.json({
        ok: true,
        action,
        result,
        vault: updated ?? snapshot
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_intervention_failed",
        action,
        reason: String(error)
      });
    }
  });
}

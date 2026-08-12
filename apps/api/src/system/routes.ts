import express from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";

export type RegisterSystemRoutesDeps = {
  db: any;
  getVaultExecutionModeSettings(db: any): Promise<{ mode: string }>;
  getVaultSafetyControlsSettings(): Promise<any>;
  parseVaultSafetyControls(value: unknown): any;
  getRuntimeOrchestrationMode(): string;
  isBillingEnabled(): Promise<boolean>;
  isLicenseEnforcementEnabled(): boolean;
  getQueueMetrics(): Promise<any>;
  resolvePlanCapabilitiesForUserId(input: { userId: string }): Promise<{ plan: string; capabilities: Record<string, boolean> }>;
  listPluginCatalogForCapabilities(plan: string, capabilities: Record<string, boolean>): any;
  vaultAccountingJob: { getStatus(): unknown };
  botVaultRiskJob: { getStatus(): unknown };
  botVaultTradingReconciliationJob: { getStatus(): unknown };
  vaultOnchainIndexerJob: { getStatus(): unknown };
  vaultOnchainReconciliationJob: { getStatus(): unknown };
  marketIntelligenceRefreshJob: { getStatus(): unknown };
  economicCalendarDailyTelegramJob: { getStatus(): unknown };
  requireSuperadmin(res: express.Response): Promise<boolean>;
};

async function buildHealthDetails(deps: RegisterSystemRoutesDeps) {
  const [vaultExecutionMode, vaultSafety] = await Promise.all([
    deps.getVaultExecutionModeSettings(deps.db).catch(() => ({
      mode: "offchain_shadow"
    })),
    deps.getVaultSafetyControlsSettings().catch(() => deps.parseVaultSafetyControls(null))
  ]);
  return {
    ok: true,
    service: "api",
    vaultExecutionMode: vaultExecutionMode.mode,
    vaultSafety,
    jobs: {
      vaultAccounting: deps.vaultAccountingJob.getStatus(),
      botVaultRisk: deps.botVaultRiskJob.getStatus(),
      botVaultTradingReconciliation: deps.botVaultTradingReconciliationJob.getStatus(),
      vaultOnchainIndexer: deps.vaultOnchainIndexerJob.getStatus(),
      vaultOnchainReconciliation: deps.vaultOnchainReconciliationJob.getStatus(),
      marketIntelligenceRefresh: deps.marketIntelligenceRefreshJob.getStatus(),
      economicCalendarDailyTelegram: deps.economicCalendarDailyTelegramJob.getStatus()
    }
  };
}

export function registerSystemRoutes(
  app: express.Express,
  deps: RegisterSystemRoutesDeps
) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/admin/health/details", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    res.json(await buildHealthDetails(deps));
  });

  app.get("/system/settings", (_req, res) => {
    res.json({
      tradingEnabled: true,
      readOnlyMode: false
    });
  });

  app.get("/license/state", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const billingEnabled = await deps.isBillingEnabled();
    res.json({
      enforcement: deps.isLicenseEnforcementEnabled() ? "on" : "off",
      billingEnabled: billingEnabled ? "on" : "off"
    });
  });

  app.get("/admin/queue/metrics", requireAuth, async (_req, res) => {
    try {
      const metrics = await deps.getQueueMetrics();
      return res.json(metrics);
    } catch (error) {
      return res.status(503).json({
        error: "queue_unavailable",
        reason: String(error)
      });
    }
  });

  app.get("/plugins/catalog", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
      userId: user.id
    });
    return res.json({
      plan: capabilityContext.plan,
      items: deps.listPluginCatalogForCapabilities(capabilityContext.plan, capabilityContext.capabilities)
    });
  });
}

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
  isBillingWebhookEnabled(): Promise<boolean>;
  verifyCcpayWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<boolean>;
  recordWebhookEvent(input: { recordId: string; merchantOrderId: string; payload: unknown }): Promise<"created" | "duplicate">;
  applyPaidOrder(orderId: string, status: string): Promise<void>;
  markOrderFailed(orderId: string, status: string): Promise<void>;
  getQueueMetrics(): Promise<any>;
  resolvePlanCapabilitiesForUserId(input: { userId: string }): Promise<{ plan: string; capabilities: Record<string, boolean> }>;
  listPluginCatalogForCapabilities(plan: string, capabilities: Record<string, boolean>): any;
  vaultAccountingJob: { getStatus(): unknown };
  botVaultRiskJob: { getStatus(): unknown };
  botVaultTradingReconciliationJob: { getStatus(): unknown };
  vaultOnchainIndexerJob: { getStatus(): unknown };
  vaultOnchainReconciliationJob: { getStatus(): unknown };
};

export function registerSystemRoutes(
  app: express.Express,
  deps: RegisterSystemRoutesDeps
) {
  app.get("/health", async (_req, res) => {
    const [vaultExecutionMode, vaultSafety] = await Promise.all([
      deps.getVaultExecutionModeSettings(deps.db).catch(() => ({
        mode: "offchain_shadow"
      })),
      deps.getVaultSafetyControlsSettings().catch(() => deps.parseVaultSafetyControls(null))
    ]);
    res.json({
      ok: true,
      service: "api",
      vaultExecutionMode: vaultExecutionMode.mode,
      vaultSafety,
      jobs: {
        vaultAccounting: deps.vaultAccountingJob.getStatus(),
        botVaultRisk: deps.botVaultRiskJob.getStatus(),
        botVaultTradingReconciliation: deps.botVaultTradingReconciliationJob.getStatus(),
        vaultOnchainIndexer: deps.vaultOnchainIndexerJob.getStatus(),
        vaultOnchainReconciliation: deps.vaultOnchainReconciliationJob.getStatus()
      }
    });
  });

  app.get("/system/settings", (_req, res) => {
    res.json({
      tradingEnabled: true,
      readOnlyMode: false,
      orchestrationMode: deps.getRuntimeOrchestrationMode()
    });
  });

  app.get("/license/state", async (_req, res) => {
    const billingEnabled = await deps.isBillingEnabled();
    res.json({
      enforcement: deps.isLicenseEnforcementEnabled() ? "on" : "off",
      billingEnabled: billingEnabled ? "on" : "off"
    });
  });

  app.post("/webhooks/ccpayment", async (req, res) => {
    const ack = () => res.status(200).json({ msg: "Success" });

    if (!(await deps.isBillingWebhookEnabled())) {
      return res.status(404).json({ error: "billing_webhook_disabled" });
    }

    const rawBody = typeof (req as any).rawBody === "string"
      ? (req as any).rawBody
      : JSON.stringify(req.body ?? {});
    if (!(await deps.verifyCcpayWebhook(rawBody, req.headers as Record<string, string | string[] | undefined>))) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const payload = (req.body ?? {}) as {
      type?: string;
      record_id?: string;
      pay_status?: string;
      extend?: { merchant_order_id?: string };
      msg?: {
        recordId?: string;
        orderId?: string;
        status?: string;
      };
    };

    if (payload.type === "ActivateWebhookURL") {
      return ack();
    }

    const recordId = String(payload.msg?.recordId ?? payload.record_id ?? "").trim();
    const merchantOrderId = String(payload.msg?.orderId ?? payload.extend?.merchant_order_id ?? "").trim();
    const statusRaw = String(payload.pay_status ?? payload.msg?.status ?? "").trim();

    if (!recordId) {
      return ack();
    }

    const created = await deps.recordWebhookEvent({
      recordId,
      merchantOrderId,
      payload
    });
    if (created === "duplicate") {
      return ack();
    }

    if (!merchantOrderId) {
      return ack();
    }

    const normalized = statusRaw.toLowerCase();
    if (normalized === "processing") {
      return ack();
    }
    if (normalized === "success") {
      await deps.applyPaidOrder(merchantOrderId, statusRaw || "Success");
      return ack();
    }

    await deps.markOrderFailed(merchantOrderId, normalized || "failed");
    return ack();
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

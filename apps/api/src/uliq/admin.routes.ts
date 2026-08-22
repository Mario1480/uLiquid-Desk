import type express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getUliqFeatureFlags } from "./config.js";
import { UliqPresaleService } from "./presale.service.js";

const dexLaunchSchema = z.object({ dexLaunchTimestamp: z.string().trim().regex(/^[1-9]\d*$/).max(20) });

export function registerUliqAdminRoutes(app: express.Express, deps: {
  db: any;
  presaleService: UliqPresaleService;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  consumeRecentReauth: express.RequestHandler;
  recordAdminAuditEvent(input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void>;
}) {
  function enabled(res: express.Response): boolean {
    try {
      const flags = getUliqFeatureFlags();
      if (!flags.enabled || !flags.adminEnabled) {
        res.status(404).json({ error: "not_found" });
        return false;
      }
      return true;
    } catch {
      res.status(404).json({ error: "not_found" });
      return false;
    }
  }

  app.get("/admin/uliq", requireAuth, async (_req, res) => {
    if (!enabled(res) || !(await deps.requireSuperadmin(res))) return;
    const [overview, cursor, reconciliation, reservations, price] = await Promise.all([
      deps.presaleService.getOverview(),
      deps.db.onchainSyncCursor.findFirst({ where: { id: { startsWith: "uliq:" } }, orderBy: { updatedAt: "desc" } }),
      deps.db.uliqReconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      deps.db.uliqBenefitReservation.groupBy({ by: ["status"], _count: { _all: true } }),
      deps.db.uliqPriceSnapshot.findFirst({ orderBy: { observedAt: "desc" } })
    ]);
    return res.json({ overview, indexer: cursor, reconciliation, reservations, price });
  });

  app.post(
    "/admin/uliq/safe/set-dex-launch/prepare",
    requireAuth,
    deps.consumeRecentReauth,
    async (req, res) => {
      if (!enabled(res) || !(await deps.requireSuperadmin(res))) return;
      const parsed = dexLaunchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const prepared = await deps.presaleService.prepareDexLaunchTimestamp(parsed.data.dexLaunchTimestamp);
        const actor = getUserFromLocals(res);
        await deps.recordAdminAuditEvent({
          actorUserId: actor.id,
          action: "uliq_safe_transaction_prepared",
          targetType: "uliq_presale",
          targetId: prepared.safeTransaction.to,
          metadata: {
            function: "setDexLaunchTimestamp",
            dexLaunchTimestamp: parsed.data.dexLaunchTimestamp,
            chainId: prepared.safeTransaction.chainId,
            preflight: prepared.preflight
          },
          ip: typeof req.ip === "string" ? req.ip.slice(0, 191) : null
        });
        return res.json(prepared);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const status = reason.includes("pending") || reason.includes("dex_pending") ? 409 : 503;
        return res.status(status).json({ error: reason });
      }
    }
  );
}

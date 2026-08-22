import type express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getUliqFeatureFlags } from "./config.js";
import { UliqPresaleService } from "./presale.service.js";

const dexLaunchSchema = z.object({ dexLaunchTimestamp: z.string().trim().regex(/^[1-9]\d*$/).max(20) });

function jsonSafe(value: unknown): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]));
  }
  return value;
}

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
  const requireSuperadmin: express.RequestHandler = (_req, res, next) => {
    void deps.requireSuperadmin(res).then((allowed) => {
      if (allowed) next();
    }).catch(next);
  };

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

  app.get("/admin/uliq", requireAuth, requireSuperadmin, async (_req, res) => {
    if (!enabled(res)) return;
    const [overview, cursor, reconciliation, reservations, price, purchases, vesting, locks, tiers, alerts, audit] = await Promise.all([
      deps.presaleService.getOverview(),
      deps.db.onchainSyncCursor.findFirst({ where: { id: { startsWith: "uliq:" } }, orderBy: { updatedAt: "desc" } }),
      deps.db.uliqReconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      deps.db.uliqBenefitReservation.groupBy({ by: ["status"], _count: { _all: true } }),
      deps.db.uliqPriceSnapshot.findFirst({ orderBy: { observedAt: "desc" } }),
      deps.db.uliqPresalePurchase.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { usdcAmountRaw: true, uliqAllocationRaw: true, finalizationWalletRaw: true, finalizationVestingRaw: true }
      }),
      deps.db.uliqVestingPosition.aggregate({ _sum: { allocatedRaw: true, releasedRaw: true }, _count: { _all: true } }),
      deps.db.uliqLockPosition.aggregate({ where: { status: "ACTIVE" }, _sum: { amountRaw: true }, _count: { _all: true } }),
      deps.db.uliqTierConfig.findMany({ where: { enabled: true }, orderBy: [{ version: "desc" }, { minUsdValue: "asc" }] }),
      deps.db.platformAlert.findMany({ where: { source: { startsWith: "uliq" } }, orderBy: { createdAt: "desc" }, take: 20 }),
      deps.db.adminAuditEvent.findMany({ where: { targetType: "uliq_presale" }, orderBy: { createdAt: "desc" }, take: 20 })
    ]);
    return res.json(jsonSafe({
      overview,
      indexer: cursor,
      reconciliation,
      reservations,
      price,
      stats: { purchases, vesting, locks },
      tiers,
      alerts,
      audit
    }));
  });

  app.post(
    "/admin/uliq/safe/set-dex-launch/prepare",
    requireAuth,
    requireSuperadmin,
    deps.consumeRecentReauth,
    async (req, res) => {
      if (!enabled(res)) return;
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

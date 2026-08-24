import type express from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getUliqFeatureFlags } from "./config.js";
import { UliqPresaleService } from "./presale.service.js";
import { normalizeUliqTreasuryAddress, UliqTreasuryService } from "./treasury.service.js";

const dexLaunchSchema = z.object({ dexLaunchTimestamp: z.string().trim().regex(/^[1-9]\d*$/).max(20) });
const treasurySchema = z.object({ desiredAddress: z.string().trim().max(42) });

function jsonSafe(value: unknown): any {
  if (typeof value === "bigint") return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed();
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
  treasuryService: UliqTreasuryService;
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
    const [overview, treasury, cursor, reconciliation, reservations, price, purchases, vesting, locks, tiers, alerts, audit] = await Promise.all([
      deps.presaleService.getOverview(),
      deps.treasuryService.getState(),
      deps.db.onchainSyncCursor.findFirst({ where: { id: { startsWith: "uliq:" } }, orderBy: { updatedAt: "desc" } }),
      deps.db.uliqReconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      deps.db.uliqBenefitReservation.groupBy({ by: ["status"], _count: { _all: true } }),
      deps.db.uliqPriceSnapshot.findFirst({ orderBy: { observedAt: "desc" } }),
      deps.db.uliqPresalePurchase.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { usdcAmountRaw: true, uliqAllocationRaw: true, finalizationWalletRaw: true, finalizationVestingRaw: true, treasuryReleasedUsdcRaw: true }
      }),
      deps.db.uliqVestingPosition.aggregate({ _sum: { allocatedRaw: true, releasedRaw: true }, _count: { _all: true } }),
      deps.db.uliqLockPosition.aggregate({ where: { status: "ACTIVE" }, _sum: { amountRaw: true }, _count: { _all: true } }),
      deps.db.uliqTierConfig.findMany({ where: { enabled: true }, orderBy: [{ version: "desc" }, { minUsdValue: "asc" }] }),
      deps.db.platformAlert.findMany({ where: { source: { startsWith: "uliq" } }, orderBy: { createdAt: "desc" }, take: 20 }),
      deps.db.adminAuditEvent.findMany({ where: { targetType: { in: ["uliq_presale", "uliq_treasury"] } }, orderBy: { createdAt: "desc" }, take: 20 })
    ]);
    return res.json(jsonSafe({
      overview,
      treasury,
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

  app.put(
    "/admin/uliq/treasury",
    requireAuth,
    requireSuperadmin,
    deps.consumeRecentReauth,
    async (req, res) => {
      if (!enabled(res)) return;
      const parsed = treasurySchema.safeParse(req.body ?? {});
      if (!parsed.success || !normalizeUliqTreasuryAddress(parsed.data.desiredAddress)) {
        return res.status(400).json({ error: "invalid_uliq_treasury_address" });
      }
      try {
        const state = await deps.treasuryService.setDesiredTreasury(parsed.data.desiredAddress);
        const actor = getUserFromLocals(res);
        await deps.recordAdminAuditEvent({
          actorUserId: actor.id,
          action: "uliq_treasury_desired_address_updated",
          targetType: "uliq_treasury",
          targetId: state.custodyAddress,
          metadata: {
            desiredTreasury: state.desiredTreasury,
            activeTreasury: state.activeTreasury,
            syncStatus: state.syncStatus,
            asOfBlock: state.asOfBlock
          },
          ip: typeof req.ip === "string" ? req.ip.slice(0, 191) : null
        });
        return res.json(state);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return res.status(reason.includes("invalid") ? 400 : 503).json({ error: reason });
      }
    }
  );

  const treasuryPrepareActions = [
    { path: "/admin/uliq/treasury/propose/prepare", action: "proposeTreasury", prepare: () => deps.treasuryService.prepareProposal() },
    { path: "/admin/uliq/treasury/accept/prepare", action: "acceptTreasury", prepare: () => deps.treasuryService.prepareAcceptance() },
    { path: "/admin/uliq/treasury/cancel/prepare", action: "cancelTreasuryTransfer", prepare: () => deps.treasuryService.prepareCancellation() }
  ] as const;
  for (const entry of treasuryPrepareActions) {
    app.post(
      entry.path,
      requireAuth,
      requireSuperadmin,
      deps.consumeRecentReauth,
      async (req, res) => {
        if (!enabled(res)) return;
        try {
          const prepared = await entry.prepare();
          const actor = getUserFromLocals(res);
          await deps.recordAdminAuditEvent({
            actorUserId: actor.id,
            action: "uliq_treasury_safe_transaction_prepared",
            targetType: "uliq_treasury",
            targetId: prepared.safeTransaction.to,
            metadata: {
              function: entry.action,
              chainId: prepared.safeTransaction.chainId,
              expectedSender: prepared.safeTransaction.expectedSender,
              preflight: prepared.preflight
            },
            ip: typeof req.ip === "string" ? req.ip.slice(0, 191) : null
          });
          return res.json(prepared);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const status = reason.includes("already") || reason.includes("pending") || reason.includes("not_ready") ? 409 : 503;
          return res.status(status).json({ error: reason });
        }
      }
    );
  }

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

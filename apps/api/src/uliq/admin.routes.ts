import type express from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { ULIQ_APPROVED_TESTNET_BENEFIT_BPS } from "./benefitConfig.js";
import { getUliqFeatureFlags } from "./config.js";
import { UliqPresaleService, ULIQ_LOCK_TERMS } from "./presale.service.js";
import { normalizeUliqTreasuryAddress, UliqTreasuryService } from "./treasury.service.js";
import { ULIQ_LOCK_GATE_VERSION, ULIQ_REQUIRED_LOCK_SHARE_BPS } from "./math.js";

const dexLaunchSchema = z.object({ dexLaunchTimestamp: z.string().trim().regex(/^[1-9]\d*$/).max(20) });
const treasurySchema = z.object({ desiredAddress: z.string().trim().max(42) });
const tierBenefitConfigSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  tiers: z.array(z.object({
    code: z.string().trim().min(1).max(32),
    subscriptionDiscountBps: z.number().int().min(0).max(10_000),
    aiDiscountBps: z.number().int().min(0).max(10_000),
    aiCreditDiscountMonthlyCents: z.number().int().min(0).max(2_147_483_647).nullable()
  })).min(1).max(20)
}).superRefine((value, ctx) => {
  if (new Set(value.tiers.map((tier) => tier.code)).size !== value.tiers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers"], message: "Tier codes must be unique" });
  }
  value.tiers.forEach((tier, index) => {
    if (tier.aiDiscountBps > 0 && (!tier.aiCreditDiscountMonthlyCents || tier.aiCreditDiscountMonthlyCents <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiers", index, "aiCreditDiscountMonthlyCents"],
        message: "A positive AI discount requires a positive monthly cap"
      });
    }
  });
});

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
    tx?: any;
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
      deps.db.uliqTierConfig.findMany({ where: { enabled: true, effectiveUntil: null }, orderBy: [{ version: "desc" }, { minUsdValue: "asc" }] }),
      deps.db.platformAlert.findMany({ where: { source: { startsWith: "uliq" } }, orderBy: { createdAt: "desc" }, take: 20 }),
      deps.db.adminAuditEvent.findMany({ where: { targetType: { in: ["uliq_presale", "uliq_treasury", "uliq_tier_config"] } }, orderBy: { createdAt: "desc" }, take: 20 })
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
      lockGate: {
        version: ULIQ_LOCK_GATE_VERSION,
        coverageShareBps: ULIQ_REQUIRED_LOCK_SHARE_BPS,
        supportedTerms: ULIQ_LOCK_TERMS,
        tierCapStatus: tiers.map((tier: any) => ({
          code: String(tier.code),
          version: Number(tier.version),
          aiCreditDiscountMonthlyCents: tier.monetaryBenefitCaps
            && typeof tier.monetaryBenefitCaps === "object"
            && !Array.isArray(tier.monetaryBenefitCaps)
            ? tier.monetaryBenefitCaps.aiCreditDiscountMonthlyCents ?? null
            : null,
          configured: Boolean(
            tier.monetaryBenefitCaps
            && typeof tier.monetaryBenefitCaps === "object"
            && !Array.isArray(tier.monetaryBenefitCaps)
            && Number.isSafeInteger(Number(tier.monetaryBenefitCaps.aiCreditDiscountMonthlyCents))
          )
        }))
      },
      benefitPreset: ULIQ_APPROVED_TESTNET_BENEFIT_BPS,
      alerts,
      audit
    }));
  });

  app.put(
    "/admin/uliq/tier-benefits",
    requireAuth,
    requireSuperadmin,
    deps.consumeRecentReauth,
    async (req, res) => {
      if (!enabled(res)) return;
      const parsed = tierBenefitConfigSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const actor = getUserFromLocals(res);
        const result = await deps.db.$transaction(async (tx: any) => {
          const current = await tx.uliqTierConfig.findMany({
            where: { enabled: true, effectiveUntil: null },
            orderBy: [{ version: "desc" }, { minUsdValue: "asc" }]
          });
          const currentVersion = current.length
            ? Math.max(...current.map((tier: any) => Number(tier.version)))
            : 0;
          const active = current.filter((tier: any) => Number(tier.version) === currentVersion);
          const requested = new Map(parsed.data.tiers.map((tier) => [tier.code, tier]));
          if (
            active.length === 0
            || requested.size !== active.length
            || active.some((tier: any) => !requested.has(String(tier.code)))
          ) throw new Error("uliq_tier_config_set_mismatch");
          const now = new Date();
          const nextVersion = currentVersion + 1;
          const oldValue = active.map((tier: any) => ({
            code: tier.code,
            version: tier.version,
            subscriptionDiscountBps: tier.subscriptionDiscountBps,
            aiDiscountBps: tier.aiDiscountBps,
            monetaryBenefitCaps: tier.monetaryBenefitCaps
          }));
          await tx.uliqTierConfig.updateMany({
            where: { version: currentVersion, enabled: true, effectiveUntil: null },
            data: { effectiveUntil: now }
          });
          for (const tier of active) {
            const next = requested.get(String(tier.code))!;
            await tx.uliqTierConfig.create({
              data: {
                code: tier.code,
                version: nextVersion,
                enabled: true,
                minUsdValue: tier.minUsdValue,
                minimumLockDurationDays: null,
                featureFlags: tier.featureFlags,
                subscriptionDiscountBps: next.subscriptionDiscountBps,
                aiDiscountBps: next.aiDiscountBps,
                monetaryBenefitCaps: next.aiCreditDiscountMonthlyCents == null
                  ? Prisma.DbNull
                  : { aiCreditDiscountMonthlyCents: next.aiCreditDiscountMonthlyCents },
                effectiveFrom: now,
                effectiveUntil: null,
                createdByUserId: actor.id,
                reason: parsed.data.reason
              }
            });
          }
          const newValue = parsed.data.tiers.map((tier) => ({ ...tier, version: nextVersion }));
          await deps.recordAdminAuditEvent({
            tx,
            actorUserId: actor.id,
            action: "uliq_tier_benefits_version_created",
            targetType: "uliq_tier_config",
            targetId: String(nextVersion),
            metadata: { reason: parsed.data.reason, oldValue, newValue },
            ip: typeof req.ip === "string" ? req.ip.slice(0, 191) : null
          });
          return { version: nextVersion, effectiveFrom: now, tiers: newValue };
        });
        return res.json(jsonSafe(result));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return res.status(reason.includes("mismatch") ? 409 : 500).json({ error: reason });
      }
    }
  );

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
    "/admin/uliq/safe/mark-dex-pending/prepare",
    requireAuth,
    requireSuperadmin,
    deps.consumeRecentReauth,
    async (req, res) => {
      if (!enabled(res)) return;
      try {
        const prepared = await deps.presaleService.prepareMarkDexPending();
        const actor = getUserFromLocals(res);
        await deps.recordAdminAuditEvent({
          actorUserId: actor.id,
          action: "uliq_safe_transaction_prepared",
          targetType: "uliq_presale",
          targetId: prepared.safeTransaction.to,
          metadata: {
            function: "markDexPending",
            chainId: prepared.safeTransaction.chainId,
            expectedSender: prepared.safeTransaction.expectedSender,
            preflight: prepared.preflight
          },
          ip: typeof req.ip === "string" ? req.ip.slice(0, 191) : null
        });
        return res.json(prepared);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const conflict = [
          "not_ended",
          "pending_purchases",
          "custody_mismatch",
          "treasury_zero",
          "allocation_invalid",
          "inventory_insufficient"
        ].some((marker) => reason.includes(marker));
        return res.status(conflict ? 409 : 503).json({ error: reason });
      }
    }
  );

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

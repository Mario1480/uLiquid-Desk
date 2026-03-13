import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

const subscriptionCheckoutSchema = z.union([
  z.object({
    packageId: z.string().trim().min(1).max(191)
  }),
  z.object({
    items: z.array(z.object({
      packageId: z.string().trim().min(1).max(191),
      quantity: z.number().int().min(1).max(100)
    })).min(1).max(20)
  })
]);

const billingPackageIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const adminBillingPackageSchema = z.object({
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(["plan", "ai_topup", "entitlement_topup"]),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  currency: z.string().trim().min(3).max(12).optional(),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  billingMonths: z.number().int().min(1).max(36).optional(),
  plan: z.enum(["free", "pro"]).nullable().optional(),
  maxRunningBots: z.number().int().min(0).max(100_000).nullable().optional(),
  maxBotsTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  maxRunningPredictionsAi: z.number().int().min(0).max(100_000).nullable().optional(),
  maxPredictionsAiTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  maxRunningPredictionsComposite: z.number().int().min(0).max(100_000).nullable().optional(),
  maxPredictionsCompositeTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  allowedExchanges: z.array(z.string().trim().min(1).max(32)).max(32).optional(),
  monthlyAiTokens: z.string().trim().regex(/^-?\d+$/).optional(),
  topupAiTokens: z.string().trim().regex(/^-?\d+$/).optional(),
  topupRunningBots: z.number().int().min(0).max(100_000).nullable().optional(),
  topupBotsTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  topupRunningPredictionsAi: z.number().int().min(0).max(100_000).nullable().optional(),
  topupPredictionsAiTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  topupRunningPredictionsComposite: z.number().int().min(0).max(100_000).nullable().optional(),
  topupPredictionsCompositeTotal: z.number().int().min(0).max(100_000).nullable().optional(),
  meta: z.record(z.any()).nullable().optional()
});

const adminBillingAdjustTokensSchema = z.object({
  deltaTokens: z.string().trim().regex(/^-?\d+$/),
  note: z.string().trim().min(1).max(500)
});

const adminBillingFeatureFlagsSchema = z.object({
  billingEnabled: z.boolean().optional(),
  billingWebhookEnabled: z.boolean().optional(),
  aiTokenBillingEnabled: z.boolean().optional()
});

function mapBillingPackageKindToResponse(kind: unknown): "plan" | "ai_topup" | "entitlement_topup" {
  if (kind === "AI_TOPUP") return "ai_topup";
  if (kind === "ENTITLEMENT_TOPUP") return "entitlement_topup";
  return "plan";
}

function mapSubscriptionOrderForResponse(order: any) {
  return {
    id: order.id,
    merchantOrderId: order.merchantOrderId,
    status: String(order.status ?? "PENDING").toLowerCase(),
    amountCents: Number(order.amountCents ?? 0),
    currency: order.currency ?? "USD",
    payUrl: order.payUrl ?? null,
    paymentStatusRaw: order.paymentStatusRaw ?? null,
    paidAt: order.paidAt instanceof Date ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : null,
    package: order.pkg ? {
      id: order.pkg.id,
      code: order.pkg.code,
      name: order.pkg.name,
      kind: mapBillingPackageKindToResponse(order.pkg.kind)
    } : null,
    items: Array.isArray(order.items)
      ? order.items.map((item: any) => ({
          id: item.id,
          quantity: Number(item.quantity ?? 1),
          unitPriceCents: Number(item.unitPriceCents ?? 0),
          lineAmountCents: Number(item.lineAmountCents ?? 0),
          currency: String(item.currency ?? order.currency ?? "USD"),
          kind: mapBillingPackageKindToResponse(item.kindSnapshot ?? item.pkg?.kind),
          package: item.pkg ? {
            id: item.pkg.id,
            code: item.pkg.code,
            name: item.pkg.name,
            kind: mapBillingPackageKindToResponse(item.pkg.kind)
          } : null
        }))
      : []
  };
}

function buildBillingDisabledResponse() {
  return {
    billingEnabled: false,
    plan: "free",
    status: "active",
    proValidUntil: null,
    limits: {
      maxRunningBots: 1,
      maxBotsTotal: 2,
      allowedExchanges: ["*"],
      bots: {
        maxRunning: 1,
        maxTotal: 2
      },
      predictions: {
        local: {
          maxRunning: null,
          maxTotal: null
        },
        ai: {
          maxRunning: null,
          maxTotal: null
        },
        composite: {
          maxRunning: null,
          maxTotal: null
        }
      }
    },
    usage: {
      totalBots: 0,
      runningBots: 0,
      bots: {
        running: 0,
        total: 0
      },
      predictions: {
        local: {
          running: 0,
          total: 0
        },
        ai: {
          running: 0,
          total: 0
        },
        composite: {
          running: 0,
          total: 0
        }
      }
    },
    ai: {
      tokenBalance: "0",
      tokenUsedLifetime: "0",
      monthlyIncluded: "0",
      billingEnabled: false
    },
    packages: [],
    orders: []
  };
}

export type RegisterBillingRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  getBillingFeatureFlagsSettings(): Promise<any>;
  updateBillingFeatureFlags(payload: Record<string, unknown>): Promise<any>;
  listBillingPackages(): Promise<any[]>;
  upsertBillingPackage(payload: Record<string, unknown>): Promise<any>;
  deleteBillingPackage(id: string): Promise<void>;
  getSubscriptionSummary(userId: string): Promise<any>;
  adjustAiTokenBalanceByAdmin(params: { userId: string; deltaTokens: number; note: string; actorUserId: string }): Promise<{ balance: bigint }>;
  isBillingEnabled(): Promise<boolean>;
  listSubscriptionOrders(userId: string): Promise<any[]>;
  createBillingCheckout(params: { userId: string; items: Array<{ packageId: string; quantity: number }> }): Promise<any>;
};

export function registerBillingRoutes(app: express.Express, deps: RegisterBillingRoutesDeps) {
  async function resolveUserIdFromLookup(rawLookup: string): Promise<string | null> {
    const lookup = rawLookup.trim();
    if (!lookup) return null;

    if (lookup.includes("@")) {
      const row = await deps.db.user.findFirst({
        where: {
          email: {
            equals: lookup,
            mode: "insensitive"
          }
        },
        select: { id: true }
      });
      return row?.id ?? null;
    }

    const byId = await deps.db.user.findUnique({
      where: { id: lookup },
      select: { id: true }
    });
    if (byId?.id) return byId.id;

    const byEmail = await deps.db.user.findFirst({
      where: {
        email: {
          equals: lookup,
          mode: "insensitive"
        }
      },
      select: { id: true }
    });
    return byEmail?.id ?? null;
  }

  app.get("/admin/settings/billing", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const settings = await deps.getBillingFeatureFlagsSettings();
    return res.json(settings);
  });

  app.put("/admin/settings/billing", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminBillingFeatureFlagsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const saved = await deps.updateBillingFeatureFlags(parsed.data);
    return res.json(saved);
  });

  app.get("/admin/billing/packages", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const packages = await deps.listBillingPackages();
    return res.json({
      items: packages.map((pkg: any) => ({
        id: pkg.id,
        code: pkg.code,
        name: pkg.name,
        description: pkg.description ?? null,
        kind: mapBillingPackageKindToResponse(pkg.kind),
        isActive: Boolean(pkg.isActive),
        sortOrder: Number(pkg.sortOrder ?? 0),
        currency: String(pkg.currency ?? "USD"),
        priceCents: Number(pkg.priceCents ?? 0),
        billingMonths: Number(pkg.billingMonths ?? 1),
        plan: pkg.plan === "PRO" ? "pro" : pkg.plan === "FREE" ? "free" : null,
        maxRunningBots: pkg.maxRunningBots ?? null,
        maxBotsTotal: pkg.maxBotsTotal ?? null,
        maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
        maxPredictionsAiTotal: pkg.maxPredictionsAiTotal ?? null,
        maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
        maxPredictionsCompositeTotal: pkg.maxPredictionsCompositeTotal ?? null,
        allowedExchanges: Array.isArray(pkg.allowedExchanges) ? pkg.allowedExchanges : ["*"],
        monthlyAiTokens: typeof pkg.monthlyAiTokens === "bigint" ? pkg.monthlyAiTokens.toString() : String(pkg.monthlyAiTokens ?? "0"),
        topupAiTokens: typeof pkg.topupAiTokens === "bigint" ? pkg.topupAiTokens.toString() : String(pkg.topupAiTokens ?? "0"),
        topupRunningBots: pkg.topupRunningBots ?? null,
        topupBotsTotal: pkg.topupBotsTotal ?? null,
        topupRunningPredictionsAi: pkg.topupRunningPredictionsAi ?? null,
        topupPredictionsAiTotal: pkg.topupPredictionsAiTotal ?? null,
        topupRunningPredictionsComposite: pkg.topupRunningPredictionsComposite ?? null,
        topupPredictionsCompositeTotal: pkg.topupPredictionsCompositeTotal ?? null,
        meta: pkg.meta ?? null,
        createdAt: pkg.createdAt instanceof Date ? pkg.createdAt.toISOString() : null,
        updatedAt: pkg.updatedAt instanceof Date ? pkg.updatedAt.toISOString() : null
      }))
    });
  });

  app.post("/admin/billing/packages", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminBillingPackageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    try {
      const saved = await deps.upsertBillingPackage(parsed.data);
      return res.status(201).json({ id: saved.id });
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "P2002") {
        return res.status(409).json({ error: "package_code_exists" });
      }
      return res.status(500).json({ error: "save_failed", reason: String(error) });
    }
  });

  app.put("/admin/billing/packages/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const params = billingPackageIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const parsed = adminBillingPackageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    try {
      await deps.upsertBillingPackage({
        id: params.data.id,
        ...parsed.data
      });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: "save_failed", reason: String(error) });
    }
  });

  app.delete("/admin/billing/packages/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const params = billingPackageIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    try {
      await deps.deleteBillingPackage(params.data.id);
      return res.json({ ok: true });
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "P2025") return res.status(404).json({ error: "not_found" });
      return res.status(500).json({ error: "delete_failed", reason: String(error) });
    }
  });

  app.get("/admin/billing/users/:id/subscription", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const lookup = String(req.params?.id ?? "").trim();
    if (!lookup) return res.status(400).json({ error: "invalid_params" });
    const userId = await resolveUserIdFromLookup(lookup);
    if (!userId) return res.status(404).json({ error: "user_not_found" });
    const summary = await deps.getSubscriptionSummary(userId);
    return res.json(summary);
  });

  app.post("/admin/billing/users/:id/tokens/adjust", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const lookup = String(req.params?.id ?? "").trim();
    if (!lookup) return res.status(400).json({ error: "invalid_params" });
    const userId = await resolveUserIdFromLookup(lookup);
    if (!userId) return res.status(404).json({ error: "user_not_found" });
    const parsed = adminBillingAdjustTokensSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const user = getUserFromLocals(res);
    const result = await deps.adjustAiTokenBalanceByAdmin({
      userId,
      deltaTokens: Number.parseInt(parsed.data.deltaTokens, 10),
      note: parsed.data.note,
      actorUserId: user.id
    });
    return res.json({
      ok: true,
      balance: result.balance.toString()
    });
  });

  app.get("/settings/subscription", requireAuth, async (_req, res) => {
    try {
      const user = getUserFromLocals(res);
      if (!(await deps.isBillingEnabled())) {
        return res.json(buildBillingDisabledResponse());
      }

      const summary = await deps.getSubscriptionSummary(user.id);
      return res.json({
        billingEnabled: true,
        ...summary,
        packages: summary.packages.map((pkg: any) => ({
          id: pkg.id,
          code: pkg.code,
          name: pkg.name,
          description: pkg.description ?? null,
          kind: mapBillingPackageKindToResponse(pkg.kind),
          isActive: Boolean(pkg.isActive),
          sortOrder: Number(pkg.sortOrder ?? 0),
          currency: String(pkg.currency ?? "USD"),
          priceCents: Number(pkg.priceCents ?? 0),
          billingMonths: Number(pkg.billingMonths ?? 1),
          plan: pkg.plan === "PRO" ? "pro" : pkg.plan === "FREE" ? "free" : null,
          maxRunningBots: pkg.maxRunningBots ?? null,
          maxBotsTotal: pkg.maxBotsTotal ?? null,
          maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
          maxPredictionsAiTotal: pkg.maxPredictionsAiTotal ?? null,
          maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
          maxPredictionsCompositeTotal: pkg.maxPredictionsCompositeTotal ?? null,
          allowedExchanges: Array.isArray(pkg.allowedExchanges) ? pkg.allowedExchanges : ["*"],
          monthlyAiTokens:
            typeof pkg.monthlyAiTokens === "bigint"
              ? pkg.monthlyAiTokens.toString()
              : String(pkg.monthlyAiTokens ?? "0"),
          topupAiTokens:
            typeof pkg.topupAiTokens === "bigint"
              ? pkg.topupAiTokens.toString()
              : String(pkg.topupAiTokens ?? "0"),
          topupRunningBots: pkg.topupRunningBots ?? null,
          topupBotsTotal: pkg.topupBotsTotal ?? null,
          topupRunningPredictionsAi: pkg.topupRunningPredictionsAi ?? null,
          topupPredictionsAiTotal: pkg.topupPredictionsAiTotal ?? null,
          topupRunningPredictionsComposite: pkg.topupRunningPredictionsComposite ?? null,
          topupPredictionsCompositeTotal: pkg.topupPredictionsCompositeTotal ?? null
        })),
        orders: summary.orders.map((order: any) => mapSubscriptionOrderForResponse(order))
      });
    } catch (error) {
      console.error("[billing] settings subscription endpoint failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.json({
        ...buildBillingDisabledResponse(),
        fallbackReason: "subscription_unavailable"
      });
    }
  });

  app.get("/settings/subscription/orders", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const items = await deps.listSubscriptionOrders(user.id);
    return res.json({
      items: items.map((order: any) => mapSubscriptionOrderForResponse(order))
    });
  });

  app.post("/settings/subscription/checkout", requireAuth, async (req, res) => {
    if (!(await deps.isBillingEnabled())) {
      return res.status(503).json({ error: "billing_disabled" });
    }
    const user = getUserFromLocals(res);
    const parsed = subscriptionCheckoutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const checkoutItems =
      "packageId" in parsed.data
        ? [{ packageId: parsed.data.packageId, quantity: 1 }]
        : parsed.data.items.map((item) => ({
            packageId: item.packageId,
            quantity: item.quantity
          }));

    try {
      const checkout = await deps.createBillingCheckout({
        userId: user.id,
        items: checkoutItems
      });
      return res.json({
        payUrl: checkout.payUrl,
        mode: checkout.mode,
        orderId: checkout.order.id,
        merchantOrderId: checkout.order.merchantOrderId
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (
        reason === "invalid_cart_payload"
        || reason === "cart_empty"
        || reason === "cart_plan_count_invalid"
        || reason === "cart_duplicate_package"
        || reason === "cart_quantity_invalid"
      ) {
        return res.status(400).json({ error: reason });
      }
      if (reason === "cart_item_not_found" || reason === "package_not_found") {
        return res.status(404).json({ error: reason === "package_not_found" ? "cart_item_not_found" : reason });
      }
      if (reason === "cart_capacity_requires_pro") {
        return res.status(409).json({ error: "cart_capacity_requires_pro" });
      }
      if (reason === "pro_required_for_topup") {
        return res.status(409).json({ error: "pro_required_for_topup" });
      }
      if (reason === "paid_plan_required_for_capacity_topup") {
        return res.status(409).json({ error: "paid_plan_required_for_capacity_topup" });
      }
      if (reason === "ccpay_not_configured") {
        return res.status(503).json({ error: "ccpay_not_configured" });
      }
      if (reason.startsWith("ccpayment_error")) {
        return res.status(502).json({ error: "ccpayment_error", reason });
      }
      return res.status(502).json({ error: "checkout_failed", reason });
    }
  });
}

import express, { type NextFunction } from "express";
import { z } from "zod";
import {
  getDefaultPlanCapabilities,
  resolveProductFeatureGates,
  type PlanCapabilities,
  type PlanTier
} from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";

const subscriptionCheckoutSchema = z.union([
  z.object({
    packageId: z.string().trim().min(1).max(191),
    applyUliqDiscount: z.boolean().optional()
  }),
  z.object({
    items: z.array(z.object({
      packageId: z.string().trim().min(1).max(191),
      quantity: z.number().int().min(1).max(100)
    })).min(1).max(20),
    applyUliqDiscount: z.boolean().optional()
  })
]);

const billingPackageIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const billingOrderIdParamSchema = z.object({
  id: z.string().trim().min(1).max(191)
});

const billingTransactionSubmitSchema = z.object({
  txHash: z.string().trim().regex(/^0x[a-fA-F0-9]{64}$/)
});

const subscriptionNotificationPreferenceSchema = z.object({
  channel: z.enum(["email", "telegram", "both"]),
  locale: z.enum(["de", "en"])
});

const adminBillingPaymentConfigurationSchema = z.object({
  treasuryAddress: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/),
  confirmTreasuryAddress: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/)
}).superRefine((value, ctx) => {
  if (value.treasuryAddress !== value.confirmTreasuryAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmTreasuryAddress"],
      message: "Treasury addresses must match exactly"
    });
  }
});

const BILLING_DB_BIGINT_MIN = -(2n ** 63n);
const BILLING_DB_BIGINT_MAX = (2n ** 63n) - 1n;
const canonicalIntegerStringSchema = z.string().trim().regex(/^(?:0|[1-9]\d*|-[1-9]\d*)$/);
const safeIntegerNumberSchema = z.number().int().refine(Number.isSafeInteger, {
  message: "Integer number must be within JavaScript's safe range; use a decimal string otherwise"
});
const dbBigIntStringOrNumberSchema = z.union([
  canonicalIntegerStringSchema,
  safeIntegerNumberSchema
]).transform((value) => (typeof value === "number" ? String(value) : value)).refine((value) => {
  const parsed = BigInt(value);
  return parsed >= BILLING_DB_BIGINT_MIN && parsed <= BILLING_DB_BIGINT_MAX;
}, { message: "Integer is outside the signed 64-bit database range" });
const nonNegativeDbBigIntSchema = dbBigIntStringOrNumberSchema.refine(
  (value) => BigInt(value) >= 0n,
  { message: "Integer must be non-negative" }
);

const billingAddonTypeSchema = z.enum([
  "running_bots",
  "running_predictions_ai",
  "running_predictions_composite",
  "ai_credits"
]);

export const adminBillingPackageSchema = z.object({
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(["plan", "addon"]),
  addonType: billingAddonTypeSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  billingMonths: z.number().int().min(1).max(36).optional(),
  plan: z.enum(["free", "pro"]).nullable().optional(),
  maxRunningBots: z.number().int().min(0).max(100_000).nullable().optional(),
  maxRunningPredictionsAi: z.number().int().min(0).max(100_000).nullable().optional(),
  maxRunningPredictionsComposite: z.number().int().min(0).max(100_000).nullable().optional(),
  allowedExchanges: z.array(z.string().trim().min(1).max(32)).max(32).optional(),
  monthlyAiCredits: nonNegativeDbBigIntSchema.optional(),
  aiCredits: nonNegativeDbBigIntSchema.optional(),
  deltaRunningBots: z.number().int().min(0).max(100_000).nullable().optional(),
  deltaRunningPredictionsAi: z.number().int().min(0).max(100_000).nullable().optional(),
  deltaRunningPredictionsComposite: z.number().int().min(0).max(100_000).nullable().optional(),
  meta: z.record(z.any()).nullable().optional()
}).superRefine((value, ctx) => {
  if (value.kind === "plan" && value.addonType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addonType"], message: "addonType is only valid for add-ons" });
  }
  if (value.kind === "addon" && !value.addonType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addonType"], message: "addonType is required for add-ons" });
  }
  if (value.kind === "plan" && !value.plan) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["plan"], message: "plan is required for plans" });
  }
  const active = value.isActive !== false;
  if (active && value.priceCents < 1 && !(value.kind === "plan" && value.plan === "free")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceCents"], message: "active purchasable packages require a positive price" });
  }
  if (active && value.kind === "addon") {
    const entitlement = value.addonType === "ai_credits"
      ? value.aiCredits === undefined ? null : BigInt(value.aiCredits)
      : value.addonType === "running_bots"
        ? value.deltaRunningBots
        : value.addonType === "running_predictions_ai"
          ? value.deltaRunningPredictionsAi
          : value.addonType === "running_predictions_composite"
            ? value.deltaRunningPredictionsComposite
            : null;
    if (entitlement !== null && entitlement !== undefined && entitlement <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addonType"], message: "active add-ons require a positive entitlement" });
    }
  }
});

export const adminBillingAdjustCreditsSchema = z.object({
  deltaCredits: dbBigIntStringOrNumberSchema,
  note: z.string().trim().min(1).max(500)
});

const adminBillingFeatureFlagsSchema = z.object({
  billingEnabled: z.boolean().optional(),
  aiCreditBillingEnabled: z.boolean().optional()
});

function mapBillingPackageKindToResponse(kind: unknown): "plan" | "addon" {
  if (kind === "PLAN") return "plan";
  return "addon";
}

function mapBillingAddonTypeToResponse(pkg: any): "running_bots" | "running_predictions_ai" | "running_predictions_composite" | "ai_credits" | null {
  const direct = pkg?.addonType;
  if (direct === "running_bots") return "running_bots";
  if (direct === "running_predictions_ai") return "running_predictions_ai";
  if (direct === "running_predictions_composite") return "running_predictions_composite";
  if (direct === "ai_credits") return "ai_credits";
  if (direct === "RUNNING_BOTS") return "running_bots";
  if (direct === "RUNNING_PREDICTIONS_AI") return "running_predictions_ai";
  if (direct === "RUNNING_PREDICTIONS_COMPOSITE") return "running_predictions_composite";
  if (direct === "AI_CREDITS") return "ai_credits";
  const meta = pkg && typeof pkg.meta === "object" && pkg.meta ? pkg.meta as Record<string, unknown> : {};
  const explicit = meta.billingAddonType;
  if (
    explicit === "running_bots"
    || explicit === "running_predictions_ai"
    || explicit === "running_predictions_composite"
    || explicit === "ai_credits"
  ) {
    return explicit;
  }
  if (pkg?.kind !== "ADDON") return null;
  if (Number(pkg?.aiCredits ?? 0) > 0) return "ai_credits";
  if (Number(pkg?.deltaRunningBots ?? 0) > 0) return "running_bots";
  if (Number(pkg?.deltaRunningPredictionsAi ?? 0) > 0) return "running_predictions_ai";
  if (Number(pkg?.deltaRunningPredictionsComposite ?? 0) > 0) return "running_predictions_composite";
  return null;
}

function formatRawTokenAmount(value: unknown, decimals: number): string | null {
  try {
    const amount = BigInt(String(value));
    const precision = Math.max(0, Math.min(36, Math.trunc(decimals)));
    if (precision === 0) return amount.toString();
    const padded = amount.toString().padStart(precision + 1, "0");
    const whole = padded.slice(0, -precision) || "0";
    const fraction = padded.slice(-precision).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
  } catch {
    return null;
  }
}

function toIsoDateString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function mapSubscriptionOrderForResponse(input: any) {
  const order = input?.order ?? input;
  const payment = order?.onchainPayment || input?.payment
    ? { ...(order?.onchainPayment ?? {}), ...(input?.payment ?? {}) }
    : null;
  const term = order.subscriptionTerm ?? null;
  const txHash = typeof payment?.txHash === "string" ? payment.txHash : null;
  const recipientAddress = payment?.treasuryAddress ?? payment?.recipientAddress ?? null;
  const amountRaw = payment?.expectedAmountRaw ?? payment?.amountRaw;
  const tokenDecimals = Number(payment?.tokenDecimals ?? 6);
  return {
    id: order.id,
    merchantOrderId: order.merchantOrderId,
    status: String(order.status ?? "PENDING").toLowerCase(),
    amountCents: Number(order.amountCents ?? 0),
    currency: "USD",
    paymentStatusRaw: order.paymentStatusRaw ?? null,
    paidAt: toIsoDateString(order.paidAt),
    expiresAt: toIsoDateString(order.expiresAt),
    createdAt: toIsoDateString(order.createdAt),
    uliqBenefit: order.uliqBenefitReservation ? {
      reservationId: order.uliqBenefitReservation.id,
      tier: order.uliqTierSnapshot,
      discountBps: order.uliqDiscountBps,
      baseAmountCents: order.baseAmountCents,
      discountAmountCents: order.discountAmountCents,
      finalAmountCents: order.finalAmountCents,
      expiresAt: toIsoDateString(order.uliqBenefitReservation.expiresAt)
    } : null,
    explorerUrl: payment?.explorerUrl ?? (txHash ? `https://arbiscan.io/tx/${txHash}` : null),
    onchainPayment: payment ? {
      chainId: Number(payment.chainId),
      tokenAddress: payment.tokenAddress,
      tokenDecimals,
      expectedSenderAddress: payment.expectedSenderAddress,
      recipientAddress,
      treasuryAddress: recipientAddress,
      treasuryConfigRevision: Number(payment.treasuryConfigRevision ?? 0),
      amountRaw: String(amountRaw),
      amountFormatted: payment.amountFormatted ?? formatRawTokenAmount(amountRaw, tokenDecimals),
      txHash,
      blockNumber: payment.blockNumber === null || payment.blockNumber === undefined
        ? null
        : String(payment.blockNumber),
      blockHash: payment.blockHash ?? null,
      confirmations: Number(payment.confirmations ?? 0),
      confirmationsRequired: Number(payment.confirmationsRequired ?? 12),
      requiredConfirmations: Number(payment.confirmationsRequired ?? 12),
      expiresAt: payment.expiresAt ?? (
        order.expiresAt instanceof Date ? order.expiresAt.toISOString() : order.expiresAt ?? null
      ),
      explorerUrl: payment.explorerUrl ?? (txHash ? `https://arbiscan.io/tx/${txHash}` : null),
      lastCheckedAt: toIsoDateString(payment.lastCheckedAt),
      lastError: payment.lastError ?? null,
      verifiedAt: toIsoDateString(payment.verifiedAt)
    } : null,
    subscriptionTerm: term ? {
      id: term.id,
      status: String(term.status ?? "SCHEDULED").toLowerCase(),
      startsAt: toIsoDateString(term.startsAt),
      endsAt: toIsoDateString(term.endsAt),
      graceEndsAt: toIsoDateString(term.graceEndsAt)
    } : null,
    package: order.pkg ? {
      id: order.pkg.id,
      code: order.pkg.code,
      name: order.pkg.name,
      kind: mapBillingPackageKindToResponse(order.pkg.kind),
      addonType: mapBillingAddonTypeToResponse(order.pkg)
    } : null,
    items: Array.isArray(order.items)
      ? order.items.map((item: any) => ({
          id: item.id,
          quantity: Number(item.quantity ?? 1),
          unitPriceCents: Number(item.unitPriceCents ?? 0),
          lineAmountCents: Number(item.lineAmountCents ?? 0),
          currency: "USD",
          kind: mapBillingPackageKindToResponse(item.kindSnapshot ?? item.pkg?.kind),
          addonType: mapBillingAddonTypeToResponse(item.pkg ?? item.packageSnapshot ?? null),
          package: item.pkg ? {
            id: item.pkg.id,
            code: item.pkg.code,
            name: item.pkg.name,
            kind: mapBillingPackageKindToResponse(item.pkg.kind),
            addonType: mapBillingAddonTypeToResponse(item.pkg)
          } : null
        }))
      : []
  };
}

function buildBillingDisabledResponse() {
  const plan = "free" as const;
  const capabilities = getDefaultPlanCapabilities(plan);
  return {
    billingEnabled: false,
    plan,
    status: "active",
    proValidUntil: null,
    capabilities,
    featureGates: resolveProductFeatureGates({
      plan,
      capabilities
    }),
    limits: {
      maxRunningBots: 1,
      allowedExchanges: ["*"],
      bots: {
        maxRunning: 1
      },
      predictions: {
        local: {
          maxRunning: null
        },
        ai: {
          maxRunning: null
        },
        composite: {
          maxRunning: null
        }
      }
    },
    usage: {
      runningBots: 0,
      bots: {
        running: 0
      },
      predictions: {
        local: {
          running: 0
        },
        ai: {
          running: 0
        },
        composite: {
          running: 0
        }
      }
    },
    ai: {
      creditBalance: "0",
      creditsUsedLifetime: "0",
      monthlyIncludedCredits: "0",
      billingEnabled: false
    },
    packages: [],
    orders: []
  };
}

export type RegisterBillingRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  requirePlatformSuperadmin(res: express.Response): Promise<boolean>;
  consumeRecentReauth: express.RequestHandler;
  getBillingFeatureFlagsSettings(): Promise<any>;
  updateBillingFeatureFlags(payload: Record<string, unknown>): Promise<any>;
  listBillingPackages(): Promise<any[]>;
  upsertBillingPackage(payload: Record<string, unknown>): Promise<any>;
  deleteBillingPackage(id: string): Promise<void>;
  getSubscriptionSummary(userId: string): Promise<any>;
  resolvePlanCapabilitiesForUserId(input: {
    userId: string;
  }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  adjustAiCreditBalanceByAdmin(params: { userId: string; deltaCredits: string; note: string; actorUserId: string }): Promise<{ balance: bigint }>;
  isBillingEnabled(): Promise<boolean>;
  listSubscriptionOrders(userId: string): Promise<any[]>;
  createBillingCheckout(params: {
    userId: string;
    items: Array<{ packageId: string; quantity: number }>;
    applyUliqDiscount?: boolean;
  }): Promise<any>;
  getBillingOrderForUser(userId: string, orderId: string): Promise<any>;
  cancelBillingOrder(params: { userId: string; orderId: string }): Promise<any>;
  submitBillingTransaction(params: { userId: string; orderId: string; txHash: string }): Promise<any>;
  reconcileBillingOrderPayment(params: { userId: string; orderId: string }): Promise<any>;
  getSubscriptionNotificationPreference(userId: string): Promise<any>;
  updateSubscriptionNotificationPreference(params: {
    userId: string;
    channel: "EMAIL" | "TELEGRAM" | "BOTH";
    locale: "de" | "en";
  }): Promise<any>;
  getArbitrumUsdcPaymentReadiness(): Promise<any>;
  updateArbitrumUsdcPaymentConfiguration(params: {
    treasuryAddress: string;
    actorUserId: string;
    ip: string | null;
  }): Promise<any>;
};

function mapCheckoutPayment(checkout: any) {
  const payment = checkout?.payment ?? checkout?.order?.onchainPayment ?? null;
  if (!payment) return null;
  const recipientAddress = payment.recipientAddress ?? payment.treasuryAddress;
  return {
    chainId: Number(payment.chainId),
    tokenAddress: payment.tokenAddress,
    tokenDecimals: Number(payment.tokenDecimals),
    expectedSenderAddress: payment.expectedSenderAddress ?? null,
    recipientAddress,
    treasuryAddress: recipientAddress,
    amountRaw: String(payment.amountRaw ?? payment.expectedAmountRaw),
    amountFormatted: String(payment.amountFormatted ?? ""),
    expiresAt:
      payment.expiresAt instanceof Date
        ? payment.expiresAt.toISOString()
        : payment.expiresAt ?? (
          checkout?.order?.expiresAt instanceof Date
            ? checkout.order.expiresAt.toISOString()
            : checkout?.order?.expiresAt ?? null
        )
  };
}

function mapNotificationPreference(value: any) {
  return {
    channel: String(value?.channel ?? "EMAIL").toLowerCase(),
    locale: value?.locale === "en" ? "en" : "de",
    source: value?.source === "stored" ? "stored" : "default",
    emailAvailable: Boolean(value?.emailAvailable),
    telegramAvailable: Boolean(value?.telegramAvailable)
  };
}

function mapBillingRouteError(error: unknown): { status: number; body: Record<string, unknown> } {
  const reason = error instanceof Error ? error.message : String(error);
  if (
    reason === "invalid_cart_payload"
    || reason === "cart_empty"
    || reason === "cart_plan_count_invalid"
    || reason === "cart_duplicate_package"
    || reason === "cart_quantity_invalid"
    || reason === "cart_total_out_of_range"
    || reason === "cart_zero_amount_not_supported"
    || reason === "cart_free_plan_not_purchasable"
    || reason === "package_active_price_required"
    || reason === "package_addon_type_required"
    || reason === "package_addon_value_required"
    || reason === "package_plan_required"
    || reason === "invalid_transaction_hash"
    || reason === "uliq_invalid_base_amount"
  ) {
    return { status: 400, body: { error: reason } };
  }
  if (reason === "cart_item_not_found" || reason === "package_not_found" || reason === "order_not_found") {
    return {
      status: 404,
      body: { error: reason === "package_not_found" ? "cart_item_not_found" : reason }
    };
  }
  if (
    reason === "cart_capacity_requires_pro"
    || reason === "pro_required_for_topup"
    || reason === "paid_plan_required_for_capacity_topup"
    || reason === "open_order_cart_mismatch"
    || reason === "open_order_exists"
    || reason === "order_not_payable"
    || reason === "order_expired"
    || reason === "order_not_cancellable"
    || reason === "transaction_hash_in_use"
    || reason === "transaction_hash_mismatch"
    || reason === "review_required"
  ) {
    return { status: 409, body: { error: reason } };
  }
  if (reason === "wallet_not_linked" || reason === "wallet_mismatch") {
    return { status: 422, body: { error: reason } };
  }
  if (
    reason === "uliq_wallet_changed"
    || reason === "uliq_entitlement_invalid"
    || reason === "uliq_entitlement_expired"
    || reason === "uliq_reservation_expired"
  ) {
    return { status: 409, body: { error: reason } };
  }
  if (reason === "notification_email_unavailable" || reason === "notification_telegram_unavailable") {
    return { status: 422, body: { error: reason } };
  }
  if (reason === "billing_disabled" || reason === "payment_config_not_ready" || reason === "billing_payment_not_configured") {
    return { status: 503, body: { error: reason } };
  }
  if (reason === "uliq_discounts_disabled" || reason === "uliq_price_degraded") {
    return { status: 503, body: { error: reason } };
  }
  if (reason === "rpc_unavailable" || reason === "billing_rpc_unavailable") {
    return { status: 503, body: { error: "rpc_unavailable", retryable: true } };
  }
  return { status: 500, body: { error: "billing_request_failed", reason } };
}

export function registerBillingRoutes(app: express.Express, deps: RegisterBillingRoutesDeps) {
  const requirePlatformSuperadminMiddleware = async (
    _req: express.Request,
    res: express.Response,
    next: NextFunction
  ) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    next();
  };

  const validatePaymentConfigurationMiddleware = (
    req: express.Request,
    res: express.Response,
    next: NextFunction
  ) => {
    const parsed = adminBillingPaymentConfigurationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    res.locals.billingPaymentConfigurationPayload = parsed.data;
    next();
  };

  const authorizeBillingEnableMiddleware = async (
    req: express.Request,
    res: express.Response,
    next: NextFunction
  ) => {
    const parsed = adminBillingFeatureFlagsSchema.safeParse(req.body ?? {});
    if (!parsed.success || parsed.data.billingEnabled !== true) return next();
    try {
      if (!(await deps.requirePlatformSuperadmin(res))) return;
    } catch {
      return res.status(503).json({ error: "billing_enable_authorization_unavailable" });
    }
    return deps.consumeRecentReauth(req, res, next);
  };

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

  app.put("/admin/settings/billing", requireAuth, authorizeBillingEnableMiddleware, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminBillingFeatureFlagsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    try {
      const saved = await deps.updateBillingFeatureFlags(parsed.data);
      return res.json(saved);
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/admin/billing/payment-config", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const readiness = await deps.getArbitrumUsdcPaymentReadiness();
    return res.json(readiness);
  });

  app.put(
    "/admin/billing/payment-config",
    requireAuth,
    requirePlatformSuperadminMiddleware,
    validatePaymentConfigurationMiddleware,
    deps.consumeRecentReauth,
    async (req, res) => {
      const payload = res.locals.billingPaymentConfigurationPayload as z.infer<
        typeof adminBillingPaymentConfigurationSchema
      >;
      const actor = getUserFromLocals(res);
      try {
        await deps.updateArbitrumUsdcPaymentConfiguration({
          treasuryAddress: payload.treasuryAddress,
          actorUserId: actor.id,
          ip: typeof req.ip === "string" && req.ip.trim() ? req.ip.trim().slice(0, 191) : null
        });
        const readiness = await deps.getArbitrumUsdcPaymentReadiness();
        return res.json(readiness);
      } catch (error) {
        const mapped = mapBillingRouteError(error);
        if ((error instanceof Error ? error.message : String(error)) === "invalid_treasury_address") {
          return res.status(400).json({ error: "invalid_treasury_address" });
        }
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );

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
        addonType: mapBillingAddonTypeToResponse(pkg),
        isActive: Boolean(pkg.isActive),
        sortOrder: Number(pkg.sortOrder ?? 0),
        priceCents: Number(pkg.priceCents ?? 0),
        billingMonths: Number(pkg.billingMonths ?? 1),
        plan: pkg.plan === "PRO" ? "pro" : pkg.plan === "FREE" ? "free" : null,
        maxRunningBots: pkg.maxRunningBots ?? null,
        maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
        maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
        allowedExchanges: Array.isArray(pkg.allowedExchanges) ? pkg.allowedExchanges : ["*"],
        monthlyAiCredits: typeof pkg.monthlyAiCredits === "bigint" ? pkg.monthlyAiCredits.toString() : String(pkg.monthlyAiCredits ?? "0"),
        aiCredits: typeof pkg.aiCredits === "bigint" ? pkg.aiCredits.toString() : String(pkg.aiCredits ?? "0"),
        deltaRunningBots: pkg.deltaRunningBots ?? null,
        deltaRunningPredictionsAi: pkg.deltaRunningPredictionsAi ?? null,
        deltaRunningPredictionsComposite: pkg.deltaRunningPredictionsComposite ?? null,
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
      const saved = await deps.upsertBillingPackage({
        ...parsed.data,
        monthlyAiCredits: parsed.data.monthlyAiCredits ?? "0",
        aiCredits: parsed.data.aiCredits ?? "0"
      });
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

  app.post("/admin/billing/users/:id/credits/adjust", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const lookup = String(req.params?.id ?? "").trim();
    if (!lookup) return res.status(400).json({ error: "invalid_params" });
    const userId = await resolveUserIdFromLookup(lookup);
    if (!userId) return res.status(404).json({ error: "user_not_found" });
    const parsed = adminBillingAdjustCreditsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const user = getUserFromLocals(res);
    const result = await deps.adjustAiCreditBalanceByAdmin({
      userId,
      deltaCredits: parsed.data.deltaCredits,
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
      const billingEnabled = await deps.isBillingEnabled();
      const summary = await deps.getSubscriptionSummary(user.id);
      const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
        userId: user.id
      });
      return res.json({
        billingEnabled,
        ...summary,
        capabilities: capabilityContext.capabilities,
        featureGates: resolveProductFeatureGates({
          plan: capabilityContext.plan,
          capabilities: capabilityContext.capabilities as any
        }),
        packages: summary.packages.map((pkg: any) => ({
          id: pkg.id,
          code: pkg.code,
          name: pkg.name,
          description: pkg.description ?? null,
          kind: mapBillingPackageKindToResponse(pkg.kind),
          addonType: mapBillingAddonTypeToResponse(pkg),
          isActive: Boolean(pkg.isActive),
          sortOrder: Number(pkg.sortOrder ?? 0),
          priceCents: Number(pkg.priceCents ?? 0),
          billingMonths: Number(pkg.billingMonths ?? 1),
          plan: pkg.plan === "PRO" ? "pro" : pkg.plan === "FREE" ? "free" : null,
          maxRunningBots: pkg.maxRunningBots ?? null,
          maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
          maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
          allowedExchanges: Array.isArray(pkg.allowedExchanges) ? pkg.allowedExchanges : ["*"],
          monthlyAiCredits:
            typeof pkg.monthlyAiCredits === "bigint"
              ? pkg.monthlyAiCredits.toString()
              : String(pkg.monthlyAiCredits ?? "0"),
          aiCredits:
            typeof pkg.aiCredits === "bigint"
              ? pkg.aiCredits.toString()
              : String(pkg.aiCredits ?? "0"),
          deltaRunningBots: pkg.deltaRunningBots ?? null,
          deltaRunningPredictionsAi: pkg.deltaRunningPredictionsAi ?? null,
          deltaRunningPredictionsComposite: pkg.deltaRunningPredictionsComposite ?? null
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
        : ("items" in parsed.data ? parsed.data.items : []).map((item) => ({
            packageId: item.packageId,
            quantity: item.quantity
          }));

    try {
      const checkout = await deps.createBillingCheckout({
        userId: user.id,
        items: checkoutItems,
        applyUliqDiscount: parsed.data.applyUliqDiscount === true
      });
      const payment = mapCheckoutPayment(checkout);
      return res.json({
        mode: checkout.mode,
        orderId: checkout.order.id,
        merchantOrderId: checkout.order.merchantOrderId,
        status: String(checkout.order.status ?? "PENDING").toLowerCase(),
        expiresAt:
          checkout.order.expiresAt instanceof Date
            ? checkout.order.expiresAt.toISOString()
            : checkout.order.expiresAt ?? null,
        payment,
        uliqBenefit: checkout.order.uliqBenefitReservation ? {
          reservationId: checkout.order.uliqBenefitReservation.id,
          tier: checkout.order.uliqTierSnapshot,
          discountBps: checkout.order.uliqDiscountBps,
          baseAmountCents: checkout.order.baseAmountCents,
          discountAmountCents: checkout.order.discountAmountCents,
          finalAmountCents: checkout.order.finalAmountCents,
          expiresAt: checkout.order.uliqBenefitReservation.expiresAt instanceof Date
            ? checkout.order.uliqBenefitReservation.expiresAt.toISOString()
            : checkout.order.uliqBenefitReservation.expiresAt
        } : null
      });
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/settings/subscription/orders/:id", requireAuth, async (req, res) => {
    const params = billingOrderIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    try {
      const user = getUserFromLocals(res);
      const order = await deps.getBillingOrderForUser(user.id, params.data.id);
      if (!order) return res.status(404).json({ error: "order_not_found" });
      return res.json(mapSubscriptionOrderForResponse(order));
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/settings/subscription/orders/:id/submit", requireAuth, async (req, res) => {
    const params = billingOrderIdParamSchema.safeParse(req.params ?? {});
    const payload = billingTransactionSubmitSchema.safeParse(req.body ?? {});
    if (!params.success || !payload.success) {
      const details = !params.success
        ? params.error.flatten()
        : !payload.success
          ? payload.error.flatten()
          : undefined;
      return res.status(400).json({
        error: "invalid_payload",
        details
      });
    }
    try {
      const user = getUserFromLocals(res);
      const order = await deps.submitBillingTransaction({
        userId: user.id,
        orderId: params.data.id,
        txHash: payload.data.txHash
      });
      return res.status(202).json(mapSubscriptionOrderForResponse(order));
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/settings/subscription/orders/:id/cancel", requireAuth, async (req, res) => {
    const params = billingOrderIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    try {
      const user = getUserFromLocals(res);
      const order = await deps.cancelBillingOrder({ userId: user.id, orderId: params.data.id });
      return res.json(mapSubscriptionOrderForResponse(order));
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/settings/subscription/orders/:id/reconcile", requireAuth, async (req, res) => {
    const params = billingOrderIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    try {
      const user = getUserFromLocals(res);
      const order = await deps.reconcileBillingOrderPayment({
        userId: user.id,
        orderId: params.data.id
      });
      return res.json(mapSubscriptionOrderForResponse(order));
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/settings/subscription/notifications", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const preference = await deps.getSubscriptionNotificationPreference(user.id);
    return res.json(mapNotificationPreference(preference));
  });

  app.put("/settings/subscription/notifications", requireAuth, async (req, res) => {
    const parsed = subscriptionNotificationPreferenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const user = getUserFromLocals(res);
    try {
      const preference = await deps.updateSubscriptionNotificationPreference({
        userId: user.id,
        channel: parsed.data.channel.toUpperCase() as "EMAIL" | "TELEGRAM" | "BOTH",
        locale: parsed.data.locale
      });
      return res.json(mapNotificationPreference(preference));
    } catch (error) {
      const mapped = mapBillingRouteError(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });
}

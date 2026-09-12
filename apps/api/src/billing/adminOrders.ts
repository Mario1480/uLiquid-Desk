import type express from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../auth.js";

const utcDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const adminOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).optional(),
  status: z.enum(["PENDING", "CONFIRMING", "PAID", "FAILED", "EXPIRED", "REVIEW_REQUIRED"]).optional(),
  provider: z.enum(["ARBITRUM_USDC", "CCPAYMENT"]).optional(),
  from: utcDate.optional(),
  to: utcDate.optional()
}).refine(value => !value.from || !value.to || value.from <= value.to, {
  message: "Date range must be ordered", path: ["to"]
});

export function buildAdminOrdersWhere(query: z.infer<typeof adminOrdersQuerySchema>): Prisma.BillingOrderWhereInput {
  const { search, status, provider, from, to } = query;
  return {
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
    ...(from || to ? { createdAt: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {})
    } } : {}),
    ...(search ? { OR: [
      { id: { contains: search, mode: "insensitive" } },
      { merchantOrderId: { contains: search, mode: "insensitive" } },
      { userId: { equals: search } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { onchainPayment: { txHash: { contains: search, mode: "insensitive" } } }
    ] } : {})
  };
}

const catalogSelect = { name: true, code: true, kind: true } as const;
export const adminOrderSelect = {
  id: true, merchantOrderId: true, provider: true, status: true,
  createdAt: true, updatedAt: true, paidAt: true, expiresAt: true,
  amountCents: true, currency: true, baseAmountCents: true,
  discountAmountCents: true, finalAmountCents: true, paymentStatusRaw: true,
  user: { select: { id: true, email: true } },
  pkg: { select: catalogSelect },
  items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
    id: true, quantity: true, kindSnapshot: true, packageSnapshot: true,
    unitPriceCents: true, lineAmountCents: true, currency: true,
    discountAmountCents: true, finalAmountCents: true, pkg: { select: catalogSelect }
  } },
  onchainPayment: { select: {
    chainId: true, txHash: true, verifiedAt: true, confirmations: true,
    expectedAmountRaw: true, tokenDecimals: true, tokenAddress: true,
    expectedSenderAddress: true, treasuryAddress: true, treasuryConfigRevision: true,
    blockNumber: true, blockHash: true, verificationAttempts: true,
    lastCheckedAt: true, nextRetryAt: true, discoveredAt: true
  } },
  subscriptionTerm: { select: {
    id: true, plan: true, status: true, startsAt: true, endsAt: true,
    graceEndsAt: true, activatedAt: true, expiredAt: true
  } },
  subscription: { select: {
    id: true, entitlementSyncPending: true, entitlementSyncAttempts: true, entitlementSyncedAt: true
  } },
  _count: { select: { capacityGrants: true, creditLedger: true } }
} satisfies Prisma.BillingOrderSelect;

type OrderRow = Prisma.BillingOrderGetPayload<{ select: typeof adminOrderSelect }>;
const iso = (date: Date | null) => date?.toISOString() ?? null;
const record = (value: Prisma.JsonValue): Prisma.JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function mapAdminOrder(row: OrderRow) {
  const payment = row.onchainPayment;
  const term = row.subscriptionTerm;
  const subscription = row.subscription;
  const items = row.items.map(item => {
    const snapshot = record(item.packageSnapshot);
    const hasSnapshotName = typeof snapshot.name === "string" && snapshot.name.length > 0;
    return {
      id: item.id, name: hasSnapshotName ? String(snapshot.name) : item.pkg.name,
      code: typeof snapshot.code === "string" ? snapshot.code : item.pkg.code,
      catalogFallback: !hasSnapshotName, kind: item.kindSnapshot,
      quantity: item.quantity, unitPriceCents: item.unitPriceCents,
      lineAmountCents: item.lineAmountCents, discountAmountCents: item.discountAmountCents,
      finalAmountCents: item.finalAmountCents, currency: item.currency
    };
  });
  if (!items.length) items.push({
    id: row.id, name: row.pkg.name, code: row.pkg.code, catalogFallback: true,
    kind: row.pkg.kind, quantity: 1, unitPriceCents: row.amountCents,
    lineAmountCents: row.amountCents, discountAmountCents: row.discountAmountCents,
    finalAmountCents: row.finalAmountCents, currency: row.currency
  });
  return {
    id: row.id, merchantOrderId: row.merchantOrderId, provider: row.provider,
    status: row.status, paymentStatusRaw: row.paymentStatusRaw,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), paidAt: iso(row.paidAt), expiresAt: iso(row.expiresAt),
    user: row.user, amountCents: row.amountCents, currency: row.currency,
    baseAmountCents: row.baseAmountCents, discountAmountCents: row.discountAmountCents,
    finalAmountCents: row.finalAmountCents, items,
    payment: payment ? {
      ...payment, expectedAmountRaw: payment.expectedAmountRaw.toString(),
      blockNumber: payment.blockNumber?.toString() ?? null,
      verifiedAt: iso(payment.verifiedAt), lastCheckedAt: iso(payment.lastCheckedAt),
      nextRetryAt: iso(payment.nextRetryAt), discoveredAt: iso(payment.discoveredAt),
      explorerUrl: payment.chainId === 42161 && /^0x[0-9a-fA-F]{64}$/.test(payment.txHash ?? "")
        ? `https://arbiscan.io/tx/${payment.txHash}` : null
    } : null,
    activation: {
      evidence: term ? "TERM_RECORDED" : row._count.capacityGrants || row._count.creditLedger
        ? "ENTRIES_RECORDED" : "NO_LINKED_EVIDENCE",
      term: term ? { ...term, startsAt: iso(term.startsAt), endsAt: iso(term.endsAt),
        graceEndsAt: iso(term.graceEndsAt), activatedAt: iso(term.activatedAt), expiredAt: iso(term.expiredAt) } : null,
      capacityGrantCount: row._count.capacityGrants, creditEntryCount: row._count.creditLedger,
      subscriptionSync: subscription ? { ...subscription, entitlementSyncedAt: iso(subscription.entitlementSyncedAt) } : null
    }
  };
}

export function registerAdminOrderRoutes(app: express.Express, deps: {
  db: Pick<PrismaClient, "billingOrder">;
  requirePlatformSuperadmin(res: express.Response): Promise<boolean>;
}) {
  app.get("/admin/billing/orders", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = adminOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid_query" });
    const { page, pageSize } = parsed.data;
    const where = buildAdminOrdersWhere(parsed.data);
    try {
      const [rows, total] = await Promise.all([
        deps.db.billingOrder.findMany({ where, select: adminOrderSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
        deps.db.billingOrder.count({ where })
      ]);
      return res.json({ items: rows.map(mapAdminOrder), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
    } catch {
      return res.status(500).json({ error: "admin_orders_unavailable" });
    }
  });

  app.get("/admin/billing/orders/:id", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = z.string().trim().min(1).max(191).safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: "invalid_order_id" });
    try {
      const row = await deps.db.billingOrder.findUnique({ where: { id: parsed.data }, select: {
        ...adminOrderSelect,
        capacityGrants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, select: {
          id: true, createdAt: true, validUntil: true, planScope: true,
          deltaRunningBots: true, deltaRunningPredictionsAi: true, deltaRunningPredictionsComposite: true
        } },
        creditLedger: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, select: {
          id: true, createdAt: true, reason: true, deltaCredits: true
        } }
      } });
      if (!row) return res.status(404).json({ error: "order_not_found" });
      return res.json({ ...mapAdminOrder(row),
        capacityGrants: row.capacityGrants.map(grant => ({ ...grant, createdAt: iso(grant.createdAt), validUntil: iso(grant.validUntil) })),
        creditEntries: row.creditLedger.map(entry => ({ ...entry, createdAt: iso(entry.createdAt), deltaCredits: entry.deltaCredits.toString() }))
      });
    } catch {
      return res.status(500).json({ error: "admin_order_unavailable" });
    }
  });
}

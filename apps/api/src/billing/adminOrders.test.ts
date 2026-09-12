import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth } from "../auth.js";
import { adminOrdersQuerySchema, buildAdminOrdersWhere, mapAdminOrder, registerAdminOrderRoutes } from "./adminOrders.js";

const now = new Date("2026-09-12T10:00:00Z");
function order(overrides: Record<string, unknown> = {}): Parameters<typeof mapAdminOrder>[0] {
  return {
    id: "order-1", merchantOrderId: "merchant-1", provider: "ARBITRUM_USDC", status: "CONFIRMING",
    createdAt: now, updatedAt: now, paidAt: null, expiresAt: now,
    amountCents: 500, currency: "USD", baseAmountCents: 600, discountAmountCents: 100, finalAmountCents: 500,
    paymentStatusRaw: "payment_received", user: { id: "user-1", email: "fixture@example.test", name: null },
    pkg: { name: "Changed catalog name", code: "changed", kind: "ADDON" },
    items: [{ id: "item-1", quantity: 2, kindSnapshot: "ADDON", packageSnapshot: { name: "Original credits", code: "original", secret: "not-returned" },
      unitPriceCents: 300, lineAmountCents: 600, currency: "USD", discountAmountCents: 100, finalAmountCents: 500,
      pkg: { name: "Changed catalog name", code: "changed", kind: "ADDON" } }],
    onchainPayment: { chainId: 42161, txHash: `0x${"a".repeat(64)}`, verifiedAt: null, confirmations: 100,
      expectedAmountRaw: 9007199254740993n, tokenDecimals: 6, tokenAddress: "0x-token",
      expectedSenderAddress: "0x-sender", treasuryAddress: "0x-treasury", treasuryConfigRevision: 1,
      blockNumber: 9007199254740995n, blockHash: "0x-block", verificationAttempts: 3,
      lastCheckedAt: now, nextRetryAt: now, discoveredAt: null },
    subscriptionTerm: null, subscription: null, _count: { capacityGrants: 0, creditLedger: 0 },
    ...overrides
  } as Parameters<typeof mapAdminOrder>[0];
}

test("admin order filters reject invalid dates, arrays, unknown statuses and unbounded paging", () => {
  for (const query of [{ page: 0 }, { pageSize: 101 }, { page: 1.5 }, { status: "paid" }, { provider: "UNKNOWN" },
    { search: ["a", "b"] }, { search: "x".repeat(161) }, { from: "2026-02-30" }, { to: "invalid" },
    { from: "2026-09-13", to: "2026-09-12" }]) {
    assert.equal(adminOrdersQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
  assert.equal(adminOrdersQuerySchema.parse({}).pageSize, 25);
});

test("admin order filters combine UTC inclusive days, provider, status and identity search", () => {
  const where = buildAdminOrdersWhere(adminOrdersQuerySchema.parse({ search: " Alice ", status: "PAID", provider: "CCPAYMENT", from: "2026-09-12", to: "2026-09-12" }));
  assert.equal(where.status, "PAID"); assert.equal(where.provider, "CCPAYMENT");
  assert.deepEqual(where.createdAt, { gte: new Date("2026-09-12T00:00:00Z"), lt: new Date("2026-09-13T00:00:00Z") });
  assert.equal(where.OR?.length, 5);
  assert.match(JSON.stringify(where.OR), /Alice/);
  assert.deepEqual(buildAdminOrdersWhere(adminOrdersQuerySchema.parse({})), {});
});

test("admin order projection preserves immutable item snapshots, exact integers and unverified receipt evidence", () => {
  const result = mapAdminOrder(order());
  assert.equal(result.items[0].name, "Original credits");
  assert.equal(result.items[0].catalogFallback, false);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.payment?.expectedAmountRaw, "9007199254740993");
  assert.equal(result.payment?.blockNumber, "9007199254740995");
  assert.equal(result.payment?.verifiedAt, null);
  assert.equal(result.activation.evidence, "NO_LINKED_EVIDENCE");
  assert.match(result.payment!.explorerUrl!, /^https:\/\/arbiscan.io\/tx\/0x/);
  assert.doesNotMatch(JSON.stringify(result), /secret|not-returned|packageSnapshot|createPayload/);
});

test("admin order evidence distinguishes scheduled terms, grant records, legacy gaps and current sync", () => {
  const scheduled = mapAdminOrder(order({ status: "PAID", subscriptionTerm: { id: "term", plan: "PRO", status: "SCHEDULED",
    startsAt: now, endsAt: now, graceEndsAt: now, activatedAt: null, expiredAt: null },
    subscription: { id: "sub", entitlementSyncPending: true, entitlementSyncAttempts: 2, entitlementSyncedAt: now } }));
  assert.equal(scheduled.activation.term?.status, "SCHEDULED");
  assert.equal(scheduled.activation.term?.activatedAt, null);
  assert.equal(scheduled.activation.subscriptionSync?.entitlementSyncPending, true);
  assert.equal(mapAdminOrder(order({ _count: { creditLedger: 2, capacityGrants: 1 } })).activation.evidence, "ENTRIES_RECORDED");
  const legacy = mapAdminOrder(order({ items: [], onchainPayment: null, status: "PAID", provider: "CCPAYMENT" }));
  assert.equal(legacy.items[0].catalogFallback, true);
  assert.equal(legacy.activation.evidence, "NO_LINKED_EVIDENCE");
  assert.equal(legacy.payment, null);
  const base = order();
  assert.equal(mapAdminOrder(order({ onchainPayment: { ...base.onchainPayment, verifiedAt: now } })).payment?.verifiedAt, now.toISOString());
  for (const payment of [{ ...base.onchainPayment, chainId: 1 }, { ...base.onchainPayment, txHash: "javascript:bad" }]) {
    assert.equal(mapAdminOrder(order({ onchainPayment: payment })).payment?.explorerUrl, null);
  }
});

function harness(allowed = true, fail = false) {
  const handlers = new Map<string, Array<(...args: any[]) => any>>();
  const reads: Array<{ method: string; args: any }> = [];
  let found: unknown = { ...order(), capacityGrants: [], creditLedger: [{ id: "credit", createdAt: now, reason: "TOPUP", deltaCredits: 9007199254740993n }] };
  const db = { billingOrder: Object.fromEntries(["findMany", "count", "findUnique"].map(method => [method, async (args: unknown) => {
    reads.push({ method, args });
    if (fail) throw new Error("secret RPC credential");
    return method === "findMany" ? [order()] : method === "count" ? 51 : found;
  }])) };
  registerAdminOrderRoutes({ get(path: string, ...args: any[]) { handlers.set(path, args); } } as any, {
    db: db as any, requirePlatformSuperadmin: async res => {
      if (!allowed) res.status(403).json({ error: "forbidden" });
      return allowed;
    }
  });
  const res = { statusCode: 200, body: null as any, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return { handlers, reads, res, missing: () => { found = null; },
    run: async (detail = false, query = {}) => handlers.get(detail ? "/admin/billing/orders/:id" : "/admin/billing/orders")!.at(-1)!({ query, params: { id: "order-1" } }, res) };
}

test("both admin order endpoints require authentication and platform authorization before any reads", async () => {
  for (const detail of [false, true]) {
    const h = harness(false);
    const route = h.handlers.get(detail ? "/admin/billing/orders/:id" : "/admin/billing/orders")!;
    assert.equal(route[0], requireAuth);
    await route[0]({ cookies: {} }, h.res, () => assert.fail("must not authenticate"));
    assert.equal(h.res.statusCode, 401);
    await h.run(detail);
    assert.equal(h.res.statusCode, 403);
    assert.equal(h.reads.length, 0);
  }
});

test("admin order list bounds reads, orders deterministically and applies matching count filters", async () => {
  const h = harness(); await h.run(false, { page: "2", pageSize: "25", status: "PAID" });
  assert.equal(h.res.body.totalPages, 3);
  const list = h.reads.find(read => read.method === "findMany")!.args;
  assert.equal(list.skip, 25); assert.equal(list.take, 25);
  assert.deepEqual(list.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(list.where, h.reads.find(read => read.method === "count")!.args.where);
  assert.equal(h.res.headers["Cache-Control"], "no-store");
  const invalid = harness(); await invalid.run(false, { pageSize: 1000 });
  assert.equal(invalid.res.statusCode, 400); assert.equal(invalid.reads.length, 0);
});

test("admin detail serializes bounded grant evidence, missing orders and errors without leaking internals", async () => {
  const h = harness(); await h.run(true);
  assert.equal(h.res.body.creditEntries[0].deltaCredits, "9007199254740993");
  assert.equal(h.reads[0].args.select.creditLedger.take, 100);
  assert.equal(h.reads[0].args.select.capacityGrants.take, 100);
  h.missing(); await h.run(true); assert.equal(h.res.statusCode, 404);
  for (const detail of [false, true]) {
    const failed = harness(true, true); await failed.run(detail);
    assert.equal(failed.res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(failed.res.body), /secret|credential/);
  }
});

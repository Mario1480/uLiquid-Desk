import assert from "node:assert/strict";
import test from "node:test";
import {
  adminBillingAdjustCreditsSchema,
  adminBillingPackageSchema,
  registerBillingRoutes
} from "./routes.js";

test("adminBillingPackageSchema accepts plan credit fields as numbers or strings", () => {
  const basePayload = {
    code: "free",
    name: "Free",
    kind: "plan",
    priceCents: 0
  };

  const parsedNumbers = adminBillingPackageSchema.safeParse({
    ...basePayload,
    plan: "free",
    monthlyAiCredits: 1000
  });
  assert.equal(parsedNumbers.success, true);
  if (parsedNumbers.success) {
    assert.equal(parsedNumbers.data.monthlyAiCredits, "1000");
  }

  const parsedStrings = adminBillingPackageSchema.safeParse({
    ...basePayload,
    plan: "free",
    monthlyAiCredits: "1000"
  });
  assert.equal(parsedStrings.success, true);
  if (parsedStrings.success) {
    assert.equal(parsedStrings.data.monthlyAiCredits, "1000");
  }
});

test("adminBillingPackageSchema accepts the Premium entitlement contract", () => {
  const parsed = adminBillingPackageSchema.safeParse({
    code: "premium_monthly",
    name: "Premium Monthly",
    kind: "plan",
    isActive: false,
    priceCents: 6900,
    billingMonths: 1,
    plan: "premium",
    maxExchangeAccounts: null,
    maxRunningBots: 15,
    maxRunningPredictionsAi: 10,
    maxRunningPredictionsComposite: 5,
    allowedExchanges: ["*"],
    monthlyAiCredits: "30000"
  });
  assert.equal(parsed.success, true);
});

test("adminBillingPackageSchema accepts add-on credit fields as numbers or strings", () => {
  const parsed = adminBillingPackageSchema.safeParse({
    code: "ai_credits_250k",
    name: "AI Credits 250k",
    kind: "addon",
    addonType: "ai_credits",
    priceCents: 900,
    aiCredits: "250000"
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.aiCredits, "250000");
  }
});

test("adminBillingPackageSchema keeps package credit fields optional", () => {
  assert.equal(adminBillingPackageSchema.safeParse({
    code: "pro_legacy",
    name: "Pro Legacy",
    kind: "plan",
    plan: "pro",
    priceCents: 2900
  }).success, true);
  assert.equal(adminBillingPackageSchema.safeParse({
    code: "credits_legacy",
    name: "Credits Legacy",
    kind: "addon",
    addonType: "ai_credits",
    priceCents: 900
  }).success, true);
});

test("adminBillingPackageSchema rejects active zero-price and no-op add-ons", () => {
  assert.equal(adminBillingPackageSchema.safeParse({
    code: "pro_broken",
    name: "Pro Broken",
    kind: "plan",
    plan: "pro",
    priceCents: 0
  }).success, false);
  assert.equal(adminBillingPackageSchema.safeParse({
    code: "bots_broken",
    name: "Bots Broken",
    kind: "addon",
    addonType: "running_bots",
    isActive: true,
    priceCents: 500,
    deltaRunningBots: 0
  }).success, false);
  assert.equal(adminBillingPackageSchema.safeParse({
    code: "free",
    name: "Free",
    kind: "plan",
    plan: "free",
    priceCents: 0
  }).success, true);
});

test("adminBillingAdjustCreditsSchema accepts credit delta as string or number", () => {
  const parsedString = adminBillingAdjustCreditsSchema.safeParse({
    deltaCredits: "-2500",
    note: "refund correction"
  });
  assert.equal(parsedString.success, true);
  if (parsedString.success) {
    assert.equal(parsedString.data.deltaCredits, "-2500");
  }

  const parsedNumber = adminBillingAdjustCreditsSchema.safeParse({
    deltaCredits: 2500,
    note: "support top-up"
  });
  assert.equal(parsedNumber.success, true);
  if (parsedNumber.success) {
    assert.equal(parsedNumber.data.deltaCredits, "2500");
  }

  const exactBeyondSafeInteger = adminBillingAdjustCreditsSchema.safeParse({
    deltaCredits: "9007199254740993",
    note: "large exact correction"
  });
  assert.equal(exactBeyondSafeInteger.success, true);
  if (exactBeyondSafeInteger.success) {
    assert.equal(exactBeyondSafeInteger.data.deltaCredits, "9007199254740993");
  }
});

test("billing bigint schemas reject non-canonical, unsafe and out-of-range values", () => {
  for (const deltaCredits of ["9223372036854775808", "-9223372036854775809", "1e3", "1.5", "01", 9007199254740992]) {
    assert.equal(adminBillingAdjustCreditsSchema.safeParse({ deltaCredits, note: "invalid" }).success, false);
  }
  assert.equal(adminBillingAdjustCreditsSchema.safeParse({
    deltaCredits: "9223372036854775807",
    note: "max"
  }).success, true);
  assert.equal(adminBillingAdjustCreditsSchema.safeParse({
    deltaCredits: "-9223372036854775808",
    note: "min"
  }).success, true);

  const pkg = adminBillingPackageSchema.safeParse({
    code: "pro_exact",
    name: "Pro Exact",
    kind: "plan",
    plan: "pro",
    priceCents: 2900,
    monthlyAiCredits: "9007199254740993"
  });
  assert.equal(pkg.success, true);
  if (pkg.success) assert.equal(pkg.data.monthlyAiCredits, "9007199254740993");
});

test("adminBillingPackageSchema requires addonType for add-ons", () => {
  const parsed = adminBillingPackageSchema.safeParse({
    code: "running_bots_1",
    name: "Running Bots +1",
    kind: "addon",
    priceCents: 900
  });
  assert.equal(parsed.success, false);
});

type Handler = (...args: any[]) => any;

function createFakeApp() {
  const routes = {
    get: new Map<string, Handler[]>(),
    post: new Map<string, Handler[]>(),
    put: new Map<string, Handler[]>(),
    delete: new Map<string, Handler[]>()
  };
  return {
    get(path: string, ...handlers: Handler[]) { routes.get.set(path, handlers); },
    post(path: string, ...handlers: Handler[]) { routes.post.set(path, handlers); },
    put(path: string, ...handlers: Handler[]) { routes.put.set(path, handlers); },
    delete(path: string, ...handlers: Handler[]) { routes.delete.set(path, handlers); },
    routes
  };
}

function createMockRes() {
  return {
    locals: { user: { id: "user_1", email: "user@example.com" } } as Record<string, any>,
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

function createRouteDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: {
      user: {
        findUnique: async () => null,
        findFirst: async () => null
      }
    },
    requireSuperadmin: async () => true,
    requirePlatformSuperadmin: async () => true,
    consumeRecentReauth: async (_req: any, _res: any, next: () => void) => next(),
    getBillingFeatureFlagsSettings: async () => ({}),
    updateBillingFeatureFlags: async () => ({}),
    listBillingPackages: async () => [],
    upsertBillingPackage: async () => ({ id: "pkg" }),
    deleteBillingPackage: async () => undefined,
    getSubscriptionSummary: async () => ({ packages: [], orders: [] }),
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "free", capabilities: {} }),
    adjustAiCreditBalanceByAdmin: async () => ({ balance: 0n }),
    isBillingEnabled: async () => true,
    listSubscriptionOrders: async () => [],
    createBillingCheckout: async () => { throw new Error("not_implemented"); },
    getBillingOrderForUser: async () => { throw new Error("order_not_found"); },
    cancelBillingOrder: async () => { throw new Error("order_not_cancellable"); },
    submitBillingTransaction: async () => { throw new Error("not_implemented"); },
    reconcileBillingOrderPayment: async () => { throw new Error("not_implemented"); },
    getSubscriptionNotificationPreference: async () => ({ channel: "EMAIL", locale: "en" }),
    updateSubscriptionNotificationPreference: async () => ({ channel: "EMAIL", locale: "en" }),
    getArbitrumUsdcPaymentReadiness: async () => ({ configured: false, rpc: { ready: false } }),
    updateArbitrumUsdcPaymentConfiguration: async () => ({}),
    ...overrides
  };
}

function lastHandler(app: ReturnType<typeof createFakeApp>, method: keyof typeof app.routes, path: string) {
  const handler = app.routes[method].get(path)?.at(-1);
  if (!handler) throw new Error(`route_not_found:${method}:${path}`);
  return handler;
}

async function runMiddlewareChain(handlers: Handler[], req: any, res: any): Promise<void> {
  let index = 0;
  const next = async (): Promise<void> => {
    const handler = handlers[index++];
    if (!handler) return;
    await handler(req, res, next);
  };
  await next();
}

test("checkout returns the server-defined Arbitrum USDC payment contract without a redirect URL", async () => {
  const app = createFakeApp();
  registerBillingRoutes(app as any, createRouteDeps({
    createBillingCheckout: async () => ({
      mode: "onchain",
      order: {
        id: "order_1",
        merchantOrderId: "ULIQUID_1",
        status: "PENDING",
        expiresAt: new Date("2026-08-02T12:00:00.000Z")
      },
      payment: {
        chainId: 42161,
        tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        tokenDecimals: 6,
        expectedSenderAddress: "0x2222222222222222222222222222222222222222",
        recipientAddress: "0x1111111111111111111111111111111111111111",
        amountRaw: "19990000",
        amountFormatted: "19.99",
        expiresAt: "2026-08-02T12:00:00.000Z"
      }
    })
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/checkout")(
    { body: { packageId: "pro_monthly" } },
    res
  );
  assert.equal(res.body?.mode, "onchain");
  assert.equal(res.body?.payment?.chainId, 42161);
  assert.equal(res.body?.payment?.amountRaw, "19990000");
  assert.equal(res.body?.payment?.expectedSenderAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(res.body?.payment?.recipientAddress, "0x1111111111111111111111111111111111111111");
  assert.equal("payUrl" in (res.body ?? {}), false);
});

test("checkout forwards explicit ULIQ opt-in and returns the exact reservation snapshot", async () => {
  const app = createFakeApp();
  let checkoutInput: any = null;
  registerBillingRoutes(app as any, createRouteDeps({
    createBillingCheckout: async (input: any) => {
      checkoutInput = input;
      return {
        mode: "onchain",
        order: {
          id: "order_uliq",
          merchantOrderId: "ULIQUID_DISCOUNT_1",
          status: "PENDING",
          baseAmountCents: 10_000,
          discountAmountCents: 1_500,
          finalAmountCents: 8_500,
          uliqTierSnapshot: "GOLD",
          uliqDiscountBps: 1_500,
          uliqBenefitReservation: {
            id: "reservation-1",
            expiresAt: new Date("2026-08-22T12:10:00.000Z")
          }
        },
        payment: {
          chainId: 42161,
          tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          tokenDecimals: 6,
          expectedSenderAddress: "0x2222222222222222222222222222222222222222",
          recipientAddress: "0x1111111111111111111111111111111111111111",
          amountRaw: "85000000",
          amountFormatted: "85.00",
          expiresAt: "2026-08-22T12:10:00.000Z"
        }
      };
    }
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/checkout")(
    { body: { items: [{ packageId: "ai_credits_1m", quantity: 1 }], applyUliqDiscount: true } },
    res
  );
  assert.deepEqual(checkoutInput, {
    userId: "user_1",
    items: [{ packageId: "ai_credits_1m", quantity: 1 }],
    applyUliqDiscount: true
  });
  assert.deepEqual(res.body.uliqBenefit, {
    reservationId: "reservation-1",
    tier: "GOLD",
    discountBps: 1_500,
    baseAmountCents: 10_000,
    discountAmountCents: 1_500,
    finalAmountCents: 8_500,
    expiresAt: "2026-08-22T12:10:00.000Z"
  });
  assert.equal(res.body.payment.amountRaw, "85000000");
});

test("checkout maps unsupported zero-value carts to a stable client error", async () => {
  const app = createFakeApp();
  registerBillingRoutes(app as any, createRouteDeps({
    createBillingCheckout: async () => { throw new Error("cart_zero_amount_not_supported"); }
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/checkout")(
    { body: { packageId: "zero_price_package" } },
    res
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "cart_zero_amount_not_supported" });
});

test("admin package create defaults omitted token values while update preserves omission", async () => {
  const app = createFakeApp();
  const payloads: any[] = [];
  registerBillingRoutes(app as any, createRouteDeps({
    upsertBillingPackage: async (payload: any) => {
      payloads.push(payload);
      return { id: payload.id ?? "pkg_new" };
    }
  }) as any);
  const body = {
    code: "pro_legacy",
    name: "Pro Legacy",
    kind: "plan",
    plan: "pro",
    priceCents: 2900
  };

  const createRes = createMockRes();
  await lastHandler(app, "post", "/admin/billing/packages")({ body }, createRes);
  assert.equal(createRes.statusCode, 201);
  assert.equal(payloads[0].monthlyAiCredits, "0");
  assert.equal(payloads[0].aiCredits, "0");

  const updateRes = createMockRes();
  await lastHandler(app, "put", "/admin/billing/packages/:id")(
    { params: { id: "pkg_existing" }, body },
    updateRes
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(payloads[1].id, "pkg_existing");
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], "monthlyAiCredits"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payloads[1], "aiCredits"), false);
});

test("order submit is scoped to the authenticated owner and rejects malformed transaction hashes", async () => {
  const app = createFakeApp();
  let submitted: any = null;
  registerBillingRoutes(app as any, createRouteDeps({
    submitBillingTransaction: async (input: any) => {
      submitted = input;
      return {
        order: {
          id: input.orderId,
          merchantOrderId: "ULIQUID_1",
          status: "CONFIRMING",
          amountCents: 1999,
          onchainPayment: {
            chainId: 42161,
            tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
            tokenDecimals: 6,
            expectedSenderAddress: "0x2222222222222222222222222222222222222222",
            treasuryAddress: "0x1111111111111111111111111111111111111111",
            expectedAmountRaw: 19990000n,
            txHash: input.txHash,
            confirmations: 0
          }
        }
      };
    }
  }) as any);

  const invalidRes = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/orders/:id/submit")(
    { params: { id: "order_1" }, body: { txHash: "0x1234" } },
    invalidRes
  );
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(submitted, null);

  const txHash = `0x${"a".repeat(64)}`;
  const validRes = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/orders/:id/submit")(
    { params: { id: "order_1" }, body: { txHash } },
    validRes
  );
  assert.deepEqual(submitted, { userId: "user_1", orderId: "order_1", txHash });
  assert.equal(validRes.statusCode, 202);
  assert.equal(validRes.body?.status, "confirming");
});

test("an order lookup does not expose another user's order", async () => {
  const app = createFakeApp();
  registerBillingRoutes(app as any, createRouteDeps({
    getBillingOrderForUser: async () => { throw new Error("order_not_found"); }
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "get", "/settings/subscription/orders/:id")(
    { params: { id: "other_order" } },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error, "order_not_found");
});

test("an unpaid order can be cancelled only through the authenticated ownership contract", async () => {
  const app = createFakeApp();
  let cancelled: any = null;
  registerBillingRoutes(app as any, createRouteDeps({
    cancelBillingOrder: async (input: any) => {
      cancelled = input;
      return {
        order: {
          id: input.orderId,
          merchantOrderId: "ULIQUID_1",
          status: "EXPIRED",
          amountCents: 1999,
          paymentStatusRaw: "user_cancelled"
        }
      };
    }
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "post", "/settings/subscription/orders/:id/cancel")(
    { params: { id: "order_1" }, body: {} },
    res
  );
  assert.deepEqual(cancelled, { userId: "user_1", orderId: "order_1" });
  assert.equal(res.body?.status, "expired");
});

test("Treasury rotation requires exact confirmation and consumes reauth before the audited write", async () => {
  const app = createFakeApp();
  const calls: string[] = [];
  const address = "0x1111111111111111111111111111111111111111";
  registerBillingRoutes(app as any, createRouteDeps({
    requirePlatformSuperadmin: async () => {
      calls.push("superadmin");
      return true;
    },
    consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
      calls.push("reauth");
      next();
    },
    updateArbitrumUsdcPaymentConfiguration: async (input: any) => {
      calls.push(`update:${input.actorUserId}:${input.treasuryAddress}`);
      return {};
    },
    getArbitrumUsdcPaymentReadiness: async () => ({ configured: true, rpc: { ready: true } })
  }) as any);
  const handlers = app.routes.put.get("/admin/billing/payment-config");
  assert.ok(handlers);

  const mismatchRes = createMockRes();
  await runMiddlewareChain(
    handlers!.slice(1),
    {
      body: { treasuryAddress: address, confirmTreasuryAddress: address.toUpperCase() },
      ip: "127.0.0.1"
    },
    mismatchRes
  );
  assert.equal(mismatchRes.statusCode, 400);
  assert.deepEqual(calls, ["superadmin"]);

  calls.length = 0;
  const successRes = createMockRes();
  await runMiddlewareChain(
    handlers!.slice(1),
    {
      body: { treasuryAddress: address, confirmTreasuryAddress: address },
      ip: "127.0.0.1"
    },
    successRes
  );
  assert.deepEqual(calls, [
    "superadmin",
    "reauth",
    `update:user_1:${address}`
  ]);
  assert.equal(successRes.body?.configured, true);
});

test("disabling checkout keeps the real Pro lifecycle, capabilities, packages and orders visible", async () => {
  const app = createFakeApp();
  let summaryCalls = 0;
  registerBillingRoutes(app as any, createRouteDeps({
    isBillingEnabled: async () => false,
    getSubscriptionSummary: async () => {
      summaryCalls += 1;
      return {
        plan: "pro",
        status: "grace",
        proValidUntil: "2026-08-20T12:00:00.000Z",
        graceEndsAt: "2026-08-23T12:00:00.000Z",
        packages: [{ id: "pro", code: "pro", name: "Pro", kind: "PLAN", plan: "PRO" }],
        orders: [{ id: "order_1", status: "CONFIRMING", amountCents: 2900 }]
      };
    },
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "pro",
      capabilities: { aiPredictions: true }
    })
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "get", "/settings/subscription")({}, res);
  assert.equal(summaryCalls, 1);
  assert.equal(res.body?.billingEnabled, false);
  assert.equal(res.body?.plan, "pro");
  assert.equal(res.body?.status, "grace");
  assert.equal(res.body?.orders?.[0]?.id, "order_1");
  assert.equal(res.body?.packages?.[0]?.code, "pro");
});

test("order mapping preserves service ISO timestamps for verified payments", async () => {
  const app = createFakeApp();
  const verifiedAt = "2026-08-01T12:00:00.000Z";
  registerBillingRoutes(app as any, createRouteDeps({
    getBillingOrderForUser: async () => ({
      order: {
        id: "order_1",
        status: "CONFIRMING",
        amountCents: 2900,
        onchainPayment: {
          chainId: 42161,
          tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          tokenDecimals: 6,
          expectedSenderAddress: "0x2222222222222222222222222222222222222222",
          treasuryAddress: "0x1111111111111111111111111111111111111111",
          expectedAmountRaw: 29_000_000n
        }
      },
      payment: {
        chainId: 42161,
        tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        tokenDecimals: 6,
        expectedSenderAddress: "0x2222222222222222222222222222222222222222",
        treasuryAddress: "0x1111111111111111111111111111111111111111",
        expectedAmountRaw: "29000000",
        verifiedAt,
        lastCheckedAt: verifiedAt
      }
    })
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "get", "/settings/subscription/orders/:id")(
    { params: { id: "order_1" } },
    res
  );
  assert.equal(res.body?.onchainPayment?.verifiedAt, verifiedAt);
  assert.equal(res.body?.onchainPayment?.lastCheckedAt, verifiedAt);
});

test("billing enable readiness failures return a stable service-unavailable response", async () => {
  const app = createFakeApp();
  registerBillingRoutes(app as any, createRouteDeps({
    updateBillingFeatureFlags: async () => { throw new Error("payment_config_not_ready"); }
  }) as any);
  const res = createMockRes();
  await lastHandler(app, "put", "/admin/settings/billing")(
    { body: { billingEnabled: true } },
    res
  );
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "payment_config_not_ready" });
});

test("billing false-to-true activation requires platform superadmin reauth", async () => {
  const app = createFakeApp();
  let platformChecks = 0;
  let reauthChecks = 0;
  registerBillingRoutes(app as any, createRouteDeps({
    getBillingFeatureFlagsSettings: async () => ({ billingEnabled: false }),
    requirePlatformSuperadmin: async () => {
      platformChecks += 1;
      return true;
    },
    consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
      reauthChecks += 1;
      return next();
    },
    updateBillingFeatureFlags: async (payload: any) => payload
  }) as any);
  const res = createMockRes();
  await runMiddlewareChain(
    (app.routes.put.get("/admin/settings/billing") ?? []).slice(1),
    { body: { billingEnabled: true }, cookies: {} },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(platformChecks, 1);
  assert.equal(reauthChecks, 1);
});

test("billing disablement remains immediately available to a superadmin", async () => {
  const app = createFakeApp();
  let reauthChecks = 0;
  registerBillingRoutes(app as any, createRouteDeps({
    getBillingFeatureFlagsSettings: async () => ({ billingEnabled: true }),
    consumeRecentReauth: async (_req: any, _res: any, next: () => void) => {
      reauthChecks += 1;
      return next();
    },
    updateBillingFeatureFlags: async (payload: any) => payload
  }) as any);
  const res = createMockRes();
  await runMiddlewareChain(
    (app.routes.put.get("/admin/settings/billing") ?? []).slice(1),
    { body: { billingEnabled: false }, cookies: {} },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(reauthChecks, 0);
});

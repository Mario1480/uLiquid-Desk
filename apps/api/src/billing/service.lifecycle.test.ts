import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addBillingMonths,
  assignBillingDiscoveryTransactionHashes,
  BILLING_DB_BIGINT_MAX,
  activateSubscriptionTermInTransaction,
  assertBillingDiscoveryScopeStableBeforeCursor,
  applyAiCreditAdminAdjustmentInTransaction,
  applyAiLedgerCreditInTransaction,
  billingAmountCentsToUsdcRaw,
  billingDiscoveryRetryAt,
  buildActiveBillingPackageWhere,
  buildCommercialStrategyEntitlements,
  buildDueSubscriptionAiGrantOrderBy,
  buildPlanPackageLiveSyncWhere,
  buildSubscriptionMonthlyGrantSchedule,
  calculateBillingCartAmountCents,
  captureBillingDiscoveryScopeAfterHead,
  createBillingOrderWithTreasurySnapshotCas,
  cutoffCapacityGrantValidity,
  ensureAiCreditMinimumInTransaction,
  formatPlan,
  getVerifiedBillingPaymentTimestamp,
  getBillingDiscoveryScanRange,
  inspectArbitrumUsdcRpc,
  hasPaidCapacityAddonTarget,
  isEnterpriseStrategyLicense,
  isWithinLatePaymentRecoveryHorizon,
  isBillingPackagePurchasable,
  matchBillingDiscoveryTransactionHashes,
  mergeBillingFeatureFlags,
  planSubscriptionTermWindow,
  parseBillingDbBigInt,
  predictionScheduleConsumesNewSlot,
  persistBillingDiscoveryTransition,
  persistBillingDiscoveryCandidate,
  persistBillingVerificationTransition,
  persistSubscriptionAiGrantFailure,
  resolveSubscriptionTermPhase,
  requireLiveArbitrumBillingBlock,
  reconcileBillingPaymentRows,
  requirePayableBillingCartAmountCents,
  resolveBillingOrderFinalizationDecision,
  resolveBillingPackageCreditAmounts,
  resolvePlanBaseQuotaDefaults,
  resolveCapacityAddonTargetTermInTransaction,
  resolveImmediatePremiumUpgradePricing,
  runConfirmedBillingFinalization,
  runDueSubscriptionTermAiCycle,
  runSerializableBillingConfigTransaction,
  runTrackedWorkspaceEntitlementSync,
  shouldEscalateMissingBillingTransaction,
  shouldResumeVerifiedBillingPayment,
  validateBillingPackageConfiguration
} from "./service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENDER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;

test("commercial plan base quotas match the approved Free, Pro and Premium matrix", () => {
  assert.deepEqual(resolvePlanBaseQuotaDefaults("free"), {
    maxRunningBots: 1,
    maxRunningPredictionsAi: 0,
    maxRunningPredictionsComposite: 0
  });
  assert.deepEqual(resolvePlanBaseQuotaDefaults("pro"), {
    maxRunningBots: 3,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2
  });
  assert.deepEqual(resolvePlanBaseQuotaDefaults("premium"), {
    maxRunningBots: 10,
    maxRunningPredictionsAi: 10,
    maxRunningPredictionsComposite: 5
  });
});

test("an already running schedule does not consume another slot after downgrade", () => {
  assert.equal(predictionScheduleConsumesNewSlot({ currentlyEnabled: true, currentlyPaused: false }), false);
  assert.equal(predictionScheduleConsumesNewSlot({ currentlyEnabled: true, currentlyPaused: true }), true);
  assert.equal(predictionScheduleConsumesNewSlot({ currentlyEnabled: false, currentlyPaused: false }), true);
});

test("uses UTC calendar-month semantics and clamps month-end renewals", () => {
  assert.equal(addBillingMonths(new Date("2024-01-31T12:00:00.000Z"), 1).toISOString(), "2024-02-29T12:00:00.000Z");
  assert.equal(addBillingMonths(new Date("2024-01-31T12:00:00.000Z"), 2).toISOString(), "2024-03-31T12:00:00.000Z");
  assert.equal(addBillingMonths(new Date("2024-08-31T12:00:00.000Z"), 6).toISOString(), "2025-02-28T12:00:00.000Z");
  assert.equal(addBillingMonths(new Date("2024-02-29T12:00:00.000Z"), 12).toISOString(), "2025-02-28T12:00:00.000Z");
  assert.equal(addBillingMonths(new Date("2025-01-31T12:00:00.000Z"), 1).toISOString(), "2025-02-28T12:00:00.000Z");
});

test("Pro to Premium charges the full package difference and preserves the paid term window", async (t) => {
  const now = new Date("2026-08-26T10:00:00.000Z");
  const endsAt = new Date("2027-08-01T10:00:00.000Z");
  const graceEndsAt = new Date("2027-08-04T10:00:00.000Z");
  const result = resolveImmediatePremiumUpgradePricing({
    now,
    sourcePlan: "PRO",
    targetPlan: "PREMIUM",
    sourceTermId: "term_annual_pro",
    sourceTermEndsAt: endsAt,
    sourceTermGraceEndsAt: graceEndsAt,
    sourcePriceCents: 29_000,
    targetPriceCents: 69_000,
    sourceBillingMonths: 12,
    targetBillingMonths: 12,
    hasScheduledTerm: false
  });
  assert.deepEqual(result, {
    kind: "IMMEDIATE_PLAN_UPGRADE",
    sourcePlan: "PRO",
    targetPlan: "PREMIUM",
    sourceTermId: "term_annual_pro",
    sourceTermEndsAt: endsAt.toISOString(),
    sourceTermGraceEndsAt: graceEndsAt.toISOString(),
    sourcePriceCents: 29_000,
    targetPriceCents: 69_000,
    differenceCents: 40_000,
    billingMonths: 12
  });

  await t.test("is not used for renewals or downgrades", () => {
    assert.equal(resolveImmediatePremiumUpgradePricing({
      now,
      sourcePlan: "PREMIUM",
      targetPlan: "PRO",
      sourceTermId: "term_1",
      sourceTermEndsAt: endsAt,
      sourceTermGraceEndsAt: graceEndsAt,
      sourcePriceCents: 69_000,
      targetPriceCents: 29_000,
      sourceBillingMonths: 12,
      targetBillingMonths: 12,
      hasScheduledTerm: false
    }), null);
  });

  await t.test("fails closed for expired terms, mismatched durations and queued terms", () => {
    const base = {
      now,
      sourcePlan: "PRO",
      targetPlan: "PREMIUM",
      sourceTermId: "term_1",
      sourceTermEndsAt: endsAt,
      sourceTermGraceEndsAt: graceEndsAt,
      sourcePriceCents: 2_900,
      targetPriceCents: 6_900,
      sourceBillingMonths: 1,
      targetBillingMonths: 1,
      hasScheduledTerm: false
    };
    assert.throws(
      () => resolveImmediatePremiumUpgradePricing({ ...base, sourceTermEndsAt: now }),
      /premium_upgrade_active_term_required/
    );
    assert.throws(
      () => resolveImmediatePremiumUpgradePricing({ ...base, targetBillingMonths: 12 }),
      /premium_upgrade_term_mismatch/
    );
    assert.throws(
      () => resolveImmediatePremiumUpgradePricing({ ...base, hasScheduledTerm: true }),
      /premium_upgrade_scheduled_term_conflict/
    );
    assert.throws(
      () => resolveImmediatePremiumUpgradePricing({ ...base, sourcePriceCents: 6_900 }),
      /premium_upgrade_price_evidence_invalid/
    );
  });
});

test("schedules early, repeated and grace-period renewals after the paid chain", async (t) => {
  const current = {
    endsAt: new Date("2026-09-30T10:00:00.000Z"),
    graceEndsAt: new Date("2026-10-03T10:00:00.000Z")
  };
  await t.test("early renewal", () => {
    const window = planSubscriptionTermWindow({
      now: new Date("2026-09-01T10:00:00.000Z"),
      billingMonths: 1,
      latestTerm: current
    });
    assert.equal(window.startsAt.toISOString(), current.endsAt.toISOString());
    assert.equal(window.endsAt.toISOString(), "2026-10-30T10:00:00.000Z");
  });
  await t.test("multiple queued renewals", () => {
    const queued = {
      endsAt: new Date("2026-10-30T10:00:00.000Z"),
      graceEndsAt: new Date("2026-11-02T10:00:00.000Z")
    };
    const window = planSubscriptionTermWindow({
      now: new Date("2026-09-02T10:00:00.000Z"),
      billingMonths: 1,
      latestTerm: queued
    });
    assert.equal(window.startsAt.toISOString(), queued.endsAt.toISOString());
    assert.equal(window.endsAt.toISOString(), "2026-11-30T10:00:00.000Z");
  });
  await t.test("renewal during grace starts at the old contractual end", () => {
    const window = planSubscriptionTermWindow({
      now: new Date("2026-10-02T10:00:00.000Z"),
      billingMonths: 1,
      latestTerm: current
    });
    assert.equal(window.startsAt.toISOString(), current.endsAt.toISOString());
  });
  await t.test("renewal after grace starts when payment is confirmed", () => {
    const now = new Date("2026-10-04T10:00:00.000Z");
    const window = planSubscriptionTermWindow({ now, billingMonths: 1, latestTerm: current });
    assert.equal(window.startsAt.toISOString(), now.toISOString());
  });
  await t.test("renewal exactly at grace end starts when payment is confirmed", () => {
    const now = current.graceEndsAt;
    const window = planSubscriptionTermWindow({ now, billingMonths: 1, latestTerm: current });
    assert.equal(window.startsAt.toISOString(), now.toISOString());
  });
});

test("models active, three-day grace and expired lifecycle boundaries", () => {
  const startsAt = new Date("2026-08-01T00:00:00.000Z");
  const endsAt = new Date("2026-09-01T00:00:00.000Z");
  const graceEndsAt = new Date(endsAt.getTime() + 3 * DAY_MS);
  assert.equal(resolveSubscriptionTermPhase({ startsAt, endsAt, graceEndsAt, now: new Date("2026-08-31T23:59:59.999Z") }), "active");
  assert.equal(resolveSubscriptionTermPhase({ startsAt, endsAt, graceEndsAt, now: endsAt }), "grace");
  assert.equal(resolveSubscriptionTermPhase({ startsAt, endsAt, graceEndsAt, now: graceEndsAt }), "expired");
});

test("builds one idempotent AI grant cycle per calendar month without granting at purchase time", () => {
  const startsAt = new Date("2024-01-31T12:00:00.000Z");
  const endsAt = addBillingMonths(startsAt, 3);
  assert.deepEqual(
    buildSubscriptionMonthlyGrantSchedule(startsAt, endsAt).map((date) => date.toISOString()),
    [
      "2024-01-31T12:00:00.000Z",
      "2024-02-29T12:00:00.000Z",
      "2024-03-31T12:00:00.000Z"
    ]
  );
});

test("cuts old term add-ons at the next term start instead of retaining old grace", () => {
  const nextStartsAt = new Date("2026-09-01T00:00:00.000Z");
  const oldGrace = new Date("2026-09-04T00:00:00.000Z");
  assert.equal(cutoffCapacityGrantValidity(oldGrace, nextStartsAt).toISOString(), nextStartsAt.toISOString());
});

test("discovery captures unique sender-to-treasury transfers even when amount is wrong", () => {
  const hashes = matchBillingDiscoveryTransactionHashes({
    expectedSenderAddress: SENDER,
    recipientAddress: RECIPIENT,
    logs: [{
      args: { from: SENDER, to: RECIPIENT, value: 1n },
      transactionHash: HASH_A
    }]
  });
  assert.deepEqual(hashes, [HASH_A]);
});

test("discovery reports multiple sender candidates for manual review and ignores wrong treasury", () => {
  const hashes = matchBillingDiscoveryTransactionHashes({
    expectedSenderAddress: SENDER,
    recipientAddress: RECIPIENT,
    logs: [
      { args: { from: SENDER, to: RECIPIENT, value: 1n }, transactionHash: HASH_A },
      { args: { from: SENDER, to: RECIPIENT, value: 2n }, transactionHash: HASH_B },
      { args: { from: SENDER, to: "0x3333333333333333333333333333333333333333", value: 3n }, transactionHash: `0x${"cc".repeat(32)}` }
    ]
  });
  assert.deepEqual(hashes.sort(), [HASH_A, HASH_B].sort());
});

test("discovery assigns each transfer to exactly one checkout block window", () => {
  const assignments = assignBillingDiscoveryTransactionHashes({
    payments: [
      {
        id: "old",
        expectedSenderAddress: SENDER,
        treasuryAddress: RECIPIENT,
        scanFromBlock: 100n,
        createdAt: new Date("2026-08-01T00:00:00.000Z")
      },
      {
        id: "new",
        expectedSenderAddress: SENDER,
        treasuryAddress: RECIPIENT,
        scanFromBlock: 200n,
        createdAt: new Date("2026-08-03T00:00:00.000Z")
      }
    ],
    logs: [
      { args: { from: SENDER, to: RECIPIENT }, transactionHash: HASH_A, blockNumber: 150n },
      { args: { from: SENDER, to: RECIPIENT }, transactionHash: HASH_B, blockNumber: 200n }
    ]
  });
  assert.deepEqual(assignments.hashesByPaymentId.old, [HASH_A]);
  assert.deepEqual(assignments.hashesByPaymentId.new, [HASH_B]);
  assert.deepEqual(assignments.ambiguousPaymentIds, []);
});

test("discovery routes multiple hashes in the newest window only to that payment", () => {
  const assignments = assignBillingDiscoveryTransactionHashes({
    payments: [
      { id: "old", expectedSenderAddress: SENDER, treasuryAddress: RECIPIENT, scanFromBlock: 100n },
      { id: "new", expectedSenderAddress: SENDER, treasuryAddress: RECIPIENT, scanFromBlock: 200n }
    ],
    logs: [
      { args: { from: SENDER, to: RECIPIENT }, transactionHash: HASH_A, blockNumber: 210n },
      { args: { from: SENDER, to: RECIPIENT }, transactionHash: HASH_B, blockNumber: 211n }
    ]
  });
  assert.deepEqual(assignments.hashesByPaymentId.old, []);
  assert.deepEqual(assignments.hashesByPaymentId.new?.sort(), [HASH_A, HASH_B].sort());
});

test("discovery and reconcile CAS cannot regress paid or already verified state", async () => {
  const state = {
    orderStatus: "PAID",
    payment: { txHash: HASH_A, verificationAttempts: 1, verifiedAt: new Date("2026-08-01T12:00:00.000Z") }
  };
  const database = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const snapshot = { orderStatus: state.orderStatus, payment: { ...state.payment } };
      const tx = {
        billingOrder: {
          async updateMany({ where, data }: any) {
            const accepted = Array.isArray(where.status?.in)
              ? where.status.in.includes(state.orderStatus)
              : where.status === state.orderStatus;
            if (!accepted) return { count: 0 };
            state.orderStatus = data.status;
            return { count: 1 };
          }
        },
        billingOnchainPayment: {
          async updateMany({ where, data }: any) {
            if (where.txHash === null && state.payment.txHash !== null) return { count: 0 };
            if (typeof where.txHash === "string" && state.payment.txHash !== where.txHash) return { count: 0 };
            if (where.verifiedAt === null && state.payment.verifiedAt !== null) return { count: 0 };
            if (
              typeof where.verificationAttempts === "number"
              && state.payment.verificationAttempts !== where.verificationAttempts
            ) return { count: 0 };
            Object.assign(state.payment, data);
            return { count: 1 };
          }
        }
      };
      try {
        return await work(tx);
      } catch (error) {
        state.orderStatus = snapshot.orderStatus;
        state.payment = snapshot.payment;
        throw error;
      }
    }
  };

  assert.equal(await persistBillingDiscoveryTransition({
    database,
    paymentId: "payment_1",
    orderId: "order_1",
    expectedOrderStatus: "PENDING",
    orderStatus: "CONFIRMING",
    paymentStatusRaw: "transaction_discovered",
    paymentData: { txHash: HASH_B }
  }), false);
  assert.equal(state.orderStatus, "PAID");
  assert.equal(state.payment.txHash, HASH_A);

  state.orderStatus = "CONFIRMING";
  assert.equal(await persistBillingVerificationTransition({
    database,
    orderId: "order_1",
    txHash: HASH_A,
    expectedVerificationAttempts: 1,
    orderStatus: "REVIEW_REQUIRED",
    paymentStatusRaw: "stale_review",
    paymentData: { verificationAttempts: { increment: 1 }, lastError: "stale_review" }
  }), false);
  assert.equal(state.orderStatus, "CONFIRMING");
  assert.equal(state.payment.verifiedAt?.toISOString(), "2026-08-01T12:00:00.000Z");
});

test("migration enforces replay, concurrent-checkout and lifecycle idempotency constraints", async () => {
  const enumMigrationUrl = new URL(
    "../../../../prisma/migrations/20260801115900_arbitrum_usdc_billing_enums/migration.sql",
    import.meta.url
  );
  const migrationUrl = new URL(
    "../../../../prisma/migrations/20260801120000_arbitrum_usdc_billing/migration.sql",
    import.meta.url
  );
  const enumSql = await readFile(enumMigrationUrl, "utf8");
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(enumSql, /ALTER TYPE "BillingProvider" ADD VALUE IF NOT EXISTS 'ARBITRUM_USDC'/);
  assert.match(enumSql, /ALTER TYPE "BillingOrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMING'/);
  assert.doesNotMatch(sql, /ALTER TYPE "BillingProvider" ADD VALUE/);
  assert.match(sql, /billing_onchain_payments_tx_hash_key/);
  assert.match(sql, /billing_orders_one_open_arbitrum_usdc_user_idx/);
  assert.match(sql, /WHERE "provider" = 'ARBITRUM_USDC' AND "status" IN \('PENDING', 'CONFIRMING'\)/);
  assert.match(sql, /ai_token_ledger_idempotency_key_key/);
  assert.match(sql, /subscription_capacity_grants_source_key_key/);
  assert.match(sql, /subscription_terms_order_id_key/);
  assert.match(sql, /"failure_count" INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /billing_onchain_scan_cursors_retry_idx/);
  assert.match(sql, /'billingWebhookEnabled'/);
  assert.match(sql, /\{"billingEnabled": false\}/);
  assert.match(sql, /grant_row\."order_id" IS NOT NULL/);
  assert.match(sql, /grant_row\."valid_until" = term_row\."ends_at"/);
  assert.match(sql, /SET\s+"term_id" = term_row\."id",\s+"valid_until" = term_row\."grace_ends_at"/);
  assert.doesNotMatch(sql, /ELSE grant_row\."valid_until"/);
});

test("Premium foundation migration is additive and does not activate a package", async () => {
  const migrationUrl = new URL(
    "../../../../prisma/migrations/20260825120000_premium_plan_entitlement_foundation/migration.sql",
    import.meta.url
  );
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /ALTER TYPE "EffectivePlan" ADD VALUE IF NOT EXISTS 'PREMIUM'/);
  assert.match(sql, /ADD COLUMN "plan_valid_until" TIMESTAMP\(3\)/);
  assert.match(sql, /ADD COLUMN "max_exchange_accounts" INTEGER/);
  assert.match(sql, /ALTER TABLE "subscription_terms"\s+ADD COLUMN "plan" "EffectivePlan"/);
  assert.match(sql, /user_subscriptions_effective_plan_valid_until_idx/);
  assert.doesNotMatch(sql, /INSERT INTO "billing_packages"/);
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN|TYPE)/);
});

test("a crash after receipt persistence resumes idempotent finalization without another RPC receipt", () => {
  const interruptedOrder = {
    provider: "ARBITRUM_USDC",
    status: "CONFIRMING",
    onchainPayment: {
      verifiedAt: new Date("2026-08-01T12:00:00.000Z"),
      confirmations: 12,
      scanFromBlock: 100n,
      blockNumber: 101n
    }
  };
  assert.equal(shouldResumeVerifiedBillingPayment(interruptedOrder), true);
  assert.equal(
    getVerifiedBillingPaymentTimestamp(interruptedOrder)?.toISOString(),
    "2026-08-01T12:00:00.000Z"
  );
  assert.equal(
    shouldResumeVerifiedBillingPayment({
      ...interruptedOrder,
      onchainPayment: { ...interruptedOrder.onchainPayment, confirmations: 11 }
    }),
    false
  );
  assert.equal(
    shouldResumeVerifiedBillingPayment({
      ...interruptedOrder,
      onchainPayment: { ...interruptedOrder.onchainPayment, blockNumber: 99n }
    }),
    false
  );
  assert.equal(shouldResumeVerifiedBillingPayment({ ...interruptedOrder, status: "PAID" }), false);
});

test("stale missing hashes release checkout only after expiry and bounded attempts", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const expiredAt = new Date("2026-08-02T11:00:00.000Z");
  assert.equal(shouldEscalateMissingBillingTransaction({
    reason: "transaction_or_receipt_not_available",
    attempts: 20,
    expiresAt: expiredAt,
    now
  }), true);
  assert.equal(shouldEscalateMissingBillingTransaction({
    reason: "rpc_unavailable:timeout",
    attempts: 100,
    expiresAt: expiredAt,
    now
  }), false);
  assert.equal(shouldEscalateMissingBillingTransaction({
    reason: "transaction_or_receipt_not_available",
    attempts: 19,
    expiresAt: expiredAt,
    now
  }), false);
});

test("late-payment discovery remains open for seven days after expiry, then stops", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  assert.equal(
    isWithinLatePaymentRecoveryHorizon(new Date("2026-08-03T00:00:00.000Z"), now),
    true
  );
  assert.equal(
    isWithinLatePaymentRecoveryHorizon(new Date("2026-08-02T23:59:59.999Z"), now),
    false
  );
  assert.equal(
    isWithinLatePaymentRecoveryHorizon(new Date("2026-08-10T00:00:00.001Z"), now),
    false
  );
});

test("FREE and zero-value products are never purchasable checkout packages", () => {
  assert.deepEqual(buildActiveBillingPackageWhere(), {
    isActive: true,
    priceCents: { gt: 0 },
    NOT: { kind: "PLAN", plan: "FREE" }
  });
  assert.equal(isBillingPackagePurchasable({ kind: "PLAN", plan: "FREE", priceCents: 100 }), false);
  assert.equal(isBillingPackagePurchasable({ kind: "PLAN", plan: "PRO", priceCents: 2900 }), true);
  assert.equal(isBillingPackagePurchasable({ kind: "ADDON", plan: null, priceCents: 900 }), true);
  assert.equal(isBillingPackagePurchasable({ kind: "PLAN", plan: "PRO", priceCents: 0 }), false);
  assert.equal(isBillingPackagePurchasable({ kind: "ADDON", plan: null }), false);
});

test("cart totals fit Prisma Int and convert exactly to native USDC units", () => {
  assert.equal(calculateBillingCartAmountCents([{ lineAmountCents: 2_147_483_647 }]), 2_147_483_647);
  assert.equal(billingAmountCentsToUsdcRaw(2_147_483_647), 21_474_836_470_000n);
  assert.throws(
    () => calculateBillingCartAmountCents([{ lineAmountCents: 2_147_483_647 }, { lineAmountCents: 1 }]),
    /cart_total_out_of_range/
  );
  assert.equal(parseBillingDbBigInt("9007199254740993"), 9_007_199_254_740_993n);
  assert.throws(() => parseBillingDbBigInt("9223372036854775808"), /billing_integer_out_of_range/);
});

test("parallel distinct grants use atomic increments and preserve both credits", async () => {
  let balance = 100n;
  const ledger = new Map<string, unknown>();
  const tx = {
    aiCreditLedger: {
      async findUnique({ where }: any) {
        return ledger.has(where.idempotencyKey) ? { id: where.idempotencyKey } : null;
      },
      async create({ data }: any) {
        ledger.set(data.idempotencyKey, data);
        return data;
      }
    },
    userSubscription: {
      async updateMany({ where, data }: any) {
        await Promise.resolve();
        if (where.aiCreditBalance?.lte !== undefined && balance > BigInt(where.aiCreditBalance.lte)) return { count: 0 };
        balance += BigInt(data.aiCreditBalance.increment);
        return { count: 1 };
      },
      async findUnique() {
        return { aiCreditBalance: balance };
      }
    }
  };
  await Promise.all([
    applyAiLedgerCreditInTransaction({
      tx,
      userId: "user_1",
      subscriptionId: "sub_1",
      reason: "MONTHLY_GRANT",
      delta: 20n,
      idempotencyKey: "term:1:monthly:0",
      meta: {}
    }),
    applyAiLedgerCreditInTransaction({
      tx,
      userId: "user_1",
      subscriptionId: "sub_1",
      reason: "TOPUP",
      delta: 30n,
      idempotencyKey: "order:2:topup:0",
      meta: {}
    })
  ]);
  assert.equal(balance, 150n);
  assert.equal(ledger.size, 2);
});

test("AI credits fail atomically before signed 64-bit balance overflow", async () => {
  let balance = BILLING_DB_BIGINT_MAX - 5n;
  let ledgerWrites = 0;
  const tx = {
    aiCreditLedger: {
      async findUnique() { return null; },
      async create() { ledgerWrites += 1; }
    },
    userSubscription: {
      async updateMany({ where, data }: any) {
        if (balance > BigInt(where.aiCreditBalance.lte)) return { count: 0 };
        balance += BigInt(data.aiCreditBalance.increment);
        return { count: 1 };
      },
      async findUnique() { return { aiCreditBalance: balance }; }
    }
  };
  await assert.rejects(applyAiLedgerCreditInTransaction({
    tx,
    userId: "user_1",
    subscriptionId: "sub_1",
    reason: "TOPUP",
    delta: 10n,
    idempotencyKey: "overflow",
    meta: {}
  }), /ai_credit_balance_out_of_range/);
  assert.equal(balance, BILLING_DB_BIGINT_MAX - 5n);
  assert.equal(ledgerWrites, 0);
});

test("checkout requires a live Arbitrum chain and safe scan-start block", async () => {
  const client = {
    async getChainId() { return 42_161; },
    async getBlockNumber() { return 123_456n; },
    async getBytecode() { return "0x6000"; },
    async readContract() { return 6; }
  } as any;
  assert.equal(await requireLiveArbitrumBillingBlock(client), 123_456n);
  await assert.rejects(
    requireLiveArbitrumBillingBlock({ ...client, getChainId: async () => 1 }),
    /payment_config_not_ready/
  );
  await assert.rejects(
    requireLiveArbitrumBillingBlock({ ...client, getBlockNumber: async () => { throw new Error("rpc down"); } }),
    /rpc down/
  );
  await assert.rejects(
    requireLiveArbitrumBillingBlock({ ...client, getBytecode: async () => "0x" }),
    /billing_usdc_contract_code_missing/
  );
  await assert.rejects(
    inspectArbitrumUsdcRpc({ ...client, readContract: async () => 18 }),
    /billing_usdc_decimals_mismatch/
  );
});

test("serializable treasury rotation retries write conflicts instead of reusing revisions", async () => {
  let attempts = 0;
  const database = {
    async $transaction(work: (tx: any) => Promise<number>, options: any) {
      assert.equal(options.isolationLevel, "Serializable");
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("write conflict"), { code: "P2034" });
      return work({ revision: 2 });
    }
  };
  const result = await runSerializableBillingConfigTransaction(
    database,
    async (tx) => tx.revision
  );
  assert.equal(result, 2);
  assert.equal(attempts, 2);
});

test("failed entitlement sync remains dirty and the next lifecycle attempt clears it", async () => {
  const state = { pending: true, attempts: 0, error: null as string | null, syncedAt: null as Date | null };
  const database = {
    userSubscription: {
      async updateMany({ data }: any) {
        if (typeof data.entitlementSyncPending === "boolean") state.pending = data.entitlementSyncPending;
        if (data.entitlementSyncAttempts?.increment) state.attempts += data.entitlementSyncAttempts.increment;
        else if (typeof data.entitlementSyncAttempts === "number") state.attempts = data.entitlementSyncAttempts;
        if (data.entitlementSyncLastError !== undefined) state.error = data.entitlementSyncLastError;
        if (data.entitlementSyncedAt instanceof Date) state.syncedAt = data.entitlementSyncedAt;
        return { count: 1 };
      }
    }
  };
  assert.equal(await runTrackedWorkspaceEntitlementSync({
    database,
    userId: "user_1",
    sync: async () => { throw new Error("license db unavailable"); }
  }), false);
  assert.equal(state.pending, true);
  assert.equal(state.attempts, 1);
  assert.match(state.error ?? "", /license db unavailable/);

  assert.equal(await runTrackedWorkspaceEntitlementSync({
    database,
    userId: "user_1",
    sync: async () => undefined
  }), true);
  assert.equal(state.pending, false);
  assert.equal(state.attempts, 0);
  assert.equal(state.error, null);
  assert.ok(state.syncedAt instanceof Date);
});

test("discovery scans only the 12-confirmation safe head and overlaps prior blocks", () => {
  assert.deepEqual(getBillingDiscoveryScanRange({
    latestBlock: 111n,
    hintedStart: 50n
  }), { safeHead: 100n, fromBlock: 50n, toBlock: 100n });
  assert.deepEqual(getBillingDiscoveryScanRange({
    latestBlock: 111n,
    hintedStart: 50n,
    cursorLastScannedBlock: 90n
  }), { safeHead: 100n, fromBlock: 59n, toBlock: 100n });
  assert.equal(getBillingDiscoveryScanRange({
    latestBlock: 111n,
    hintedStart: 50n,
    cursorLastScannedBlock: 100n
  }), null);
  const now = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(billingDiscoveryRetryAt(1, now).getTime() - now.getTime(), 30_000);
  assert.equal(billingDiscoveryRetryAt(2, now).getTime() - now.getTime(), 60_000);
});

test("Treasury snapshot CAS refuses a rotated revision and embeds the guarded snapshot", async () => {
  let activeRevision = 2;
  let createdData: any = null;
  const database = {
    async $transaction(work: (tx: any) => Promise<any>) {
      return work({
        billingPaymentConfiguration: {
          async updateMany({ where }: any) {
            return { count: where.revision === activeRevision ? 1 : 0 };
          }
        },
        billingOrder: {
          async create({ data }: any) {
            createdData = data;
            return { id: "order_1", ...data };
          }
        }
      });
    }
  };
  await assert.rejects(createBillingOrderWithTreasurySnapshotCas({
    database,
    configuration: { treasuryAddress: RECIPIENT, revision: 1 },
    rpcCheckedBlock: 99n,
    scanFromBlock: 100n,
    orderData: { userId: "user_1", expectedSenderAddress: SENDER, expectedAmountRaw: 10n },
    include: {}
  }), /billing_payment_configuration_changed/);
  activeRevision = 2;
  await createBillingOrderWithTreasurySnapshotCas({
    database,
    configuration: { treasuryAddress: RECIPIENT, revision: 2 },
    rpcCheckedBlock: 100n,
    scanFromBlock: 101n,
    orderData: { userId: "user_1", expectedSenderAddress: SENDER, expectedAmountRaw: 10n },
    include: {}
  });
  assert.equal(createdData.onchainPayment.create.treasuryAddress, RECIPIENT);
  assert.equal(createdData.onchainPayment.create.treasuryConfigRevision, 2);
  assert.equal("expectedSenderAddress" in createdData, false);
});

test("confirmed deterministic finalization errors become review while transient DB errors remain retryable", async () => {
  let reviewReason: string | null = null;
  await assert.rejects(runConfirmedBillingFinalization({
    finalize: async () => { throw new Error("paid_plan_required_for_capacity_topup"); },
    markReviewRequired: async (reason) => { reviewReason = reason; }
  }), /review_required/);
  assert.equal(reviewReason, "paid_plan_required_for_capacity_topup");

  reviewReason = null;
  await assert.rejects(runConfirmedBillingFinalization({
    finalize: async () => { throw Object.assign(new Error("database timeout"), { code: "P1008" }); },
    markReviewRequired: async (reason) => { reviewReason = reason; }
  }), /database timeout/);
  assert.equal(reviewReason, null);
});

test("one corrupt payment cannot block later reconciliation rows", async () => {
  const tracked: string[] = [];
  const result = await reconcileBillingPaymentRows({
    rows: [{ orderId: "bad" }, { orderId: "paid" }, { orderId: "review" }],
    reconcile: async (row) => {
      if (row.orderId === "bad") throw new Error("corrupt_snapshot");
      if (row.orderId === "review") throw new Error("review_required");
      return { order: { status: "PAID" } };
    },
    onUnexpectedError: async (row) => { tracked.push(row.orderId); }
  });
  assert.deepEqual(result, { checked: 3, paid: 1, confirming: 0, reviewRequired: 1, retry: 1 });
  assert.deepEqual(tracked, ["bad"]);
});

test("paid term snapshots are excluded from mutable package live-sync", () => {
  assert.deepEqual(buildPlanPackageLiveSyncWhere("PRO"), {
    effectivePlan: "PRO",
    terms: { none: {} }
  });
  assert.deepEqual(buildPlanPackageLiveSyncWhere("PREMIUM"), {
    effectivePlan: "PREMIUM",
    terms: { none: {} }
  });
  assert.deepEqual(buildPlanPackageLiveSyncWhere("FREE"), { effectivePlan: "FREE" });
});

test("stored billing plans normalize Premium and unknown values fail safe", () => {
  assert.equal(formatPlan("PRO"), "pro");
  assert.equal(formatPlan("PREMIUM"), "premium");
  assert.equal(formatPlan("legacy_paid_unknown"), "free");
});

test("commercial entitlement sync keeps credits separate and preserves Enterprise", () => {
  assert.deepEqual(buildCommercialStrategyEntitlements("free"), {
    plan: "free",
    allowedStrategyKinds: ["local"],
    maxCompositeNodes: 0,
    aiAllowedModels: []
  });
  assert.deepEqual(buildCommercialStrategyEntitlements("premium"), {
    plan: "premium",
    allowedStrategyKinds: ["local", "ai", "composite"],
    maxCompositeNodes: 12,
    aiAllowedModels: ["*"]
  });
  assert.equal(isEnterpriseStrategyLicense("Enterprise"), true);
  assert.equal(isEnterpriseStrategyLicense("premium"), false);
});

test("admin adjustments and free minimum grants use atomic balance operations", async () => {
  let balance = 100n;
  const ledger = new Map<string, any>();
  const tx = {
    aiCreditLedger: {
      async findUnique({ where }: any) { return ledger.has(where.idempotencyKey) ? { id: "duplicate" } : null; },
      async create({ data }: any) { ledger.set(data.idempotencyKey, data); return data; }
    },
    userSubscription: {
      async findUnique() { return { aiCreditBalance: balance }; },
      async update({ data }: any) {
        await Promise.resolve();
        balance += BigInt(data.aiCreditBalance.increment);
        return { aiCreditBalance: balance };
      },
      async updateMany({ where, data }: any) {
        await Promise.resolve();
        if (where.aiCreditBalance?.gte !== undefined && balance < BigInt(where.aiCreditBalance.gte)) return { count: 0 };
        if (where.aiCreditBalance?.lte !== undefined && balance > BigInt(where.aiCreditBalance.lte)) return { count: 0 };
        if (typeof where.aiCreditBalance === "bigint" && balance !== where.aiCreditBalance) return { count: 0 };
        if (data.aiCreditBalance.decrement !== undefined) balance -= BigInt(data.aiCreditBalance.decrement);
        if (data.aiCreditBalance.increment !== undefined) balance += BigInt(data.aiCreditBalance.increment);
        return { count: 1 };
      }
    }
  };
  const [admin] = await Promise.all([
    applyAiCreditAdminAdjustmentInTransaction({ tx, subscriptionId: "sub_1", delta: -80n }),
    applyAiLedgerCreditInTransaction({
      tx,
      userId: "user_1",
      subscriptionId: "sub_1",
      reason: "TOPUP",
      delta: 30n,
      idempotencyKey: "credit:1",
      meta: {}
    })
  ]);
  assert.equal(admin.appliedDelta, -80n);
  assert.equal(balance, 50n);

  const exactLargeAdjustment = await applyAiCreditAdminAdjustmentInTransaction({
    tx,
    subscriptionId: "sub_1",
    delta: 9_007_199_254_740_993n
  });
  assert.equal(exactLargeAdjustment.appliedDelta, 9_007_199_254_740_993n);
  assert.equal(balance, 9_007_199_254_741_043n);

  balance = 20n;
  const minimum = await ensureAiCreditMinimumInTransaction({ tx, subscriptionId: "sub_1", minimum: 100n });
  assert.equal(minimum.granted, 80n);
  assert.equal(balance, 100n);
});

test("zero-value carts are rejected before an onchain order can be created", async () => {
  assert.throws(() => requirePayableBillingCartAmountCents(0), /cart_zero_amount_not_supported/);
  assert.throws(() => requirePayableBillingCartAmountCents(-1), /cart_zero_amount_not_supported/);
  assert.equal(requirePayableBillingCartAmountCents(1), 1);

  const source = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  assert.equal(source.includes("internal_zero_amount"), false);
  assert.ok(
    source.indexOf("requirePayableBillingCartAmountCents(calculateBillingCartAmountCents(lines))")
      < source.indexOf("findOpenArbitrumOrderForUser(params.userId, now)")
  );
});

test("term activation persists entitlements before independently retrying AI credits", async () => {
  const startsAt = new Date("2026-08-01T00:00:00.000Z");
  const term = {
    id: "term_1",
    userId: "user_1",
    subscriptionId: "sub_1",
    orderId: "order_1",
    startsAt,
    endsAt: new Date("2026-09-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-09-04T00:00:00.000Z"),
    entitlementSnapshot: {
      plan: "PRO",
      maxRunningBots: 4,
      maxRunningPredictionsAi: 3,
      maxRunningPredictionsComposite: 2,
      allowedExchanges: ["*"] ,
      monthlyAiCredits: "10",
      lines: [
        {
          quantity: 1,
          package: {
            id: "plan_1",
            code: "pro",
            kind: "plan",
            plan: "PRO",
            monthlyAiCredits: "10"
          }
        },
        {
          quantity: 1,
          package: {
            id: "credits_1",
            code: "credits",
            kind: "addon",
            addonType: "ai_credits",
            aiCredits: "3"
          }
        }
      ]
    }
  };
  let subscriptionData: any = null;
  let aiScheduleData: any = null;
  const tx = {
    subscriptionTerm: {
      async updateMany() { return { count: 1 }; },
      async findUnique() { return term; },
      async findMany() { return []; },
      async update({ data }: any) { aiScheduleData = data; return { ...term, ...data }; }
    },
    userSubscription: {
      async update({ data }: any) { subscriptionData = data; return data; }
    }
  };

  assert.equal(await activateSubscriptionTermInTransaction(tx, term.id, startsAt), true);
  assert.equal(subscriptionData.effectivePlan, "PRO");
  assert.equal(subscriptionData.monthlyAiCreditsIncluded, 10n);
  assert.equal(aiScheduleData.aiGrantCyclesApplied, 0);
  assert.equal(aiScheduleData.nextAiGrantAt.toISOString(), startsAt.toISOString());
  assert.equal("aiCreditLedger" in tx, false);
});

test("Premium term activation applies 15 exchange, 10/10/5 workflow quotas and schedules the 30k monthly credit cycle", async () => {
  const startsAt = new Date("2026-08-01T00:00:00.000Z");
  const term = {
    id: "term_premium",
    userId: "user_premium",
    subscriptionId: "sub_premium",
    orderId: "order_premium",
    plan: "PREMIUM",
    startsAt,
    endsAt: new Date("2026-09-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-09-04T00:00:00.000Z"),
    entitlementSnapshot: {
      plan: "PREMIUM",
      maxExchangeAccounts: 15,
      maxRunningBots: 10,
      maxRunningPredictionsAi: 10,
      maxRunningPredictionsComposite: 5,
      allowedExchanges: ["*"],
      monthlyAiCredits: "30000",
      lines: []
    }
  };
  let subscriptionData: any = null;
  let aiScheduleData: any = null;
  const tx = {
    subscriptionTerm: {
      async updateMany() { return { count: 1 }; },
      async findUnique() { return term; },
      async findMany() { return []; },
      async update({ data }: any) { aiScheduleData = data; return { ...term, ...data }; }
    },
    userSubscription: {
      async update({ data }: any) { subscriptionData = data; return data; }
    }
  };

  assert.equal(await activateSubscriptionTermInTransaction(tx, term.id, startsAt), true);
  assert.equal(subscriptionData.effectivePlan, "PREMIUM");
  assert.equal(subscriptionData.maxExchangeAccounts, 15);
  assert.equal(subscriptionData.maxRunningBots, 10);
  assert.equal(subscriptionData.maxRunningPredictionsAi, 10);
  assert.equal(subscriptionData.maxRunningPredictionsComposite, 5);
  assert.equal(subscriptionData.monthlyAiCreditsIncluded, 30_000n);
  assert.equal(aiScheduleData.aiGrantCyclesApplied, 0);
  assert.equal(aiScheduleData.nextAiGrantAt.toISOString(), startsAt.toISOString());
  assert.equal("aiCreditLedger" in tx, false);
});

test("a failed AI cycle rolls back its due marker and retries both scheduled credits idempotently", async () => {
  const startsAt = new Date("2026-08-01T00:00:00.000Z");
  const state = {
    term: {
      id: "term_1",
      userId: "user_1",
      subscriptionId: "sub_1",
      orderId: "order_1",
      status: "ACTIVE",
      startsAt,
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
      graceEndsAt: new Date("2026-10-04T00:00:00.000Z"),
      activatedAt: startsAt,
      nextAiGrantAt: startsAt,
      aiGrantCyclesApplied: 0,
      monthlyAiCredits: 10n,
      entitlementSnapshot: {
        plan: "PRO",
        monthlyAiCredits: "10",
        lines: [{
          quantity: 1,
          package: {
            id: "credits_1",
            code: "credits",
            kind: "addon",
            addonType: "ai_credits",
            aiCredits: "3"
          }
        }]
      }
    },
    balance: BILLING_DB_BIGINT_MAX - 5n,
    ledger: new Map<string, any>()
  };
  const cloneTerm = () => ({
    ...state.term,
    startsAt: new Date(state.term.startsAt),
    endsAt: new Date(state.term.endsAt),
    graceEndsAt: new Date(state.term.graceEndsAt),
    activatedAt: new Date(state.term.activatedAt),
    nextAiGrantAt: state.term.nextAiGrantAt ? new Date(state.term.nextAiGrantAt) : null
  });
  const database = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const working = {
        term: cloneTerm(),
        balance: state.balance,
        ledger: new Map(state.ledger)
      };
      const tx = {
        subscriptionTerm: {
          async findUnique() { return working.term; },
          async updateMany({ where, data }: any) {
            if (
              working.term.id !== where.id
              || working.term.aiGrantCyclesApplied !== where.aiGrantCyclesApplied
              || working.term.nextAiGrantAt?.getTime() !== where.nextAiGrantAt?.getTime()
            ) return { count: 0 };
            Object.assign(working.term, data);
            return { count: 1 };
          }
        },
        userSubscription: {
          async updateMany({ where, data }: any) {
            if (working.balance > BigInt(where.aiCreditBalance.lte)) return { count: 0 };
            working.balance += BigInt(data.aiCreditBalance.increment);
            return { count: 1 };
          },
          async findUnique() { return { aiCreditBalance: working.balance }; }
        },
        aiCreditLedger: {
          async findUnique({ where }: any) {
            return working.ledger.has(where.idempotencyKey) ? { id: where.idempotencyKey } : null;
          },
          async create({ data }: any) {
            working.ledger.set(data.idempotencyKey, data);
            return data;
          }
        }
      };
      const result = await work(tx);
      state.term = working.term as typeof state.term;
      state.balance = working.balance;
      state.ledger = working.ledger;
      return result;
    }
  };

  await assert.rejects(
    runDueSubscriptionTermAiCycle(database, state.term.id, startsAt),
    /ai_credit_balance_out_of_range/
  );
  assert.equal(state.term.aiGrantCyclesApplied, 0);
  assert.equal(state.term.nextAiGrantAt?.toISOString(), startsAt.toISOString());
  assert.equal(state.ledger.size, 0);

  state.balance = 0n;
  assert.equal(await runDueSubscriptionTermAiCycle(database, state.term.id, startsAt), true);
  assert.equal(state.balance, 13n);
  assert.equal(state.term.aiGrantCyclesApplied, 1);
  assert.deepEqual([...state.ledger.keys()].sort(), [
    "term:term_1:monthly:0",
    "term:term_1:topup:0"
  ]);
  assert.equal(await runDueSubscriptionTermAiCycle(database, state.term.id, startsAt), false);
});

test("failed AI grant rows rotate fairly and persist an operator-visible alert", async () => {
  assert.deepEqual(buildDueSubscriptionAiGrantOrderBy(), [
    { updatedAt: "asc" },
    { nextAiGrantAt: "asc" },
    { id: "asc" }
  ]);
  const now = new Date("2026-08-01T12:00:00.000Z");
  const dueAt = new Date("2026-08-01T00:00:00.000Z");
  let retryData: any = null;
  let alertData: any = null;
  await persistSubscriptionAiGrantFailure({
    database: {
      subscriptionTerm: {
        async updateMany({ data }: any) { retryData = data; return { count: 1 }; }
      },
      platformAlert: {
        async findFirst() { return null; },
        async create({ data }: any) { alertData = data; return data; }
      }
    },
    term: { id: "term_poison", userId: "user_1", nextAiGrantAt: dueAt },
    now,
    error: new Error("ai_credit_balance_out_of_range")
  });
  assert.deepEqual(retryData, { updatedAt: now });
  assert.equal(alertData.type, "subscription_ai_credit_failed");
  assert.equal(alertData.source, "billing_subscription_lifecycle");
  assert.equal(alertData.userId, "user_1");
  assert.equal(alertData.metadata.nextAiGrantAt, dueAt.toISOString());
  assert.match(alertData.metadata.reason, /ai_credit_balance_out_of_range/);
});

test("an overdue paid term is activated before a capacity add-on selects its target", async () => {
  const now = new Date("2026-09-01T00:00:01.000Z");
  const activeTerm = {
    id: "term_new",
    status: "ACTIVE",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-10-04T00:00:00.000Z")
  };
  let activatedId: string | null = null;
  const target = await resolveCapacityAddonTargetTermInTransaction({
    tx: {
      subscriptionTerm: {
        async findMany() { return [{ id: "term_new" }]; },
        async findFirst() { return activeTerm; }
      }
    },
    userId: "user_1",
    now,
    activate: async (_tx, termId) => {
      activatedId = termId;
      return true;
    }
  });
  assert.equal(activatedId, "term_new");
  assert.equal(target.term.id, "term_new");
  assert.equal(target.activated, 1);
  assert.equal(hasPaidCapacityAddonTarget(target.term, "FREE"), true);
  assert.equal(hasPaidCapacityAddonTarget(null, "PRO"), true);
  assert.equal(hasPaidCapacityAddonTarget(null, "PREMIUM"), true);
  assert.equal(hasPaidCapacityAddonTarget(null, "FREE"), false);
});

test("billing finalization only claims confirming orders and treats a concurrent paid winner as success", async () => {
  assert.equal(resolveBillingOrderFinalizationDecision("CONFIRMING"), "finalize");
  assert.equal(resolveBillingOrderFinalizationDecision("PAID"), "already_paid");
  assert.throws(() => resolveBillingOrderFinalizationDecision("REVIEW_REQUIRED"), /review_required/);
  assert.throws(() => resolveBillingOrderFinalizationDecision("PENDING"), /order_not_payable/);

  let reviewAttempts = 0;
  await runConfirmedBillingFinalization({
    finalize: async () => { throw new Error("paid_plan_required_for_capacity_topup"); },
    markReviewRequired: async () => { reviewAttempts += 1; return false; },
    resolveTerminalStatus: async () => "PAID"
  });
  assert.equal(reviewAttempts, 1);

  reviewAttempts = 0;
  await runConfirmedBillingFinalization({
    finalize: async () => { throw new Error("billing_finalization_cas_lost"); },
    markReviewRequired: async () => { reviewAttempts += 1; },
    resolveTerminalStatus: async () => "PAID"
  });
  assert.equal(reviewAttempts, 0);
});

test("optional admin package credit fields default on create and preserve existing values on update", () => {
  assert.deepEqual(resolveBillingPackageCreditAmounts({
    isPlan: true,
    addonType: null
  }), { monthlyAiCredits: 0n, aiCredits: 0n });
  assert.deepEqual(resolveBillingPackageCreditAmounts({
    isPlan: false,
    addonType: "ai_credits"
  }), { monthlyAiCredits: 0n, aiCredits: 0n });
  assert.deepEqual(resolveBillingPackageCreditAmounts({
    isPlan: true,
    addonType: null,
    existing: { monthlyAiCredits: 123n, aiCredits: 999n }
  }), { monthlyAiCredits: 123n, aiCredits: 0n });
  assert.deepEqual(resolveBillingPackageCreditAmounts({
    isPlan: false,
    addonType: "ai_credits",
    existing: { monthlyAiCredits: 999n, aiCredits: 456n }
  }), { monthlyAiCredits: 0n, aiCredits: 456n });
});

test("discovery retries a PENDING to EXPIRED CAS race for hash and ambiguity candidates", async (t) => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const expiresAt = new Date("2026-08-02T12:00:00.000Z");
  const createStatusFlipDatabase = () => {
    const state: {
      orderStatus: string;
      paymentStatusRaw: string | null;
      txHash: string | null;
      paymentData: Record<string, unknown>;
      transactionCalls: number;
    } = {
      orderStatus: "PENDING",
      paymentStatusRaw: null,
      txHash: null,
      paymentData: {},
      transactionCalls: 0
    };
    const database = {
      async $transaction(work: (tx: any) => Promise<any>) {
        state.transactionCalls += 1;
        return work({
          billingOrder: {
            async updateMany({ where, data }: any) {
              if (state.transactionCalls === 1) state.orderStatus = "EXPIRED";
              if (where.status !== state.orderStatus) return { count: 0 };
              state.orderStatus = data.status;
              state.paymentStatusRaw = data.paymentStatusRaw;
              return { count: 1 };
            }
          },
          billingOnchainPayment: {
            async updateMany({ where, data }: any) {
              if (where.txHash === null && state.txHash !== null) return { count: 0 };
              state.paymentData = { ...state.paymentData, ...data };
              if (typeof data.txHash === "string") state.txHash = data.txHash;
              return { count: 1 };
            }
          }
        });
      },
      billingOnchainPayment: {
        async findUnique() {
          return {
            orderId: "order_1",
            txHash: state.txHash,
            order: { id: "order_1", status: state.orderStatus, expiresAt }
          };
        }
      }
    };
    return { database, state };
  };

  await t.test("unique hash is retained and late-routed after expiry wins the race", async () => {
    const { database, state } = createStatusFlipDatabase();
    const result = await persistBillingDiscoveryCandidate({
      database,
      paymentId: "payment_1",
      orderId: "order_1",
      expectedOrderStatus: "PENDING",
      expectedExpiresAt: expiresAt,
      now,
      candidate: { kind: "hash", txHash: HASH_A }
    });
    assert.deepEqual(result, { applied: true, outcome: "review_required" });
    assert.equal(state.transactionCalls, 2);
    assert.equal(state.orderStatus, "REVIEW_REQUIRED");
    assert.equal(state.paymentStatusRaw, "late_payment_discovered");
    assert.equal(state.txHash, HASH_A);
  });

  await t.test("ambiguous assignment is retried against the current expired status", async () => {
    const { database, state } = createStatusFlipDatabase();
    const result = await persistBillingDiscoveryCandidate({
      database,
      paymentId: "payment_1",
      orderId: "order_1",
      expectedOrderStatus: "PENDING",
      expectedExpiresAt: expiresAt,
      now,
      candidate: { kind: "review", reason: "multiple_candidate_transactions" }
    });
    assert.deepEqual(result, { applied: true, outcome: "review_required" });
    assert.equal(state.transactionCalls, 2);
    assert.equal(state.orderStatus, "REVIEW_REQUIRED");
    assert.equal(state.paymentStatusRaw, "multiple_candidate_transactions");
    assert.equal(state.txHash, null);
  });

  await t.test("a second unresolved CAS aborts the scope instead of permitting cursor advancement", async () => {
    const database = {
      async $transaction(work: (tx: any) => Promise<any>) {
        return work({
          billingOrder: { async updateMany() { return { count: 0 }; } },
          billingOnchainPayment: { async updateMany() { return { count: 0 }; } }
        });
      },
      billingOnchainPayment: {
        async findUnique() {
          return {
            orderId: "order_1",
            txHash: null,
            order: { id: "order_1", status: "PENDING", expiresAt }
          };
        }
      }
    };
    await assert.rejects(persistBillingDiscoveryCandidate({
      database,
      paymentId: "payment_1",
      orderId: "order_1",
      expectedOrderStatus: "PENDING",
      expectedExpiresAt: expiresAt,
      now,
      candidate: { kind: "hash", txHash: HASH_A }
    }), /billing_discovery_scope_unresolved/);
  });
});

test("partial billing feature updates preserve unspecified current flags", () => {
  assert.deepEqual(mergeBillingFeatureFlags(
    { billingEnabled: true, aiCreditBillingEnabled: false },
    { billingEnabled: false }
  ), { billingEnabled: false, aiCreditBillingEnabled: false });
  assert.deepEqual(mergeBillingFeatureFlags(
    { billingEnabled: true, aiCreditBillingEnabled: false },
    { aiCreditBillingEnabled: true }
  ), { billingEnabled: true, aiCreditBillingEnabled: true });
  assert.deepEqual(mergeBillingFeatureFlags(
    { billingEnabled: true, aiCreditBillingEnabled: false },
    {}
  ), { billingEnabled: true, aiCreditBillingEnabled: false });
});

test("active paid packages require a positive price and a meaningful add-on value", () => {
  const pro = {
    isActive: true,
    kind: "PLAN" as const,
    plan: "PRO" as const,
    addonType: null,
    priceCents: 2900,
    aiCredits: 0n,
    deltaRunningBots: 0,
    deltaRunningPredictionsAi: 0,
    deltaRunningPredictionsComposite: 0
  };
  assert.doesNotThrow(() => validateBillingPackageConfiguration(pro));
  assert.throws(
    () => validateBillingPackageConfiguration({ ...pro, priceCents: 0 }),
    /package_active_price_required/
  );
  assert.doesNotThrow(() => validateBillingPackageConfiguration({
    ...pro,
    plan: "PREMIUM",
    priceCents: 6900
  }));
  assert.throws(
    () => validateBillingPackageConfiguration({ ...pro, plan: "PREMIUM", priceCents: 0 }),
    /package_active_price_required/
  );
  assert.doesNotThrow(() => validateBillingPackageConfiguration({
    ...pro,
    plan: "FREE",
    priceCents: 0
  }));

  const addon = {
    isActive: true,
    kind: "ADDON" as const,
    plan: null,
    addonType: "RUNNING_BOTS" as const,
    priceCents: 900,
    aiCredits: 0n,
    deltaRunningBots: 1,
    deltaRunningPredictionsAi: 0,
    deltaRunningPredictionsComposite: 0
  };
  assert.doesNotThrow(() => validateBillingPackageConfiguration(addon));
  assert.throws(
    () => validateBillingPackageConfiguration({ ...addon, priceCents: 0 }),
    /package_active_price_required/
  );
  assert.throws(
    () => validateBillingPackageConfiguration({ ...addon, deltaRunningBots: 0 }),
    /package_addon_value_required/
  );
  assert.doesNotThrow(() => validateBillingPackageConfiguration({
    ...addon,
    addonType: "AI_CREDITS",
    deltaRunningBots: 0,
    aiCredits: 1n
  }));
  assert.throws(() => validateBillingPackageConfiguration({
    ...addon,
    addonType: "AI_CREDITS",
    deltaRunningBots: 0,
    aiCredits: 0n
  }), /package_addon_value_required/);
  assert.doesNotThrow(() => validateBillingPackageConfiguration({
    ...addon,
    isActive: false,
    priceCents: 0,
    deltaRunningBots: 0
  }));
});

test("discovery fixes the safe head before its final scope snapshot and guards cursor advancement", async () => {
  const calls: string[] = [];
  const payments = [{ id: "payment_old", scanFromBlock: 50n }];
  const captured = await captureBillingDiscoveryScopeAfterHead({
    getLatestBlock: async () => {
      calls.push("head");
      // A checkout created immediately after this fixed head uses a later RPC
      // head + 1, so it cannot have a transfer inside the old safe range.
      payments.push({ id: "payment_new", scanFromBlock: 112n });
      return 111n;
    },
    loadScopedPayments: async () => {
      calls.push("payments");
      return [...payments];
    }
  });
  assert.deepEqual(calls, ["head", "payments"]);
  assert.deepEqual(captured.scopedPayments.map((payment) => payment.id), ["payment_old", "payment_new"]);
  const range = getBillingDiscoveryScanRange({
    latestBlock: captured.latestBlock,
    hintedStart: 50n
  });
  assert.equal(range?.safeHead, 100n);
  assert.ok(captured.scopedPayments[1]!.scanFromBlock > range!.toBlock);

  const scope = {
    chainId: 42161,
    tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    treasuryAddress: RECIPIENT
  };
  const recoveryCutoff = new Date("2026-07-25T00:00:00.000Z");
  let capturedWhere: any = null;
  await assert.rejects(assertBillingDiscoveryScopeStableBeforeCursor({
    database: {
      billingOnchainPayment: {
        async findMany({ where }: any) {
          capturedWhere = where;
          return [{ id: "payment_old" }, { id: "payment_raced" }];
        }
      }
    },
    scope,
    recoveryCutoff,
    rangeToBlock: 100n,
    snapshotPaymentIds: ["payment_old"]
  }), /billing_discovery_scope_changed/);
  assert.deepEqual(capturedWhere.scanFromBlock, { lte: 100n });
  assert.deepEqual(capturedWhere.order, {
    status: { in: ["PENDING", "EXPIRED"] },
    expiresAt: { gte: recoveryCutoff }
  });

  await assert.doesNotReject(assertBillingDiscoveryScopeStableBeforeCursor({
    database: {
      billingOnchainPayment: {
        async findMany() { return [{ id: "payment_old" }]; }
      }
    },
    scope,
    recoveryCutoff,
    rangeToBlock: 100n,
    snapshotPaymentIds: ["payment_old"]
  }));

  const source = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  const guardCall = source.indexOf("await assertBillingDiscoveryScopeStableBeforeCursor({");
  const cursorAdvance = source.indexOf("await db.billingOnchainScanCursor.upsert({", guardCall);
  assert.ok(guardCall >= 0 && cursorAdvance > guardCall);
});

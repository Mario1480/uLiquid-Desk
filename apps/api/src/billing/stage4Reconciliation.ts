import { isDeepStrictEqual } from "node:util";
import {
  CANONICAL_STAGE4_PACKAGES,
  canonicalPackageByCode,
  type CanonicalBillingPackage
} from "./canonicalPackages.js";

export const STAGE4_RECONCILIATION_VERSION = "premium-plan-gating-stage4-v1";
const RECONCILABLE_TERM_STATUSES = new Set(["SCHEDULED", "ACTIVE", "GRACE"]);

type StoredPlan = "FREE" | "PRO" | "PREMIUM";

export type Stage4ReviewItem = {
  entity: "subscription_term" | "user_subscription" | "billing_package";
  id: string;
  userId?: string;
  reason: string;
  evidence?: Record<string, unknown>;
};

export type Stage4Mutation = {
  entity: "subscription_term" | "user_subscription" | "billing_package";
  id: string;
  userId?: string;
  changedFields: string[];
  data: Record<string, unknown>;
  expectedUpdatedAt?: Date;
};

export type Stage4ReconciliationReport = {
  version: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  packages: { scanned: number; create: number; update: number; unchanged: number; applied: number };
  terms: { scanned: number; update: number; unchanged: number; review: number; applied: number };
  subscriptions: { scanned: number; update: number; unchanged: number; review: number; applied: number };
  aggregates: {
    terms: { before: Stage4EntitlementAggregate; projectedAfter: Stage4EntitlementAggregate };
    subscriptions: { before: Stage4EntitlementAggregate; projectedAfter: Stage4EntitlementAggregate };
  };
  changes: Array<Pick<Stage4Mutation, "entity" | "id" | "userId" | "changedFields">>;
  reviews: Stage4ReviewItem[];
};

export type Stage4EntitlementAggregate = {
  rows: number;
  byPlan: Record<string, number>;
  byStatus: Record<string, number>;
  unlimitedExchangeAccountRows: number;
  limitedExchangeAccountsTotal: number;
  runningBotsTotal: number;
  runningPredictionsAiTotal: number;
  runningPredictionsCompositeTotal: number;
  monthlyAiCreditsTotal: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedPlan(value: unknown): StoredPlan | null {
  return value === "FREE" || value === "PRO" || value === "PREMIUM" ? value : null;
}

function packagePlanFromCode(value: unknown): StoredPlan | null {
  const code = String(value ?? "").trim().toLowerCase();
  if (code === "free") return "FREE";
  if (code === "pro_monthly") return "PRO";
  if (code === "premium_monthly") return "PREMIUM";
  return null;
}

function serializeComparable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeComparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializeComparable(item)]));
  }
  return value;
}

function safeNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeNonNegativeBigInt(value: unknown): bigint {
  try {
    const parsed = BigInt(value == null ? 0 : value as any);
    return parsed >= 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function buildEntitlementAggregate(rows: any[], entity: "term" | "subscription"): Stage4EntitlementAggregate {
  const aggregate: Stage4EntitlementAggregate = {
    rows: rows.length,
    byPlan: {},
    byStatus: {},
    unlimitedExchangeAccountRows: 0,
    limitedExchangeAccountsTotal: 0,
    runningBotsTotal: 0,
    runningPredictionsAiTotal: 0,
    runningPredictionsCompositeTotal: 0,
    monthlyAiCreditsTotal: "0"
  };
  let credits = 0n;
  for (const row of rows) {
    const snapshot = entity === "term" ? asRecord(row.entitlementSnapshot) : row;
    const plan = entity === "term"
      ? classifySubscriptionTermPlan(row).plan ?? "UNCLASSIFIED"
      : storedPlan(row.effectivePlan) ?? "UNCLASSIFIED";
    const status = String(row.status ?? "UNKNOWN");
    aggregate.byPlan[plan] = (aggregate.byPlan[plan] ?? 0) + 1;
    aggregate.byStatus[status] = (aggregate.byStatus[status] ?? 0) + 1;
    const maxExchangeAccounts = snapshot.maxExchangeAccounts;
    if (maxExchangeAccounts === null) aggregate.unlimitedExchangeAccountRows += 1;
    else aggregate.limitedExchangeAccountsTotal += safeNonNegativeInt(maxExchangeAccounts);
    aggregate.runningBotsTotal += safeNonNegativeInt(snapshot.maxRunningBots);
    aggregate.runningPredictionsAiTotal += safeNonNegativeInt(snapshot.maxRunningPredictionsAi);
    aggregate.runningPredictionsCompositeTotal += safeNonNegativeInt(snapshot.maxRunningPredictionsComposite);
    credits += safeNonNegativeBigInt(
      entity === "term" ? row.monthlyAiCredits : row.monthlyAiCreditsIncluded
    );
  }
  aggregate.monthlyAiCreditsTotal = credits.toString();
  return aggregate;
}

function projectRows(rows: any[], mutations: Stage4Mutation[]): any[] {
  const mutationsById = new Map(mutations.map((mutation) => [mutation.id, mutation.data]));
  return rows.map((row) => ({ ...row, ...(mutationsById.get(String(row.id)) ?? {}) }));
}

function canonicalPackageData(item: CanonicalBillingPackage, existingMeta?: unknown): Record<string, unknown> {
  const priorMeta = asRecord(existingMeta);
  return {
    name: item.name,
    description: item.description,
    kind: item.kind,
    addonType: item.addonType,
    isActive: item.isActive,
    sortOrder: item.sortOrder,
    priceCents: item.priceCents,
    billingMonths: item.billingMonths,
    plan: item.plan,
    maxExchangeAccounts: item.maxExchangeAccounts,
    maxRunningBots: item.maxRunningBots,
    maxRunningPredictionsAi: item.maxRunningPredictionsAi,
    maxRunningPredictionsComposite: item.maxRunningPredictionsComposite,
    allowedExchanges: [...item.allowedExchanges],
    monthlyAiCredits: item.monthlyAiCredits,
    aiCredits: item.aiCredits,
    deltaRunningBots: item.deltaRunningBots,
    deltaRunningPredictionsAi: item.deltaRunningPredictionsAi,
    deltaRunningPredictionsComposite: item.deltaRunningPredictionsComposite,
    meta: item.meta ? { ...priorMeta, ...item.meta } : (Object.keys(priorMeta).length > 0 ? priorMeta : null)
  };
}

const PACKAGE_COMPARE_FIELDS = [
  "name", "description", "kind", "addonType", "isActive", "sortOrder", "priceCents", "billingMonths",
  "plan", "maxExchangeAccounts", "maxRunningBots", "maxRunningPredictionsAi",
  "maxRunningPredictionsComposite", "allowedExchanges", "monthlyAiCredits", "aiCredits",
  "deltaRunningBots", "deltaRunningPredictionsAi", "deltaRunningPredictionsComposite", "meta"
] as const;

export function buildCanonicalPackageMutations(existingRows: any[]): Stage4Mutation[] {
  const existing = new Map(existingRows.map((row) => [String(row.code), row]));
  const mutations: Stage4Mutation[] = [];
  for (const item of CANONICAL_STAGE4_PACKAGES) {
    const row = existing.get(item.code);
    const data = canonicalPackageData(item, row?.meta);
    if (!row) {
      mutations.push({
        entity: "billing_package",
        id: item.code,
        changedFields: ["create"],
        data: { code: item.code, ...data }
      });
      continue;
    }
    const changedFields = PACKAGE_COMPARE_FIELDS.filter((key) => (
      !isDeepStrictEqual(serializeComparable(row[key]), serializeComparable(data[key]))
    ));
    if (changedFields.length > 0) {
      mutations.push({
        entity: "billing_package",
        id: String(row.id),
        changedFields: [...changedFields],
        data
      });
    }
  }
  return mutations;
}

export function classifySubscriptionTermPlan(term: any): {
  plan: StoredPlan | null;
  evidence: Record<string, unknown>;
  reason: string | null;
} {
  const snapshot = asRecord(term?.entitlementSnapshot);
  const candidates = new Set<StoredPlan>();
  const typedPlan = storedPlan(term?.plan);
  const snapshotPlan = storedPlan(snapshot.plan);
  const snapshotPackagePlan = packagePlanFromCode(snapshot.packageCode);
  if (typedPlan) candidates.add(typedPlan);
  if (snapshotPlan) candidates.add(snapshotPlan);
  if (snapshotPackagePlan) candidates.add(snapshotPackagePlan);

  const orderPlans: StoredPlan[] = [];
  for (const item of Array.isArray(term?.order?.items) ? term.order.items : []) {
    const itemSnapshot = asRecord(item?.packageSnapshot);
    const kind = item?.kindSnapshot ?? itemSnapshot.kind ?? item?.pkg?.kind;
    if (kind !== "PLAN" && kind !== "plan") continue;
    const candidate = storedPlan(itemSnapshot.plan)
      ?? storedPlan(item?.pkg?.plan)
      ?? packagePlanFromCode(itemSnapshot.code)
      ?? packagePlanFromCode(item?.pkg?.code);
    if (candidate) {
      candidates.add(candidate);
      orderPlans.push(candidate);
    }
  }

  const evidence = {
    typedPlan,
    snapshotPlan,
    snapshotPackageCode: snapshot.packageCode ?? null,
    snapshotPackagePlan,
    orderPlans
  };
  if (candidates.size === 0) return { plan: null, evidence, reason: "term_plan_unclassified" };
  if (candidates.size > 1) return { plan: null, evidence, reason: "term_plan_conflict" };
  return { plan: [...candidates][0], evidence, reason: null };
}

function canonicalProTermSnapshot(snapshotValue: unknown): Record<string, unknown> {
  const snapshot = asRecord(snapshotValue);
  const canonical = canonicalPackageByCode("pro_monthly");
  return {
    ...snapshot,
    schemaVersion: "billing-entitlement/v2",
    reconciliationVersion: STAGE4_RECONCILIATION_VERSION,
    plan: "PRO",
    packageCode: String(snapshot.packageCode ?? canonical.code),
    billingMonths: canonical.billingMonths,
    priceCents: canonical.priceCents,
    maxExchangeAccounts: canonical.maxExchangeAccounts,
    maxRunningBots: canonical.maxRunningBots,
    maxRunningPredictionsAi: canonical.maxRunningPredictionsAi,
    maxRunningPredictionsComposite: canonical.maxRunningPredictionsComposite,
    allowedExchanges: [...canonical.allowedExchanges],
    monthlyAiCredits: canonical.monthlyAiCredits.toString()
  };
}

export function buildStage4TermDecision(term: any): { mutation: Stage4Mutation | null; review: Stage4ReviewItem | null } {
  const classification = classifySubscriptionTermPlan(term);
  if (!classification.plan) {
    return {
      mutation: null,
      review: {
        entity: "subscription_term",
        id: String(term.id),
        userId: term.userId ? String(term.userId) : undefined,
        reason: classification.reason ?? "term_plan_unclassified",
        evidence: classification.evidence
      }
    };
  }

  const data: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if (term.plan !== classification.plan) {
    data.plan = classification.plan;
    changedFields.push("plan");
  }
  if (classification.plan === "PRO" && RECONCILABLE_TERM_STATUSES.has(String(term.status))) {
    const snapshot = canonicalProTermSnapshot(term.entitlementSnapshot);
    if (!isDeepStrictEqual(serializeComparable(term.entitlementSnapshot), serializeComparable(snapshot))) {
      data.entitlementSnapshot = snapshot;
      changedFields.push("entitlementSnapshot");
    }
    if (BigInt(term.monthlyAiCredits ?? 0) !== 10_000n) {
      data.monthlyAiCredits = 10_000n;
      changedFields.push("monthlyAiCredits");
    }
  }

  return {
    mutation: changedFields.length > 0 ? {
      entity: "subscription_term",
      id: String(term.id),
      userId: term.userId ? String(term.userId) : undefined,
      changedFields,
      data,
      ...(term.updatedAt instanceof Date ? { expectedUpdatedAt: term.updatedAt } : {})
    } : null,
    review: null
  };
}

function latestPaidTermEnd(terms: any[], plan: StoredPlan): Date | null {
  let latest: Date | null = null;
  for (const term of terms) {
    const classification = classifySubscriptionTermPlan(term);
    if (classification.plan !== plan || !RECONCILABLE_TERM_STATUSES.has(String(term.status))) continue;
    const end = term.endsAt instanceof Date ? term.endsAt : new Date(String(term.endsAt));
    if (Number.isNaN(end.getTime())) continue;
    if (!latest || end > latest) latest = end;
  }
  return latest;
}

export function buildStage4SubscriptionDecision(subscription: any): { mutation: Stage4Mutation | null; review: Stage4ReviewItem | null } {
  const plan = storedPlan(subscription.effectivePlan);
  if (!plan) {
    return {
      mutation: null,
      review: {
        entity: "user_subscription",
        id: String(subscription.id),
        userId: String(subscription.userId),
        reason: "subscription_plan_unclassified",
        evidence: { effectivePlan: subscription.effectivePlan ?? null }
      }
    };
  }
  if (plan === "PREMIUM") return { mutation: null, review: null };
  if (plan === "PRO" && !RECONCILABLE_TERM_STATUSES.has(String(subscription.status))) {
    return { mutation: null, review: null };
  }

  const canonical = canonicalPackageByCode(plan === "FREE" ? "free" : "pro_monthly");
  const target: Record<string, unknown> = {
    maxExchangeAccounts: canonical.maxExchangeAccounts,
    maxRunningBots: canonical.maxRunningBots,
    maxRunningPredictionsAi: canonical.maxRunningPredictionsAi,
    maxRunningPredictionsComposite: canonical.maxRunningPredictionsComposite,
    allowedExchanges: [...canonical.allowedExchanges],
    monthlyAiCreditsIncluded: canonical.monthlyAiCredits
  };
  if (plan === "PRO") {
    const latestEnd = latestPaidTermEnd(Array.isArray(subscription.terms) ? subscription.terms : [], "PRO");
    if (latestEnd) {
      target.planValidUntil = latestEnd;
      target.proValidUntil = latestEnd;
    }
  }

  const changedFields = Object.keys(target).filter((key) => (
    !isDeepStrictEqual(serializeComparable(subscription[key]), serializeComparable(target[key]))
  ));
  if (changedFields.length === 0) return { mutation: null, review: null };
  target.entitlementSyncPending = true;
  changedFields.push("entitlementSyncPending");
  return {
    mutation: {
      entity: "user_subscription",
      id: String(subscription.id),
      userId: String(subscription.userId),
      changedFields,
      data: target,
      ...(subscription.updatedAt instanceof Date ? { expectedUpdatedAt: subscription.updatedAt } : {})
    },
    review: null
  };
}

async function readAllInPages(model: any, args: Record<string, unknown>, pageSize: number): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | null = null;
  while (true) {
    const page = await model.findMany({
      ...args,
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    rows.push(...page);
    if (page.length < pageSize) break;
    cursor = String(page.at(-1).id);
  }
  return rows;
}

async function applyCasMutation(tx: any, mutation: Stage4Mutation): Promise<boolean> {
  const model = mutation.entity === "subscription_term" ? tx.subscriptionTerm : tx.userSubscription;
  const result = await model.updateMany({
    where: {
      id: mutation.id,
      ...(mutation.expectedUpdatedAt ? { updatedAt: mutation.expectedUpdatedAt } : {})
    },
    data: mutation.data
  });
  return result.count === 1;
}

export async function runStage4Reconciliation(params: {
  database: any;
  apply?: boolean;
  pageSize?: number;
  now?: Date;
}): Promise<Stage4ReconciliationReport> {
  const apply = params.apply === true;
  const pageSize = Math.max(1, Math.min(params.pageSize ?? 250, 1_000));
  const report: Stage4ReconciliationReport = {
    version: STAGE4_RECONCILIATION_VERSION,
    mode: apply ? "apply" : "dry-run",
    generatedAt: (params.now ?? new Date()).toISOString(),
    packages: { scanned: 0, create: 0, update: 0, unchanged: 0, applied: 0 },
    terms: { scanned: 0, update: 0, unchanged: 0, review: 0, applied: 0 },
    subscriptions: { scanned: 0, update: 0, unchanged: 0, review: 0, applied: 0 },
    aggregates: {
      terms: {
        before: buildEntitlementAggregate([], "term"),
        projectedAfter: buildEntitlementAggregate([], "term")
      },
      subscriptions: {
        before: buildEntitlementAggregate([], "subscription"),
        projectedAfter: buildEntitlementAggregate([], "subscription")
      }
    },
    changes: [],
    reviews: []
  };

  const packageRows = await params.database.billingPackage.findMany({
    where: { code: { in: CANONICAL_STAGE4_PACKAGES.map((item) => item.code) } }
  });
  report.packages.scanned = packageRows.length;
  const packageMutations = buildCanonicalPackageMutations(packageRows);
  report.packages.create = packageMutations.filter((item) => item.changedFields.includes("create")).length;
  report.packages.update = packageMutations.length - report.packages.create;
  report.packages.unchanged = CANONICAL_STAGE4_PACKAGES.length - packageMutations.length;
  report.changes.push(...packageMutations.map(({ entity, id, userId, changedFields }) => ({
    entity, id, userId, changedFields
  })));
  if (apply && packageMutations.length > 0) {
    await params.database.$transaction(async (tx: any) => {
      for (const mutation of packageMutations) {
        const existingRow = packageRows.find((row: any) => String(row.id) === mutation.id);
        const code = mutation.changedFields.includes("create")
          ? String(mutation.data.code)
          : String(existingRow?.code ?? "");
        if (!code) throw new Error(`stage4_package_code_missing:${mutation.id}`);
        const data = { ...mutation.data };
        delete data.code;
        await tx.billingPackage.upsert({ where: { code }, create: { code, ...data }, update: data });
        report.packages.applied += 1;
      }
    });
  }

  const terms = await readAllInPages(params.database.subscriptionTerm, {
    include: {
      order: {
        select: {
          items: {
            select: {
              kindSnapshot: true,
              packageSnapshot: true,
              pkg: { select: { kind: true, plan: true, code: true } }
            }
          }
        }
      }
    }
  }, pageSize);
  report.terms.scanned = terms.length;
  const termMutations: Stage4Mutation[] = [];
  for (const term of terms) {
    const decision = buildStage4TermDecision(term);
    if (decision.review) {
      report.reviews.push(decision.review);
      report.terms.review += 1;
    } else if (decision.mutation) {
      termMutations.push(decision.mutation);
      report.terms.update += 1;
    } else {
      report.terms.unchanged += 1;
    }
  }
  report.changes.push(...termMutations.map(({ entity, id, userId, changedFields }) => ({
    entity, id, userId, changedFields
  })));
  report.aggregates.terms = {
    before: buildEntitlementAggregate(terms, "term"),
    projectedAfter: buildEntitlementAggregate(projectRows(terms, termMutations), "term")
  };

  const subscriptions = await readAllInPages(params.database.userSubscription, {
    include: {
      terms: {
        select: {
          id: true,
          plan: true,
          status: true,
          endsAt: true,
          entitlementSnapshot: true,
          order: {
            select: {
              items: {
                select: {
                  kindSnapshot: true,
                  packageSnapshot: true,
                  pkg: { select: { kind: true, plan: true, code: true } }
                }
              }
            }
          }
        }
      }
    }
  }, pageSize);
  report.subscriptions.scanned = subscriptions.length;
  const subscriptionMutations: Stage4Mutation[] = [];
  for (const subscription of subscriptions) {
    const decision = buildStage4SubscriptionDecision(subscription);
    if (decision.review) {
      report.reviews.push(decision.review);
      report.subscriptions.review += 1;
    } else if (decision.mutation) {
      subscriptionMutations.push(decision.mutation);
      report.subscriptions.update += 1;
    } else {
      report.subscriptions.unchanged += 1;
    }
  }
  report.changes.push(...subscriptionMutations.map(({ entity, id, userId, changedFields }) => ({
    entity, id, userId, changedFields
  })));
  report.aggregates.subscriptions = {
    before: buildEntitlementAggregate(subscriptions, "subscription"),
    projectedAfter: buildEntitlementAggregate(
      projectRows(subscriptions, subscriptionMutations),
      "subscription"
    )
  };

  if (apply) {
    for (const mutation of [...termMutations, ...subscriptionMutations]) {
      const applied = await params.database.$transaction((tx: any) => applyCasMutation(tx, mutation));
      if (applied) {
        if (mutation.entity === "subscription_term") report.terms.applied += 1;
        else report.subscriptions.applied += 1;
      } else {
        const review: Stage4ReviewItem = {
          entity: mutation.entity,
          id: mutation.id,
          userId: mutation.userId,
          reason: "concurrent_update_detected"
        };
        report.reviews.push(review);
        if (mutation.entity === "subscription_term") report.terms.review += 1;
        else report.subscriptions.review += 1;
      }
    }
  }

  return report;
}

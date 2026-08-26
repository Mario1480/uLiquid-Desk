import "dotenv/config";
import { prisma } from "@mm/db";
import {
  ensureBillingDefaults,
  resolveEffectivePlanForUser,
  syncPrimaryWorkspaceEntitlementsForUser
} from "../billing/service.js";
import { canonicalPackageByCode } from "../billing/canonicalPackages.js";

type PlanArg = "free" | "pro" | "premium";

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm -w apps/api run set-user-plan -- --email <user@email> --plan free|pro|premium [--months 1] [--token-grant 0] [--skip-sync]",
      "",
      "Examples:",
      "  npm -w apps/api run set-user-plan -- --email admin@uliquid.vip --plan free",
      "  npm -w apps/api run set-user-plan -- --email admin@uliquid.vip --plan pro --months 1",
      "  npm -w apps/api run set-user-plan -- --email admin@uliquid.vip --plan premium --months 1 --token-grant 0"
    ].join("\n")
  );
}

function readArg(name: string): string | undefined {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith("--")) return next.trim();
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parsePlan(value: string | undefined): PlanArg {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "free" || normalized === "pro" || normalized === "premium") return normalized;
  throw new Error("invalid_required_arg_plan");
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toNonNegativeBigInt(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  const parsed = toBigInt(value, fallback);
  return parsed < 0n ? 0n : parsed;
}

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  next.setMonth(next.getMonth() + Math.max(1, months));
  return next;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const email = (readArg("--email") ?? "").trim();
  if (!email) {
    printUsage();
    throw new Error("missing_required_arg_email");
  }

  const plan = parsePlan(readArg("--plan"));
  const skipSync = hasFlag("--skip-sync");

  await ensureBillingDefaults();

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive"
      }
    },
    select: {
      id: true,
      email: true
    }
  });

  if (!user) {
    throw new Error(`user_not_found:${email}`);
  }

  const paidPackageCode = plan === "premium" ? "premium_monthly" : "pro_monthly";
  const paidPkg = plan === "free"
    ? null
    : await prisma.billingPackage.findUnique({ where: { code: paidPackageCode } });

  if (plan === "free") {
    const freePkg = canonicalPackageByCode("free");

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userSubscription.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          aiCreditBalance: true,
          aiCreditsUsedLifetime: true
        }
      });
      const balance = toBigInt(existing?.aiCreditBalance);
      const usedLifetime = toBigInt(existing?.aiCreditsUsedLifetime);

      await tx.userSubscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          effectivePlan: "FREE",
          status: "ACTIVE",
          planValidUntil: null,
          proValidUntil: null,
          maxExchangeAccounts: freePkg.maxExchangeAccounts,
          maxRunningBots: freePkg.maxRunningBots ?? 2,
          maxRunningPredictionsAi: freePkg.maxRunningPredictionsAi,
          maxRunningPredictionsComposite: freePkg.maxRunningPredictionsComposite,
          allowedExchanges: [...freePkg.allowedExchanges],
          aiCreditBalance: balance,
          aiCreditsUsedLifetime: usedLifetime,
          monthlyAiCreditsIncluded: freePkg.monthlyAiCredits
        },
        update: {
          effectivePlan: "FREE",
          status: "ACTIVE",
          planValidUntil: null,
          proValidUntil: null,
          maxExchangeAccounts: freePkg.maxExchangeAccounts,
          maxRunningBots: freePkg.maxRunningBots ?? 2,
          maxRunningPredictionsAi: freePkg.maxRunningPredictionsAi,
          maxRunningPredictionsComposite: freePkg.maxRunningPredictionsComposite,
          allowedExchanges: [...freePkg.allowedExchanges],
          aiCreditBalance: balance,
          monthlyAiCreditsIncluded: freePkg.monthlyAiCredits
        }
      });
    });
  } else {
    if (!paidPkg || paidPkg.plan !== (plan === "premium" ? "PREMIUM" : "PRO")) {
      throw new Error(`canonical_paid_package_missing:${plan}`);
    }
    const canonicalPaidPkg = canonicalPackageByCode(paidPackageCode);
    const paidRunning = canonicalPaidPkg.maxRunningBots ?? (plan === "premium" ? 15 : 5);
    const paidAi = canonicalPaidPkg.maxRunningPredictionsAi;
    const paidComposite = canonicalPaidPkg.maxRunningPredictionsComposite;
    const paidExchanges = [...canonicalPaidPkg.allowedExchanges];
    const monthlyIncluded = canonicalPaidPkg.monthlyAiCredits;
    const defaultMonths = canonicalPaidPkg.billingMonths;
    const months = toPositiveInt(readArg("--months"), defaultMonths);
    // Plan assignment and AI-credit grants are independent. Credits require an
    // explicit operator value and never inherit a hidden fallback.
    const tokenGrant = toNonNegativeBigInt(readArg("--token-grant"), 0n);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userSubscription.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          planValidUntil: true,
          proValidUntil: true,
          aiCreditBalance: true,
          aiCreditsUsedLifetime: true
        }
      });

      const currentBalance = toBigInt(existing?.aiCreditBalance);
      const usedLifetime = toBigInt(existing?.aiCreditsUsedLifetime);
      const startAt =
        existing?.planValidUntil instanceof Date && existing.planValidUntil.getTime() > now.getTime()
          ? existing.planValidUntil
          : existing?.proValidUntil instanceof Date && existing.proValidUntil.getTime() > now.getTime()
            ? existing.proValidUntil
            : now;
      const nextValidUntil = addMonths(startAt, months);
      const nextBalance = currentBalance + tokenGrant;

      const updated = await tx.userSubscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          effectivePlan: plan === "premium" ? "PREMIUM" : "PRO",
          status: "ACTIVE",
          planValidUntil: nextValidUntil,
          proValidUntil: nextValidUntil,
          maxExchangeAccounts: null,
          maxRunningBots: paidRunning,
          maxRunningPredictionsAi: paidAi,
          maxRunningPredictionsComposite: paidComposite,
          allowedExchanges: paidExchanges,
          aiCreditBalance: nextBalance,
          aiCreditsUsedLifetime: usedLifetime,
          monthlyAiCreditsIncluded: monthlyIncluded
        },
        update: {
          effectivePlan: plan === "premium" ? "PREMIUM" : "PRO",
          status: "ACTIVE",
          planValidUntil: nextValidUntil,
          proValidUntil: nextValidUntil,
          maxExchangeAccounts: null,
          maxRunningBots: paidRunning,
          maxRunningPredictionsAi: paidAi,
          maxRunningPredictionsComposite: paidComposite,
          allowedExchanges: paidExchanges,
          aiCreditBalance: nextBalance,
          monthlyAiCreditsIncluded: monthlyIncluded
        }
      });

      if (tokenGrant > 0n) {
        await tx.aiCreditLedger.create({
          data: {
            userId: user.id,
            subscriptionId: updated.id,
            reason: "ADMIN_ADJUST",
            deltaCredits: tokenGrant,
            balanceAfterCredits: nextBalance,
            meta: {
              source: "set-user-plan-script",
              email: user.email,
              plan,
              months
            }
          }
        });
      }
    });
  }

  if (!skipSync) {
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId: user.id,
      effectivePlan: plan
    });
  }

  const [resolved, primaryMembership] = await Promise.all([
    resolveEffectivePlanForUser(user.id),
    prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true }
    })
  ]);

  const entitlement = primaryMembership?.workspaceId
    ? await prisma.licenseEntitlement.findUnique({
        where: { workspaceId: primaryMembership.workspaceId },
        select: {
          plan: true,
          allowedStrategyKinds: true,
          maxCompositeNodes: true
        }
      })
    : null;

  // eslint-disable-next-line no-console
  console.log("[set-user-plan] done", {
    userId: user.id,
    email: user.email,
    requestedPlan: plan,
    effectivePlan: resolved.plan,
    status: resolved.status,
    planValidUntil: resolved.planValidUntil,
    proValidUntil: resolved.proValidUntil,
    maxExchangeAccounts: resolved.maxExchangeAccounts,
    maxRunningBots: resolved.maxRunningBots,
    allowedExchanges: resolved.allowedExchanges,
    aiCreditBalance: resolved.aiCreditBalance.toString(),
    monthlyAiCreditsIncluded: resolved.monthlyAiCreditsIncluded.toString(),
    workspaceId: primaryMembership?.workspaceId ?? null,
    entitlementPlan: entitlement?.plan ?? null,
    entitlementKinds: entitlement?.allowedStrategyKinds ?? [],
    entitlementMaxCompositeNodes: entitlement?.maxCompositeNodes ?? null,
    syncApplied: !skipSync
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[set-user-plan] fatal", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

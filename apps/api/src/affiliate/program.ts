import crypto from "node:crypto";
import { isPrismaUniqueConstraintError } from "../telegram/chatIdUniqueness.js";

export const GLOBAL_SETTING_AFFILIATE_PROGRAM_KEY = "admin.affiliateProgram.v1";
export const DEFAULT_PLATFORM_FEE_RATE_PCT = 5;
export const DEFAULT_AFFILIATE_FEE_RATE_PCT = 10;
export const DEFAULT_AFFILIATE_PROGRAM_SETTINGS = {
  enabled: false,
  platformFeeRatePct: DEFAULT_PLATFORM_FEE_RATE_PCT,
  defaultAffiliateFeeRatePct: DEFAULT_AFFILIATE_FEE_RATE_PCT
} as const;

type JsonRecord = Record<string, unknown>;

export type AffiliateProgramSettings = {
  enabled: boolean;
  platformFeeRatePct: number;
  defaultAffiliateFeeRatePct: number;
  updatedAt: string | null;
};

export type AffiliateFeeEventDecoration = {
  platformFeeRatePct: number;
  affiliateFeeRatePct: number;
  totalFeeRatePct: number | null;
  configuredTotalFeeRatePct: number;
  affiliateUserId: string | null;
  referredUserId: string | null;
  affiliateAmountUsd: number;
  platformAmountUsd: number;
  affiliateSplitEligible: boolean;
  affiliateSplitReason: string | null;
};

export type LockedAffiliateFeeConfig = {
  platformFeeRatePct: number;
  affiliateFeeRatePct: number;
  totalFeeRatePct: number;
  affiliateUserId: string | null;
  feeConfigLockedAt: string;
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

export function normalizeAffiliateFeeRatePct(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizeAffiliateCode(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return raw.length >= 4 && raw.length <= 64 ? raw : null;
}

export function parseStoredAffiliateProgramSettings(value: unknown): Omit<AffiliateProgramSettings, "updatedAt"> {
  const record = asRecord(value);
  const platformFeeRatePct =
    normalizeAffiliateFeeRatePct(record.platformFeeRatePct) ?? DEFAULT_PLATFORM_FEE_RATE_PCT;
  const defaultAffiliateFeeRatePct =
    normalizeAffiliateFeeRatePct(record.defaultAffiliateFeeRatePct) ?? DEFAULT_AFFILIATE_FEE_RATE_PCT;
  return {
    enabled: Boolean(record.enabled),
    platformFeeRatePct,
    defaultAffiliateFeeRatePct
  };
}

export async function getAffiliateProgramSettings(db: any): Promise<AffiliateProgramSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_AFFILIATE_PROGRAM_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredAffiliateProgramSettings(row?.value);
  return {
    ...stored,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

export async function setAffiliateProgramSettings(db: any, input: {
  enabled: boolean;
  platformFeeRatePct: number;
  defaultAffiliateFeeRatePct: number;
}): Promise<AffiliateProgramSettings> {
  const platformFeeRatePct = normalizeAffiliateFeeRatePct(input.platformFeeRatePct);
  const defaultAffiliateFeeRatePct = normalizeAffiliateFeeRatePct(input.defaultAffiliateFeeRatePct);
  if (platformFeeRatePct == null) throw new Error("invalid_platform_fee_rate_pct");
  if (defaultAffiliateFeeRatePct == null) throw new Error("invalid_default_affiliate_fee_rate_pct");
  if (platformFeeRatePct + defaultAffiliateFeeRatePct > 100) {
    throw new Error("invalid_total_fee_rate_pct");
  }

  const row = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_AFFILIATE_PROGRAM_KEY },
    update: {
      value: {
        enabled: Boolean(input.enabled),
        platformFeeRatePct,
        defaultAffiliateFeeRatePct
      }
    },
    create: {
      key: GLOBAL_SETTING_AFFILIATE_PROGRAM_KEY,
      value: {
        enabled: Boolean(input.enabled),
        platformFeeRatePct,
        defaultAffiliateFeeRatePct
      }
    },
    select: { value: true, updatedAt: true }
  });

  return {
    ...parseStoredAffiliateProgramSettings(row.value),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

function buildAffiliateCodeCandidate(): string {
  return `ULQ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function ensureAffiliateProfileForUser(db: any, userId: string) {
  const existing = await db.affiliateProfile.findUnique({
    where: { userId }
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.affiliateProfile.create({
        data: {
          userId,
          code: buildAffiliateCodeCandidate(),
          status: "ACTIVE"
        }
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
    }
  }
  throw new Error("affiliate_profile_create_failed");
}

export async function resolveAffiliateUserIdByCode(db: any, code: string | null | undefined): Promise<string | null> {
  const normalizedCode = normalizeAffiliateCode(code);
  if (!normalizedCode) return null;
  const profile = await db.affiliateProfile.findUnique({
    where: { code: normalizedCode },
    select: { userId: true, status: true }
  });
  if (!profile || String(profile.status) !== "ACTIVE") return null;
  return String(profile.userId);
}

export async function setAffiliateRateOverride(db: any, input: {
  affiliateUserId: string;
  feeRatePct: number | null;
  reason?: string | null;
}) {
  if (input.feeRatePct == null) {
    await db.affiliateRateOverride.deleteMany({
      where: { affiliateUserId: input.affiliateUserId }
    });
    return null;
  }

  const feeRatePct = normalizeAffiliateFeeRatePct(input.feeRatePct);
  if (feeRatePct == null) throw new Error("invalid_affiliate_fee_rate_pct");
  return db.affiliateRateOverride.upsert({
    where: { affiliateUserId: input.affiliateUserId },
    update: {
      feeRatePct,
      reason: input.reason?.trim() || null
    },
    create: {
      affiliateUserId: input.affiliateUserId,
      feeRatePct,
      reason: input.reason?.trim() || null
    }
  });
}

export async function assignAffiliateReferral(db: any, input: {
  referredUserId: string;
  affiliateUserId: string;
  source?: string | null;
  metadata?: JsonRecord | null;
}) {
  if (input.referredUserId === input.affiliateUserId) {
    throw new Error("affiliate_self_referral_not_allowed");
  }
  return db.affiliateReferral.upsert({
    where: { referredUserId: input.referredUserId },
    update: {
      affiliateUserId: input.affiliateUserId,
      status: "ACTIVE",
      source: input.source?.trim() || null,
      assignedAt: new Date(),
      metadata: input.metadata ?? undefined
    },
    create: {
      affiliateUserId: input.affiliateUserId,
      referredUserId: input.referredUserId,
      status: "ACTIVE",
      source: input.source?.trim() || null,
      assignedAt: new Date(),
      metadata: input.metadata ?? undefined
    }
  });
}

export async function clearAffiliateReferral(db: any, referredUserId: string) {
  await db.affiliateReferral.deleteMany({ where: { referredUserId } });
}

function roundUsd(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 10_000) / 10_000;
}

function toNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getAffiliateRateContext(db: any, affiliateUserId: string) {
  const [settings, override] = await Promise.all([
    getAffiliateProgramSettings(db),
    db.affiliateRateOverride.findUnique({
      where: { affiliateUserId },
      select: { feeRatePct: true, reason: true, updatedAt: true }
    })
  ]);
  return {
    settings,
    effectiveFeeRatePct: roundUsd(override?.feeRatePct ?? settings.defaultAffiliateFeeRatePct),
    override: override
      ? {
          feeRatePct: roundUsd(override.feeRatePct),
          reason: override.reason ? String(override.reason) : null,
          updatedAt: toIso(override.updatedAt)
        }
      : null
  };
}

export async function getAffiliateProgramSummary(db: any) {
  const [profileCount, activeReferralCount, accrued, paid, unpaid] = await Promise.all([
    db.affiliateProfile.count().catch(() => 0),
    db.affiliateReferral.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    db.affiliateAccrual.aggregate({ _sum: { affiliateAmountUsd: true } }).catch(() => ({ _sum: { affiliateAmountUsd: 0 } })),
    db.affiliateAccrual.aggregate({ where: { status: "PAID" }, _sum: { affiliateAmountUsd: true } }).catch(() => ({ _sum: { affiliateAmountUsd: 0 } })),
    db.affiliateAccrual.aggregate({ where: { status: "ACCRUED" }, _sum: { affiliateAmountUsd: true } }).catch(() => ({ _sum: { affiliateAmountUsd: 0 } }))
  ]);

  return {
    profileCount,
    activeReferralCount,
    totalAffiliateAccruedUsd: roundUsd(accrued._sum?.affiliateAmountUsd),
    totalAffiliatePaidUsd: roundUsd(paid._sum?.affiliateAmountUsd),
    totalAffiliateUnpaidUsd: roundUsd(unpaid._sum?.affiliateAmountUsd)
  };
}

export async function getAffiliateOverviewForUser(db: any, userId: string, options?: { limit?: number }) {
  const limit = Math.max(1, Math.min(50, Number(options?.limit ?? 20)));
  const profile = await ensureAffiliateProfileForUser(db, userId);
  const [rateContext, referral, totalReferrals, activeReferrals, accruedAgg, paidAgg, unpaidAgg, latestAccruals] = await Promise.all([
    getAffiliateRateContext(db, userId),
    db.affiliateReferral.findUnique({
      where: { referredUserId: userId },
      select: {
        affiliateUserId: true,
        source: true,
        assignedAt: true,
        affiliateUser: {
          select: {
            id: true,
            email: true,
            affiliateProfile: { select: { code: true } }
          }
        }
      }
    }),
    db.affiliateReferral.count({ where: { affiliateUserId: userId } }).catch(() => 0),
    db.affiliateReferral.count({ where: { affiliateUserId: userId, status: "ACTIVE" } }).catch(() => 0),
    db.affiliateAccrual.aggregate({
      where: { affiliateUserId: userId },
      _sum: { affiliateAmountUsd: true, platformAmountUsd: true, grossFeeUsd: true }
    }).catch(() => ({ _sum: { affiliateAmountUsd: 0, platformAmountUsd: 0, grossFeeUsd: 0 } })),
    db.affiliateAccrual.aggregate({
      where: { affiliateUserId: userId, status: "PAID" },
      _sum: { affiliateAmountUsd: true }
    }).catch(() => ({ _sum: { affiliateAmountUsd: 0 } })),
    db.affiliateAccrual.aggregate({
      where: { affiliateUserId: userId, status: "ACCRUED" },
      _sum: { affiliateAmountUsd: true }
    }).catch(() => ({ _sum: { affiliateAmountUsd: 0 } })),
    db.affiliateAccrual.findMany({
      where: { affiliateUserId: userId },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        status: true,
        affiliateAmountUsd: true,
        platformAmountUsd: true,
        grossFeeUsd: true,
        affiliateFeeRatePct: true,
        accruedAt: true,
        paidAt: true,
        referredUser: { select: { id: true, email: true } },
        botVault: {
          select: {
            id: true,
            gridInstanceId: true,
            vaultAddress: true
          }
        }
      }
    }).catch(() => [])
  ]);

  return {
    profile: {
      id: String(profile.id),
      code: String(profile.code),
      status: String(profile.status),
      createdAt: toIso(profile.createdAt),
      updatedAt: toIso(profile.updatedAt)
    },
    program: rateContext.settings,
    effectiveFeeRatePct: rateContext.effectiveFeeRatePct,
    override: rateContext.override,
    referredBy: referral?.affiliateUser
      ? {
          id: String(referral.affiliateUser.id),
          email: String(referral.affiliateUser.email),
          code: referral.affiliateUser.affiliateProfile?.code ? String(referral.affiliateUser.affiliateProfile.code) : null,
          source: referral.source ? String(referral.source) : null,
          assignedAt: toIso(referral.assignedAt)
        }
      : null,
    stats: {
      referredUsers: totalReferrals,
      activeReferredUsers: activeReferrals,
      totalAffiliateAccruedUsd: roundUsd(accruedAgg._sum?.affiliateAmountUsd),
      totalPlatformRevenueUsd: roundUsd(accruedAgg._sum?.platformAmountUsd),
      totalGrossFeeUsd: roundUsd(accruedAgg._sum?.grossFeeUsd),
      paidAffiliateUsd: roundUsd(paidAgg._sum?.affiliateAmountUsd),
      unpaidAffiliateUsd: roundUsd(unpaidAgg._sum?.affiliateAmountUsd)
    },
    latestAccruals: latestAccruals.map((row: any) => ({
      id: String(row.id),
      status: String(row.status),
      affiliateAmountUsd: roundUsd(row.affiliateAmountUsd),
      platformAmountUsd: roundUsd(row.platformAmountUsd),
      grossFeeUsd: roundUsd(row.grossFeeUsd),
      affiliateFeeRatePct: roundUsd(row.affiliateFeeRatePct),
      accruedAt: toIso(row.accruedAt),
      paidAt: toIso(row.paidAt),
      referredUser: row.referredUser
        ? { id: String(row.referredUser.id), email: String(row.referredUser.email) }
        : null,
      botVault: row.botVault
        ? {
            id: String(row.botVault.id),
            gridInstanceId: row.botVault.gridInstanceId ? String(row.botVault.gridInstanceId) : null,
            vaultAddress: row.botVault.vaultAddress ? String(row.botVault.vaultAddress) : null
          }
        : null
    }))
  };
}

export async function getAdminAffiliateUserDetail(db: any, userId: string) {
  const [user, overview] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true }
    }),
    getAffiliateOverviewForUser(db, userId, { limit: 10 })
  ]);
  if (!user) return null;
  return {
    user: {
      id: String(user.id),
      email: String(user.email),
      createdAt: toIso(user.createdAt)
    },
    ...overview
  };
}

async function resolveAffiliateRateSnapshot(db: any, referredUserId: string): Promise<{
  settings: AffiliateProgramSettings;
  affiliateUserId: string | null;
  affiliateFeeRatePct: number;
}> {
  const settings = await getAffiliateProgramSettings(db).catch(() => ({
    ...DEFAULT_AFFILIATE_PROGRAM_SETTINGS,
    updatedAt: null
  }));
  if (!settings.enabled || !db?.affiliateReferral?.findUnique) {
    return {
      settings,
      affiliateUserId: null,
      affiliateFeeRatePct: 0
    };
  }

  const referral = await db.affiliateReferral.findUnique({
    where: { referredUserId },
    select: {
      affiliateUserId: true,
      status: true
    }
  }).catch(() => null);

  if (!referral || String(referral.status) !== "ACTIVE") {
    return {
      settings,
      affiliateUserId: null,
      affiliateFeeRatePct: 0
    };
  }

  const override = typeof db?.affiliateRateOverride?.findUnique === "function"
    ? await db.affiliateRateOverride.findUnique({
        where: { affiliateUserId: referral.affiliateUserId },
        select: { feeRatePct: true }
      }).catch(() => null)
    : null;

  return {
    settings,
    affiliateUserId: String(referral.affiliateUserId),
    affiliateFeeRatePct: normalizeAffiliateFeeRatePct(override?.feeRatePct) ?? settings.defaultAffiliateFeeRatePct
  };
}

export async function resolveLockedAffiliateFeeConfig(db: any, referredUserId: string): Promise<LockedAffiliateFeeConfig> {
  const rateSnapshot = await resolveAffiliateRateSnapshot(db, referredUserId);
  const platformFeeRatePct = roundUsd(rateSnapshot.settings.platformFeeRatePct);
  const affiliateFeeRatePct = roundUsd(rateSnapshot.affiliateFeeRatePct);
  return {
    platformFeeRatePct,
    affiliateFeeRatePct,
    totalFeeRatePct: roundUsd(platformFeeRatePct + affiliateFeeRatePct),
    affiliateUserId: rateSnapshot.affiliateUserId,
    feeConfigLockedAt: new Date().toISOString()
  };
}

export async function decorateFeeEventMetadataWithAffiliateContext(params: {
  dbClient?: any;
  referredUserId: string;
  feeAmountUsd: number;
  totalFeeRatePct?: number | null;
  metadata?: Record<string, unknown> | null;
}): Promise<Record<string, unknown>> {
  const dbClient = params.dbClient;
  const metadata = asRecord(params.metadata);
  if (
    typeof dbClient?.globalSetting?.findUnique !== "function"
    && typeof dbClient?.affiliateReferral?.findUnique !== "function"
  ) {
    return metadata;
  }
  const lockedPlatformFeeRatePct = normalizeAffiliateFeeRatePct(metadata.platformFeeRatePct);
  const lockedAffiliateFeeRatePct = normalizeAffiliateFeeRatePct(metadata.affiliateFeeRatePct);
  const lockedAffiliateUserId = toNullableString(metadata.affiliateUserId);
  const feeConfigLockedAt = toNullableString(metadata.feeConfigLockedAt);
  const hasLockedFeeConfig =
    feeConfigLockedAt != null
    && lockedPlatformFeeRatePct != null
    && lockedAffiliateFeeRatePct != null;
  const totalFeeRatePct =
    normalizeAffiliateFeeRatePct(metadata.totalFeeRatePct ?? params.totalFeeRatePct ?? metadata.feeRatePct);
  const rateSnapshot = hasLockedFeeConfig
    ? {
        settings: {
          enabled: true,
          platformFeeRatePct: lockedPlatformFeeRatePct,
          defaultAffiliateFeeRatePct: lockedAffiliateFeeRatePct,
          updatedAt: feeConfigLockedAt
        } satisfies AffiliateProgramSettings,
        affiliateUserId: lockedAffiliateUserId,
        affiliateFeeRatePct: lockedAffiliateFeeRatePct
      }
    : await resolveAffiliateRateSnapshot(dbClient, params.referredUserId);
  const platformFeeRatePct =
    normalizeAffiliateFeeRatePct(metadata.platformFeeRatePct) ?? rateSnapshot.settings.platformFeeRatePct;
  const affiliateFeeRatePct =
    normalizeAffiliateFeeRatePct(metadata.affiliateFeeRatePct) ?? rateSnapshot.affiliateFeeRatePct;
  const affiliateUserId =
    toNullableString(metadata.affiliateUserId) ?? rateSnapshot.affiliateUserId;
  const configuredTotalFeeRatePct = roundUsd(platformFeeRatePct + affiliateFeeRatePct);
  const feeAmountUsd = roundUsd(params.feeAmountUsd);

  let affiliateSplitEligible = false;
  let affiliateSplitReason: string | null = null;

  if (!hasLockedFeeConfig && !rateSnapshot.settings.enabled) {
    affiliateSplitReason = "program_disabled";
  } else if (!affiliateUserId || affiliateFeeRatePct <= 0) {
    affiliateSplitReason = "no_referral";
  } else if (totalFeeRatePct == null) {
    affiliateSplitReason = "missing_total_fee_rate";
  } else if (Math.abs(totalFeeRatePct - configuredTotalFeeRatePct) > 0.0001) {
    affiliateSplitReason = "fee_rate_mismatch";
  } else if (feeAmountUsd <= 0) {
    affiliateSplitReason = "zero_fee_amount";
  } else {
    affiliateSplitEligible = true;
  }

  const affiliateAmountUsd = affiliateSplitEligible && totalFeeRatePct && totalFeeRatePct > 0
    ? roundUsd(feeAmountUsd * (affiliateFeeRatePct / totalFeeRatePct))
    : 0;
  const platformAmountUsd = roundUsd(Math.max(0, feeAmountUsd - affiliateAmountUsd));

  return {
    ...metadata,
    platformFeeRatePct,
    affiliateFeeRatePct,
    totalFeeRatePct,
    configuredTotalFeeRatePct,
    affiliateUserId,
    referredUserId: params.referredUserId,
    affiliateAmountUsd,
    platformAmountUsd,
    affiliateSplitEligible,
    affiliateSplitReason,
    feeConfigLockedAt
  };
}

async function findAffiliateAccrualByFeeEventId(dbClient: any, feeEventId: string): Promise<any | null> {
  if (!feeEventId) return null;
  if (typeof dbClient?.affiliateAccrual?.findUnique === "function") {
    return dbClient.affiliateAccrual.findUnique({
      where: { feeEventId }
    }).catch(() => null);
  }
  if (typeof dbClient?.affiliateAccrual?.findFirst === "function") {
    return dbClient.affiliateAccrual.findFirst({
      where: { feeEventId }
    }).catch(() => null);
  }
  return null;
}

export async function createAffiliateAccrualFromFeeEventIfEligible(params: {
  dbClient?: any;
  feeEvent: {
    id?: string | null;
    botVaultId?: string | null;
    feeAmount?: number | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}): Promise<"skipped" | "created" | "existing"> {
  const dbClient = params.dbClient;
  const feeEventId = toNullableString(params.feeEvent?.id);
  const botVaultId = toNullableString(params.feeEvent?.botVaultId);
  const metadata = asRecord(params.feeEvent?.metadata);
  const affiliateUserId = toNullableString(metadata.affiliateUserId);
  const referredUserId = toNullableString(metadata.referredUserId);
  const affiliateAmountUsd = roundUsd(
    typeof metadata.affiliateAmountUsd === "number" ? metadata.affiliateAmountUsd : Number(metadata.affiliateAmountUsd ?? 0)
  );
  const platformAmountUsd = roundUsd(
    typeof metadata.platformAmountUsd === "number" ? metadata.platformAmountUsd : Number(metadata.platformAmountUsd ?? 0)
  );
  const grossFeeUsd = roundUsd(params.feeEvent?.feeAmount);
  const affiliateFeeRatePct = normalizeAffiliateFeeRatePct(metadata.affiliateFeeRatePct);
  const affiliateSplitEligible = Boolean(metadata.affiliateSplitEligible);

  if (
    !feeEventId
    || !botVaultId
    || !affiliateSplitEligible
    || !affiliateUserId
    || !referredUserId
    || affiliateFeeRatePct == null
    || affiliateAmountUsd <= 0
    || typeof dbClient?.affiliateAccrual?.create !== "function"
  ) {
    return "skipped";
  }

  const existing = await findAffiliateAccrualByFeeEventId(dbClient, feeEventId);
  if (existing) return "existing";

  try {
    await dbClient.affiliateAccrual.create({
      data: {
        feeEventId,
        botVaultId,
        affiliateUserId,
        referredUserId,
        grossFeeUsd,
        affiliateFeeRatePct,
        affiliateAmountUsd,
        platformAmountUsd,
        status: "ACCRUED",
        metadata
      }
    });
    return "created";
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    const afterUnique = await findAffiliateAccrualByFeeEventId(dbClient, feeEventId);
    return afterUnique ? "existing" : "skipped";
  }
}

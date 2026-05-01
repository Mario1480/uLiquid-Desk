import assert from "node:assert/strict";
import test from "node:test";
import {
  AFFILIATE_SELF_FEE_RATE_METADATA_KEY,
  MAX_AFFILIATE_SELF_FEE_RATE_PCT,
  decorateFeeEventMetadataWithAffiliateContext,
  getAffiliateOverviewForUser,
  readLockedAffiliateFeeConfig,
  resolveLockedAffiliateFeeConfig,
  setAffiliateProgramSettings,
  setAffiliateSelfSelectedFeeRate
} from "./program.js";

function createAffiliateProgramTestDb() {
  const profiles = new Map<string, any>();
  const overrides = new Map<string, any>();
  const referrals = new Map<string, any>();
  let settings = {
    enabled: true,
    platformFeeRatePct: 5,
    defaultAffiliateFeeRatePct: 10
  };

  return {
    state: { profiles, overrides, referrals, get settings() { return settings; } },
    globalSetting: {
      async findUnique(args: any) {
        if (String(args?.where?.key ?? "") !== "admin.affiliateProgram.v1") return null;
        return {
          value: settings,
          updatedAt: new Date("2026-04-18T10:00:00.000Z")
        };
      },
      async upsert(args: any) {
        settings = {
          enabled: Boolean(args.update?.value?.enabled ?? args.create?.value?.enabled),
          platformFeeRatePct: Number(args.update?.value?.platformFeeRatePct ?? args.create?.value?.platformFeeRatePct),
          defaultAffiliateFeeRatePct: Number(args.update?.value?.defaultAffiliateFeeRatePct ?? args.create?.value?.defaultAffiliateFeeRatePct)
        };
        return {
          value: settings,
          updatedAt: new Date("2026-04-18T10:05:00.000Z")
        };
      }
    },
    affiliateProfile: {
      async findUnique(args: any) {
        if (args?.where?.userId) return profiles.get(String(args.where.userId)) ?? null;
        if (args?.where?.code) {
          return Array.from(profiles.values()).find((profile) => profile.code === args.where.code) ?? null;
        }
        return null;
      },
      async create(args: any) {
        const profile = {
          id: `profile_${profiles.size + 1}`,
          userId: String(args.data.userId),
          code: String(args.data.code),
          status: args.data.status ?? "ACTIVE",
          metadata: args.data.metadata ?? null,
          createdAt: new Date("2026-04-18T10:00:00.000Z"),
          updatedAt: new Date("2026-04-18T10:00:00.000Z")
        };
        profiles.set(profile.userId, profile);
        return profile;
      },
      async update(args: any) {
        const userId = String(args.where.userId);
        const existing = profiles.get(userId);
        if (!existing) throw new Error("profile_not_found");
        const updated = {
          ...existing,
          ...args.data,
          updatedAt: new Date("2026-04-18T10:05:00.000Z")
        };
        profiles.set(userId, updated);
        return updated;
      },
      async count() {
        return profiles.size;
      }
    },
    affiliateRateOverride: {
      async findUnique(args: any) {
        return overrides.get(String(args?.where?.affiliateUserId ?? "")) ?? null;
      },
      async upsert(args: any) {
        const affiliateUserId = String(args.create.affiliateUserId);
        const row = {
          id: `override_${affiliateUserId}`,
          affiliateUserId,
          feeRatePct: Number(args.create.feeRatePct ?? args.update.feeRatePct),
          reason: args.create.reason ?? args.update.reason ?? null,
          updatedAt: new Date("2026-04-18T10:00:00.000Z")
        };
        overrides.set(affiliateUserId, row);
        return row;
      },
      async deleteMany(args: any) {
        overrides.delete(String(args?.where?.affiliateUserId ?? ""));
        return { count: 1 };
      }
    },
    affiliateReferral: {
      async findUnique(args: any) {
        const row = referrals.get(String(args?.where?.referredUserId ?? ""));
        if (!row) return null;
        const affiliateProfile = profiles.get(String(row.affiliateUserId)) ?? null;
        return {
          ...row,
          affiliateUser: {
            id: row.affiliateUserId,
            email: `${row.affiliateUserId}@example.com`,
            walletAddress: "0x1111111111111111111111111111111111111111",
            affiliateProfile: affiliateProfile
              ? {
                  code: affiliateProfile.code,
                  metadata: affiliateProfile.metadata
                }
              : null
          }
        };
      },
      async count(args: any) {
        const affiliateUserId = args?.where?.affiliateUserId ? String(args.where.affiliateUserId) : null;
        const status = args?.where?.status ? String(args.where.status) : null;
        return Array.from(referrals.values()).filter((row) => {
          if (affiliateUserId && row.affiliateUserId !== affiliateUserId) return false;
          if (status && row.status !== status) return false;
          return true;
        }).length;
      }
    },
    affiliateAccrual: {
      async aggregate() {
        return { _sum: { affiliateAmountUsd: 0, platformAmountUsd: 0, grossFeeUsd: 0 } };
      },
      async findMany() {
        return [];
      }
    },
    user: {
      async findUnique(args: any) {
        const userId = String(args?.where?.id ?? "");
        const profile = profiles.get(userId) ?? null;
        return {
          id: userId,
          email: `${userId}@example.com`,
          walletAddress: "0x1111111111111111111111111111111111111111",
          affiliateProfile: profile ? { metadata: profile.metadata } : null
        };
      }
    }
  };
}

test("affiliate self-selected profitshare is capped at 25 percent and shown in overview", async () => {
  const db = createAffiliateProgramTestDb();
  db.state.profiles.set("affiliate_1", {
    id: "profile_1",
    userId: "affiliate_1",
    code: "ULQ-AFF1",
    status: "ACTIVE",
    metadata: {
      payoutWallet: {
        address: "0x2222222222222222222222222222222222222222",
        version: 1
      }
    },
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:00:00.000Z")
  });

  await setAffiliateSelfSelectedFeeRate(db, {
    affiliateUserId: "affiliate_1",
    feeRatePct: MAX_AFFILIATE_SELF_FEE_RATE_PCT
  });

  const profile = db.state.profiles.get("affiliate_1");
  assert.equal(profile.metadata[AFFILIATE_SELF_FEE_RATE_METADATA_KEY], 25);
  assert.equal(profile.metadata.payoutWallet.address, "0x2222222222222222222222222222222222222222");

  const overview = await getAffiliateOverviewForUser(db, "affiliate_1");
  assert.equal(overview.effectiveFeeRatePct, 25);
  assert.equal(overview.rateSource, "self_selected");
  assert.equal(overview.selfSelectedFeeRatePct, 25);
  assert.equal(overview.maxSelfSelectedFeeRatePct, 25);
});

test("affiliate self-selected profitshare rejects values above 25 percent", async () => {
  const db = createAffiliateProgramTestDb();
  await assert.rejects(
    setAffiliateSelfSelectedFeeRate(db, {
      affiliateUserId: "affiliate_1",
      feeRatePct: 25.01
    }),
    /invalid_affiliate_fee_rate_pct/
  );
});

test("new vault fee config locks 5 percent platform plus selected affiliate share", async () => {
  const db = createAffiliateProgramTestDb();
  db.state.profiles.set("affiliate_1", {
    id: "profile_1",
    userId: "affiliate_1",
    code: "ULQ-AFF1",
    status: "ACTIVE",
    metadata: {
      [AFFILIATE_SELF_FEE_RATE_METADATA_KEY]: 25,
      payoutWallet: {
        address: "0x2222222222222222222222222222222222222222",
        version: 1
      }
    },
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:00:00.000Z")
  });
  db.state.referrals.set("user_1", {
    affiliateUserId: "affiliate_1",
    referredUserId: "user_1",
    status: "ACTIVE",
    source: "test",
    assignedAt: new Date("2026-04-18T10:00:00.000Z")
  });

  const locked = await resolveLockedAffiliateFeeConfig(db, "user_1");
  assert.equal(locked.platformFeeRatePct, 5);
  assert.equal(locked.affiliateFeeRatePct, 25);
  assert.equal(locked.totalFeeRatePct, 30);
  assert.equal(locked.platformFeeBps, 500);
  assert.equal(locked.affiliateFeeBps, 2500);
  assert.equal(locked.totalFeeBps, 3000);
  assert.equal(locked.userShareBps, 7000);
  assert.equal(locked.netPayoutRule, "gross_minus_locked_profitshare");
  assert.equal(locked.affiliateUserId, "affiliate_1");
  assert.equal(locked.affiliateRecipientAddress, "0x2222222222222222222222222222222222222222");
});

test("locked vault fee config remains stable after global fee changes while new vaults use current config", async () => {
  const db = createAffiliateProgramTestDb();
  db.state.profiles.set("affiliate_1", {
    id: "profile_1",
    userId: "affiliate_1",
    code: "ULQ-AFF1",
    status: "ACTIVE",
    metadata: {
      payoutWallet: {
        address: "0x2222222222222222222222222222222222222222",
        version: 1
      }
    },
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:00:00.000Z")
  });
  db.state.referrals.set("user_1", {
    affiliateUserId: "affiliate_1",
    referredUserId: "user_1",
    status: "ACTIVE",
    source: "test",
    assignedAt: new Date("2026-04-18T10:00:00.000Z")
  });

  const existingVaultConfig = await resolveLockedAffiliateFeeConfig(db, "user_1");
  assert.equal(existingVaultConfig.platformFeeBps, 500);
  assert.equal(existingVaultConfig.affiliateFeeBps, 1000);
  assert.equal(existingVaultConfig.userShareBps, 8500);

  await setAffiliateProgramSettings(db, {
    enabled: true,
    platformFeeRatePct: 7,
    defaultAffiliateFeeRatePct: 12
  });

  const existingAfterGlobalChange = readLockedAffiliateFeeConfig(existingVaultConfig);
  assert.equal(existingAfterGlobalChange?.platformFeeBps, 500);
  assert.equal(existingAfterGlobalChange?.affiliateFeeBps, 1000);
  assert.equal(existingAfterGlobalChange?.userShareBps, 8500);

  const newVaultConfig = await resolveLockedAffiliateFeeConfig(db, "user_1");
  assert.equal(newVaultConfig.platformFeeBps, 700);
  assert.equal(newVaultConfig.affiliateFeeBps, 1200);
  assert.equal(newVaultConfig.totalFeeBps, 1900);
  assert.equal(newVaultConfig.userShareBps, 8100);

  const decorated = await decorateFeeEventMetadataWithAffiliateContext({
    dbClient: db,
    referredUserId: "user_1",
    feeAmountUsd: 15,
    totalFeeRatePct: existingVaultConfig.totalFeeRatePct,
    metadata: {
      ...existingVaultConfig
    }
  });
  assert.equal(decorated.platformFeeRatePct, 5);
  assert.equal(decorated.affiliateFeeRatePct, 10);
  assert.equal(decorated.platformFeeBps, 500);
  assert.equal(decorated.affiliateFeeBps, 1000);
  assert.equal(decorated.affiliateAmountUsd, 10);
  assert.equal(decorated.platformAmountUsd, 5);
  assert.equal(decorated.affiliateRecipientAddress, "0x2222222222222222222222222222222222222222");
});

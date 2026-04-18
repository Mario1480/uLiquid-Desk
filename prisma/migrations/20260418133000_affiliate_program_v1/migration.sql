-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AffiliateProfileStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AffiliateReferralStatus" AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AffiliateAccrualStatus" AS ENUM ('ACCRUED', 'PAID', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "AffiliateProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_rate_overrides" (
  "id" TEXT NOT NULL,
  "affiliate_user_id" TEXT NOT NULL,
  "fee_rate_pct" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_rate_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_referrals" (
  "id" TEXT NOT NULL,
  "affiliate_user_id" TEXT NOT NULL,
  "referred_user_id" TEXT NOT NULL,
  "status" "AffiliateReferralStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_accruals" (
  "id" TEXT NOT NULL,
  "fee_event_id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "affiliate_user_id" TEXT NOT NULL,
  "referred_user_id" TEXT NOT NULL,
  "gross_fee_usd" DOUBLE PRECISION NOT NULL,
  "affiliate_fee_rate_pct" DOUBLE PRECISION NOT NULL,
  "affiliate_amount_usd" DOUBLE PRECISION NOT NULL,
  "platform_amount_usd" DOUBLE PRECISION NOT NULL,
  "status" "AffiliateAccrualStatus" NOT NULL DEFAULT 'ACCRUED',
  "accrued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_profiles_user_id_key"
  ON "affiliate_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_profiles_code_key"
  ON "affiliate_profiles"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_profiles_status_created_idx"
  ON "affiliate_profiles"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_rate_overrides_affiliate_user_id_key"
  ON "affiliate_rate_overrides"("affiliate_user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_referrals_referred_user_id_key"
  ON "affiliate_referrals"("referred_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_referrals_affiliate_created_idx"
  ON "affiliate_referrals"("affiliate_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_referrals_status_created_idx"
  ON "affiliate_referrals"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_accruals_fee_event_id_key"
  ON "affiliate_accruals"("fee_event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_accruals_affiliate_created_idx"
  ON "affiliate_accruals"("affiliate_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_accruals_referred_created_idx"
  ON "affiliate_accruals"("referred_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_accruals_bot_created_idx"
  ON "affiliate_accruals"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_accruals_status_created_idx"
  ON "affiliate_accruals"("status", "created_at" DESC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_profiles" ADD CONSTRAINT "affiliate_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_rate_overrides" ADD CONSTRAINT "affiliate_rate_overrides_affiliate_user_id_fkey"
    FOREIGN KEY ("affiliate_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_referrals" ADD CONSTRAINT "affiliate_referrals_affiliate_user_id_fkey"
    FOREIGN KEY ("affiliate_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_referrals" ADD CONSTRAINT "affiliate_referrals_referred_user_id_fkey"
    FOREIGN KEY ("referred_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_accruals" ADD CONSTRAINT "affiliate_accruals_fee_event_id_fkey"
    FOREIGN KEY ("fee_event_id") REFERENCES "fee_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_accruals" ADD CONSTRAINT "affiliate_accruals_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_accruals" ADD CONSTRAINT "affiliate_accruals_affiliate_user_id_fkey"
    FOREIGN KEY ("affiliate_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "affiliate_accruals" ADD CONSTRAINT "affiliate_accruals_referred_user_id_fkey"
    FOREIGN KEY ("referred_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

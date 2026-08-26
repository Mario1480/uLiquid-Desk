-- Stage 1 only: additive Premium entitlement foundation.
-- This migration intentionally does not seed/activate Premium packages and must
-- remain unapplied until Mario grants a separate migration approval.

ALTER TYPE "EffectivePlan" ADD VALUE IF NOT EXISTS 'PREMIUM';

ALTER TABLE "user_subscriptions"
  ADD COLUMN "plan_valid_until" TIMESTAMP(3),
  ADD COLUMN "max_exchange_accounts" INTEGER;

ALTER TABLE "billing_packages"
  ADD COLUMN "max_exchange_accounts" INTEGER;

ALTER TABLE "subscription_terms"
  ADD COLUMN "plan" "EffectivePlan";

-- Preserve the legacy Pro validity cache while introducing the neutral field.
UPDATE "user_subscriptions"
SET "plan_valid_until" = "pro_valid_until"
WHERE "plan_valid_until" IS NULL
  AND "pro_valid_until" IS NOT NULL;

-- Existing term snapshots only contain Free/Pro in the pre-Premium schema.
-- Unknown strings stay NULL so application reconciliation can flag them instead
-- of silently interpreting an unrecognized paid plan.
UPDATE "subscription_terms"
SET "plan" = CASE "entitlement_snapshot" ->> 'plan'
  WHEN 'FREE' THEN 'FREE'::"EffectivePlan"
  WHEN 'PRO' THEN 'PRO'::"EffectivePlan"
  ELSE NULL
END
WHERE "plan" IS NULL;

CREATE INDEX "user_subscriptions_effective_plan_valid_until_idx"
  ON "user_subscriptions"("effective_plan", "plan_valid_until");

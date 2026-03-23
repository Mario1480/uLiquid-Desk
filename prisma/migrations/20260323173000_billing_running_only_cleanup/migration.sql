BEGIN;

CREATE TYPE "BillingPackageKind_new" AS ENUM ('PLAN', 'ADDON');
CREATE TYPE "BillingAddonType" AS ENUM (
  'RUNNING_BOTS',
  'RUNNING_PREDICTIONS_AI',
  'RUNNING_PREDICTIONS_COMPOSITE',
  'AI_CREDITS'
);

ALTER TABLE "billing_packages"
  ADD COLUMN "addon_type" "BillingAddonType",
  ADD COLUMN "ai_credits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "delta_running_bots" INTEGER,
  ADD COLUMN "delta_running_predictions_ai" INTEGER,
  ADD COLUMN "delta_running_predictions_composite" INTEGER;

UPDATE "billing_packages"
SET
  "ai_credits" = COALESCE("topup_ai_tokens", 0),
  "delta_running_bots" = "topup_running_bots",
  "delta_running_predictions_ai" = "topup_running_predictions_ai",
  "delta_running_predictions_composite" = "topup_running_predictions_composite";

ALTER TABLE "billing_packages"
  ALTER COLUMN "kind" TYPE "BillingPackageKind_new"
  USING (
    CASE
      WHEN "kind"::text = 'PLAN' THEN 'PLAN'::"BillingPackageKind_new"
      ELSE 'ADDON'::"BillingPackageKind_new"
    END
  );

ALTER TABLE "billing_order_items"
  ALTER COLUMN "kind_snapshot" TYPE "BillingPackageKind_new"
  USING (
    CASE
      WHEN "kind_snapshot"::text = 'PLAN' THEN 'PLAN'::"BillingPackageKind_new"
      ELSE 'ADDON'::"BillingPackageKind_new"
    END
  );

UPDATE "billing_packages"
SET "addon_type" = CASE
  WHEN "kind" = 'ADDON' AND COALESCE("ai_credits", 0) > 0
    THEN 'AI_CREDITS'::"BillingAddonType"
  WHEN "kind" = 'ADDON'
    AND COALESCE("delta_running_bots", 0) > 0
    AND COALESCE("delta_running_predictions_ai", 0) = 0
    AND COALESCE("delta_running_predictions_composite", 0) = 0
    THEN 'RUNNING_BOTS'::"BillingAddonType"
  WHEN "kind" = 'ADDON'
    AND COALESCE("delta_running_bots", 0) = 0
    AND COALESCE("delta_running_predictions_ai", 0) > 0
    AND COALESCE("delta_running_predictions_composite", 0) = 0
    THEN 'RUNNING_PREDICTIONS_AI'::"BillingAddonType"
  WHEN "kind" = 'ADDON'
    AND COALESCE("delta_running_bots", 0) = 0
    AND COALESCE("delta_running_predictions_ai", 0) = 0
    AND COALESCE("delta_running_predictions_composite", 0) > 0
    THEN 'RUNNING_PREDICTIONS_COMPOSITE'::"BillingAddonType"
  ELSE NULL
END;

ALTER TYPE "BillingPackageKind" RENAME TO "BillingPackageKind_old";
ALTER TYPE "BillingPackageKind_new" RENAME TO "BillingPackageKind";
DROP TYPE "BillingPackageKind_old";

ALTER TABLE "user_subscriptions"
  DROP COLUMN "max_bots_total",
  DROP COLUMN "max_predictions_ai_total",
  DROP COLUMN "max_predictions_composite_total";

ALTER TABLE "billing_packages"
  DROP COLUMN "currency",
  DROP COLUMN "max_bots_total",
  DROP COLUMN "max_predictions_ai_total",
  DROP COLUMN "max_predictions_composite_total",
  DROP COLUMN "topup_ai_tokens",
  DROP COLUMN "topup_running_bots",
  DROP COLUMN "topup_bots_total",
  DROP COLUMN "topup_running_predictions_ai",
  DROP COLUMN "topup_predictions_ai_total",
  DROP COLUMN "topup_running_predictions_composite",
  DROP COLUMN "topup_predictions_composite_total";

ALTER TABLE "subscription_capacity_grants"
  DROP COLUMN "delta_bots_total",
  DROP COLUMN "delta_predictions_ai_total",
  DROP COLUMN "delta_predictions_composite_total";

COMMIT;

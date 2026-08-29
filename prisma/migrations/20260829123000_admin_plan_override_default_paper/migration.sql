-- Add a stable identifier for system-managed exchange accounts.
ALTER TABLE "ExchangeAccount"
ADD COLUMN "system_key" TEXT;

CREATE UNIQUE INDEX "ExchangeAccount_system_key_key"
ON "ExchangeAccount"("system_key");

-- Keep manual access grants separate from commercial subscription state.
CREATE TABLE "admin_plan_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" "EffectivePlan" NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "granted_by_user_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_plan_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_plan_overrides_user_id_key"
ON "admin_plan_overrides"("user_id");

CREATE INDEX "admin_plan_overrides_active_valid_until_idx"
ON "admin_plan_overrides"("active", "valid_until");

ALTER TABLE "admin_plan_overrides"
ADD CONSTRAINT "admin_plan_overrides_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

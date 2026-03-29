ALTER TABLE "users"
  ADD COLUMN "agent_wallet" TEXT,
  ADD COLUMN "agent_wallet_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "agent_secret_ref" TEXT,
  ADD COLUMN "agent_hype_warn_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  ADD COLUMN "agent_last_balance_at" TIMESTAMP(3),
  ADD COLUMN "agent_last_balance_wei" TEXT,
  ADD COLUMN "agent_last_balance_formatted" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_agent_wallet_key" ON "users"("agent_wallet");

ALTER TABLE "bot_vaults"
  ALTER COLUMN "master_vault_id" DROP NOT NULL;

ALTER TABLE "bot_vaults"
  ADD COLUMN "vault_model" TEXT NOT NULL DEFAULT 'legacy_master',
  ADD COLUMN "beneficiary_address" TEXT,
  ADD COLUMN "controller_address" TEXT,
  ADD COLUMN "claimed_profit_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "funding_status" TEXT NOT NULL DEFAULT 'vault_empty',
  ADD COLUMN "hypercore_funding_status" TEXT NOT NULL DEFAULT 'not_funded',
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "closed_at" TIMESTAMP(3);

UPDATE "bot_vaults" bv
SET
  "beneficiary_address" = COALESCE(bv."beneficiary_address", u."wallet_address"),
  "vault_model" = CASE
    WHEN bv."master_vault_id" IS NULL THEN 'bot_vault_v3'
    ELSE bv."vault_model"
  END
FROM "users" u
WHERE u."id" = bv."user_id";

UPDATE "users" u
SET
  "agent_wallet" = mv."agent_wallet",
  "agent_wallet_version" = mv."agent_wallet_version",
  "agent_secret_ref" = mv."agent_secret_ref",
  "agent_hype_warn_threshold" = mv."agent_hype_warn_threshold",
  "agent_last_balance_at" = mv."agent_last_balance_at",
  "agent_last_balance_wei" = mv."agent_last_balance_wei",
  "agent_last_balance_formatted" = mv."agent_last_balance_formatted"
FROM "master_vaults" mv
WHERE mv."user_id" = u."id"
  AND u."agent_wallet" IS NULL
  AND mv."agent_wallet" IS NOT NULL;

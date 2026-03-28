ALTER TABLE "master_vaults"
  ADD COLUMN "agent_wallet" TEXT,
  ADD COLUMN "agent_wallet_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "agent_secret_ref" TEXT,
  ADD COLUMN "agent_hype_warn_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  ADD COLUMN "agent_last_balance_at" TIMESTAMP(3),
  ADD COLUMN "agent_last_balance_wei" TEXT,
  ADD COLUMN "agent_last_balance_formatted" TEXT;

WITH ranked_bot_vault_agents AS (
  SELECT
    bv."master_vault_id",
    bv."agent_wallet",
    bv."agent_wallet_version",
    bv."agent_secret_ref",
    ROW_NUMBER() OVER (
      PARTITION BY bv."master_vault_id"
      ORDER BY
        CASE
          WHEN bv."status" = 'ACTIVE' THEN 0
          WHEN bv."status" = 'PAUSED' THEN 1
          WHEN bv."status" = 'CLOSE_ONLY' THEN 2
          ELSE 3
        END,
        bv."updated_at" DESC,
        bv."created_at" DESC
    ) AS "rn"
  FROM "bot_vaults" bv
  WHERE bv."agent_wallet" IS NOT NULL
)
UPDATE "master_vaults" mv
SET
  "agent_wallet" = ranked."agent_wallet",
  "agent_wallet_version" = COALESCE(ranked."agent_wallet_version", 1),
  "agent_secret_ref" = ranked."agent_secret_ref"
FROM ranked_bot_vault_agents ranked
WHERE ranked."rn" = 1
  AND mv."id" = ranked."master_vault_id"
  AND mv."agent_wallet" IS NULL;


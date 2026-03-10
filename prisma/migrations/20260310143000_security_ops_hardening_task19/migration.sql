ALTER TABLE "bot_vaults"
  ADD COLUMN IF NOT EXISTS "agent_wallet_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "agent_secret_ref" TEXT;

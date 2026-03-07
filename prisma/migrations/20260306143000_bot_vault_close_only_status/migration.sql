-- Add CLOSE_ONLY lifecycle status for BotVault
DO $$ BEGIN
  ALTER TYPE "BotVaultStatus" ADD VALUE IF NOT EXISTS 'CLOSE_ONLY';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Allow explicit zero-value return events for full-loss settlements
ALTER TABLE IF EXISTS "cash_events"
  DROP CONSTRAINT IF EXISTS "cash_events_amount_positive_chk";

DO $$ BEGIN
  ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_amount_non_negative_chk"
    CHECK ("amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

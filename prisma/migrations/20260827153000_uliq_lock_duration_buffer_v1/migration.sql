-- Keep historical projections readable while admitting the buffered ADR-008
-- replacement-locker terms. Runtime validation accepts only 32/185/367 days.
ALTER TABLE "uliq_lock_positions"
  DROP CONSTRAINT IF EXISTS "uliq_lock_positions_duration_allowed";

ALTER TABLE "uliq_lock_positions"
  ADD CONSTRAINT "uliq_lock_positions_duration_allowed"
  CHECK ("duration_days" IN (30, 31, 32, 90, 180, 184, 185, 366, 367))
  NOT VALID;

ALTER TABLE "uliq_lock_positions"
  VALIDATE CONSTRAINT "uliq_lock_positions_duration_allowed";

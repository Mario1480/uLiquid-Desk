-- ADR-008: align the indexed lock-position constraint with the replacement
-- locker terms. Legacy terms remain valid for immutable historical positions;
-- the API and replacement contract only admit 31/184/366-day locks.

ALTER TABLE "uliq_lock_positions"
  DROP CONSTRAINT IF EXISTS "uliq_lock_positions_duration_allowed";

ALTER TABLE "uliq_lock_positions"
  ADD CONSTRAINT "uliq_lock_positions_duration_allowed"
  CHECK ("duration_days" IN (30, 31, 90, 180, 184, 366))
  NOT VALID;

ALTER TABLE "uliq_lock_positions"
  VALIDATE CONSTRAINT "uliq_lock_positions_duration_allowed";

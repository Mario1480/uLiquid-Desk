ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "device_id" TEXT,
  ADD COLUMN IF NOT EXISTS "device_name" TEXT,
  ADD COLUMN IF NOT EXISTS "device_platform" TEXT,
  ADD COLUMN IF NOT EXISTS "app_version" TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
  ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

CREATE INDEX IF NOT EXISTS "Session_userId_deviceId_idx"
  ON "Session"("userId", "device_id");

ALTER TABLE "bot_vaults"
  ALTER COLUMN "grid_instance_id" DROP NOT NULL,
  ADD COLUMN "bot_id" TEXT;

CREATE UNIQUE INDEX "bot_vaults_bot_id_key" ON "bot_vaults"("bot_id");

ALTER TABLE "bot_vaults"
  ADD CONSTRAINT "bot_vaults_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "Bot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

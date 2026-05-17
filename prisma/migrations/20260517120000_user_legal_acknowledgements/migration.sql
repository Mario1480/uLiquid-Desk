CREATE TABLE "user_legal_acknowledgements" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "text_hash" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_legal_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_legal_acknowledgements_user_version_key"
  ON "user_legal_acknowledgements"("user_id", "version");

CREATE INDEX "user_legal_acknowledgements_user_accepted_idx"
  ON "user_legal_acknowledgements"("user_id", "accepted_at" DESC);

CREATE INDEX "user_legal_acknowledgements_version_accepted_idx"
  ON "user_legal_acknowledgements"("version", "accepted_at" DESC);

ALTER TABLE "user_legal_acknowledgements"
  ADD CONSTRAINT "user_legal_acknowledgements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

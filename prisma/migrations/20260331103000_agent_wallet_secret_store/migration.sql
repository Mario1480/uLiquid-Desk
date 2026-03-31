CREATE TABLE "agent_wallet_secrets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "secret_ref" TEXT,
  "encrypted_private_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_wallet_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_wallet_secrets_address_key" ON "agent_wallet_secrets"("address");
CREATE UNIQUE INDEX "agent_wallet_secrets_secret_ref_key" ON "agent_wallet_secrets"("secret_ref");
CREATE UNIQUE INDEX "agent_wallet_secrets_user_version_key" ON "agent_wallet_secrets"("user_id", "version");
CREATE INDEX "agent_wallet_secrets_user_status_idx" ON "agent_wallet_secrets"("user_id", "status");

ALTER TABLE "agent_wallet_secrets"
ADD CONSTRAINT "agent_wallet_secrets_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "wallet_address" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_wallet_address_key"
ON "User"("wallet_address")
WHERE "wallet_address" IS NOT NULL;

CREATE TABLE IF NOT EXISTS siwe_nonces (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  consumed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_for_user_id TEXT,
  CONSTRAINT siwe_nonces_token_hash_key UNIQUE (token_hash),
  CONSTRAINT siwe_nonces_issued_for_user_id_fkey
    FOREIGN KEY (issued_for_user_id) REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS siwe_nonces_expires_at_idx ON siwe_nonces(expires_at);
CREATE INDEX IF NOT EXISTS siwe_nonces_consumed_at_idx ON siwe_nonces(consumed_at);
CREATE INDEX IF NOT EXISTS siwe_nonces_issued_for_user_id_created_at_idx
ON siwe_nonces(issued_for_user_id, created_at DESC);

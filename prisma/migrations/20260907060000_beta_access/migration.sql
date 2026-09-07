CREATE TABLE "beta_access_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "motivation" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "verifiedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "userId" TEXT,
  "provisionedAt" TIMESTAMP(3),
  "provisioningLeaseUntil" TIMESTAMP(3),
  "mailStatus" TEXT NOT NULL DEFAULT 'NONE',
  "mailAttemptId" TEXT,
  "mailAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "beta_access_requests_email_key" ON "beta_access_requests"("email");
CREATE UNIQUE INDEX "beta_access_requests_userId_key" ON "beta_access_requests"("userId");
CREATE INDEX "beta_access_requests_status_createdAt_idx" ON "beta_access_requests"("status", "createdAt");
CREATE TABLE "beta_access_tokens" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES "beta_access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "beta_access_tokens_tokenHash_key" ON "beta_access_tokens"("tokenHash");
CREATE INDEX "beta_access_tokens_requestId_purpose_idx" ON "beta_access_tokens"("requestId", "purpose");
CREATE INDEX "beta_access_tokens_expiresAt_idx" ON "beta_access_tokens"("expiresAt");

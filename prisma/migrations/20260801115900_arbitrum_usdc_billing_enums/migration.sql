-- PostgreSQL requires newly added enum values to be committed before a later
-- transaction can use them in indexes, defaults, predicates, or data writes.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'GRACE';
ALTER TYPE "BillingProvider" ADD VALUE IF NOT EXISTS 'ARBITRUM_USDC';
ALTER TYPE "BillingOrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMING';
ALTER TYPE "BillingOrderStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

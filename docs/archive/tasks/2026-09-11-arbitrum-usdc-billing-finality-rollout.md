# Arbitrum USDC Billing Finality Rollout Evidence

Date: 2026-09-11  
Environment: production  
Application commit: `14a4f167a5461f87c5303a4203afcb7076ad9328`

## Owner direction

Mario requested completion of the controlled Arbitrum USDC Billing rollout. No wallet signature or transaction was inferred from the code and deployment approval; the human wallet approval remains a separate evidence layer.

## Pre-deployment state

- The production billing migrations from 2026-08-01 were applied and not rolled back.
- The dedicated Billing RPC and fallback Arbitrum RPC were configured.
- Payment configuration revision `1` used Arbitrum One chain ID `42161`, native Circle USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, and six decimals.
- Two historical CCPayment orders were `PAID`; no open CCPayment order existed.
- No Arbitrum USDC order, onchain payment row, or subscription term existed.
- Subscription checkout had been enabled since 2026-08-03 without Mainnet canary evidence. It was paused through the admin control before the hardening deployment. AI Credit usage billing remained enabled.

## Change and verification

The payment verifier now requires all of the following before business finalization:

- at least 12 L2 confirmations;
- the receipt block at or below the Arbitrum RPC `finalized` head;
- the canonical block at the receipt height to match the receipt block hash.

The missed-payment discovery scanner also limits its log range to the finalized head. Finality-tag failures remain retryable and cannot activate an order. The admin Billing page exposes the finalized head, and the user order page explains the wait when the L2 confirmation threshold has been reached but network finality is still pending.

Verification results:

- API Billing tests: 125 passed, 0 failed.
- Web Billing tests: 8 passed, 0 failed.
- API typecheck: passed.
- Web typecheck: passed.
- Web i18n integrity: passed.
- Production API and web image builds: passed.
- Production API health: healthy.
- Production web health and `/en/login`: healthy / HTTP 200.
- Billing startup reconciliation: zero pending checks, zero retries, zero review items, and no error.
- Subscription lifecycle startup: zero due transitions and no error.
- Production RPC after deployment: chain ID `42161`, token code present, decimals `6`, and distinct current latest, safe, and finalized heads.
- Browser readiness: rendered latest and finalized RPC blocks, exact USDC address, configuration revision `1`, and `Ready` status.

## Canary gate

Checkout was opened briefly through the protected Platform Superadmin flow for a 10 USDC AI Credit canary. Order creation failed closed before a database order or wallet request because the signed-in admin account's linked wallet equals the configured Treasury. This is the expected `sender_treasury_conflict` / `payment_config_not_ready` boundary.

Checkout was immediately disabled again. The post-attempt database state remained:

- `billingEnabled=false`;
- `aiCreditBillingEnabled=true`;
- two historical `CCPAYMENT|PAID` orders;
- zero Arbitrum USDC orders;
- zero submitted transactions and zero capital movement.

## Remaining action

Use a separate known user account linked to a funded sender wallet that is not the Treasury. After fresh human review and signature, reconcile the transaction through finalized network state, Treasury receipt, the unique paid order, the single AI Credit ledger grant, the expected balance delta, and the empty review queue. Only then may checkout be re-enabled for the initial production observation window and the active rollout plan be archived.

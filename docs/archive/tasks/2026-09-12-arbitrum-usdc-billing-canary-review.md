# Arbitrum USDC Billing Mainnet Canary Review

Date: 2026-09-12  
Environment: production  
Application commits: `c7ec5f2bfd0a7cf3ee936c91ce0292a73e280be6`, `027ad5c230277f6e8a44e19e059d03e1b93109b5`, `d38042b6730f386a649aee721186922fac7eaac8`

## Scope and decision state

Mario created and signed one low-value Arbitrum One payment from the separate Firefox canary account. This file records the reconciled evidence for the resulting `REVIEW_REQUIRED` order. It does not authorize the pending entitlement repair, a refund, or checkout reactivation.

Current decision: pending fresh owner approval for a reviewed paid-resolution repair. The checkout safety switch is closed.

## Immutable order evidence

- Order ID: `cmty3hsrg0n8eqj1yt5p0n12v`
- Merchant order ID: `ULIQUID_7c5ef90c-5997-4068-8464-393b2b25757b`
- Provider: `ARBITRUM_USDC`
- Product: `capacity_topup_ai_predictions_unit`, quantity `1`
- Product effect: one additional running AI prediction capacity unit
- Amount: `500` cents / `5,000,000` native USDC raw units
- Created at: `2026-09-12T08:00:17.116Z`
- Checkout expiry: `2026-09-13T08:00:16.742Z`
- Scan boundary: block `504329571`
- Expected sender: `0xa7a53774f9abdaff5f1c5d194a865c88fe1301ef`
- Treasury snapshot: `0x45878083b2267b0846d6626f716484420c03deeb`, configuration revision `1`
- Chain ID: `42161`
- Token: native Circle USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831`, decimals `6`

## Onchain evidence

- Transaction: `0x50d58e54fa5219de9bdd616a1639f2203f0ab551e7f227a57f1ca9925bc82fc7`
- Transaction sender: the immutable expected sender above
- Transaction destination: the native USDC token contract above
- Native ETH value: `0`
- Receipt status: success (`1`)
- Receipt block: `504330371`
- Receipt block hash: `0x2a1dffd1e7d697ffc678150c42405aadbb3ddd3d377a8de08ed0d0815d1d5d79`
- Canonical block hash at the receipt height: exact match
- Matching USDC `Transfer`: exactly `5,000,000` raw units from the expected sender to the immutable Treasury snapshot
- Network finality was reached at `2026-09-12T08:23:25Z`; the verifier persisted `verifiedAt=2026-09-12T08:23:46.992Z`
- Evidence snapshot at approximately `2026-09-12T08:46Z`: latest `504340590`, safe `504337640`, finalized `504336219`
- Transaction-hash ownership count: `1`

The payment itself satisfies the current automated chain, sender, token, Treasury, value, amount, block-window, receipt, finality, and canonical-block invariants.

## Application findings

The canary exposed two finalization defects after the payment had become network-finalized and one confirmation-UX issue:

1. The subscription advisory lock selected the PostgreSQL `void` return value directly. Prisma could not deserialize it. Commit `c7ec5f2bf` casts the lock result to text, matching the established quota-admission pattern.
2. Checkout eligibility used the resolved effective plan, including an active admin override, while add-on finalization inspected only the commercial subscription row. The canary account has commercial `FREE` plus an active `PREMIUM` override through `2027-08-29T23:59:59.999Z`. Commit `027ad5c2` makes finalization use the same higher valid override and bounds the capacity grant to that override expiry.
3. The checkout previously exposed the internal network-finality wait as a user-visible confirmation wait. Commit `d38042b6` introduces the `payment_received` acknowledgement after the API validates the exact successful Treasury receipt. The UI then shows "Payment confirmed" immediately and continues finality polling in the background, while the order remains `CONFIRMING` and no entitlement is granted before final settlement.

Verification after all three fixes:

- API Billing tests: `127` passed, `0` failed.
- Web Billing tests: `9` passed, `0` failed.
- API typecheck: passed.
- Web typecheck and i18n validation: passed.
- Production API and web image builds: passed.
- Production API and web health: healthy.
- No further Prisma advisory-lock deserialization error occurred after `c7ec5f2bf`.
- The production API and web run `d38042b6730f386a649aee721186922fac7eaac8`.
- Authenticated visual acceptance of the new receipt state remains unobserved because the available Chrome automation channel could not load its request-header policy. No synthetic production order or payment was created for UI testing; the next valid receipt remains the visual observation point.

## Current database and entitlement state

- Order: `REVIEW_REQUIRED`
- `paymentStatusRaw`: `finalization:paid_plan_required_for_capacity_topup`
- Payment `lastError`: `finalization:paid_plan_required_for_capacity_topup`
- Verification attempts: `25`
- Subscription commercial state: `FREE|ACTIVE`
- Active admin override: `PREMIUM`, valid through `2027-08-29T23:59:59.999Z`
- Terms for this order: `0`
- Capacity grants for this order: `0`
- AI Credit ledger entries for this order: `0`
- Existing base AI prediction capacity: `1`
- Entitlement synchronization pending: `false`
- Review queue: exactly `1`, this order
- Checkout flags: `billingEnabled=false`, `aiCreditBillingEnabled=true`

No entitlement was granted and no refund was initiated.

## Required reviewed forward repair

After fresh owner approval, resolve this exact order as paid through an auditable, serializable, idempotent forward repair that:

1. claims only the exact order and transaction hash above;
2. rechecks the persisted verified receipt evidence and unique hash ownership;
3. creates exactly one capacity grant with source key `order:cmty3hsrg0n8eqj1yt5p0n12v:capacity:0`, scope `PREMIUM`, delta AI predictions `1`, and validity through the admin override expiry;
4. changes the order to `PAID` without changing the historical onchain evidence;
5. persists an `AdminAuditEvent` referencing this evidence file and Mario's approval;
6. runs entitlement reconciliation and verifies effective AI prediction capacity `2`;
7. confirms zero terms and zero AI Credit ledger entries, because this is a capacity add-on rather than a plan or AI Credit top-up.

Checkout may be reconsidered only after this review item is closed, the corrected state is verified, and Mario separately accepts activation.

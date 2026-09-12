# Arbitrum USDC Billing Checkout Activation Observation

Date: 2026-09-12
Environment: production
Application commit: `0efaffef701bccbbf9c6d91ea759d4820515562e`

## Scope

Mario re-enabled the protected subscription checkout and independently submitted a genuine 10 USDC Arbitrum One payment in Firefox. This record separates the user's wallet action from the application, deployment, browser, database, entitlement, and finality evidence collected afterward. No additional transaction, refund, manual entitlement mutation, or payment-state mutation was performed during this review.

## Observed user experience

MetaMask reported the transaction as submitted and the payment completed successfully. Immediately afterward, the checkout displayed the fallback message:

> The transaction was sent but could not yet be linked to the order. Submit it again or check the status.

The instruction was misleading because the transaction hash had already been persisted before the submit endpoint encountered a temporary receipt-availability failure. The page also fetched status periodically but did not actively retry same-hash association or reconciliation, so the visible state could lag until a manual check or the 30-second server reconciler ran.

## Implemented correction

Commit `0efaffef` changes only the client tracking behavior:

- after the wallet returns a transaction hash, the page immediately preserves the submitted state and explains that tracking continues automatically;
- the copy explicitly tells the user not to send again;
- the separate resend button is removed;
- a non-overlapping three-second loop refreshes the authoritative order state;
- while the order is still pending, the loop idempotently retries association of the same stored hash;
- while the order is pending or confirming, the loop requests reconciliation and tolerates temporary receipt or RPC propagation failures until the next poll;
- the manual status button remains available as an optional check and uses the same safe tracking path.

The loop never requests another wallet transaction and the browser remains non-authoritative for payment or entitlement decisions.

## Verification

Local verification:

- Web TypeScript check: passed.
- Web i18n integrity check: passed.
- Web Billing tests: `10` passed, `0` failed.
- Diff whitespace validation: passed.

Deployment verification:

- Commit `0efaffef701bccbbf9c6d91ea759d4820515562e` was pushed to `main` and deployed through the production web deployment workflow.
- The production web and API containers were healthy after deployment.
- `https://desk.uliquid.vip/en/login` returned HTTP `200`.
- The unauthenticated order URL returned the expected redirect.
- The production API health endpoint returned `{"ok":true}`.
- An authenticated Chrome session loaded the German production checkout, its available packages, and the current AI Credit balance after deployment.

## Order, entitlement, and finality evidence

- Order ID: `cmty8bo93018lpf1zi3o1f32d`
- Merchant order ID: `ULIQUID_41cd9345-7d73-41d1-8298-e5b6b33abf79`
- Amount: `1000` cents / 10 USDC
- Transaction: `0xbbeb003be106f729aeeac199f009f992134d4051694ca9384dd78d2847409431`
- Order status: `PAID`
- Payment status: `onchain_confirmed`
- Paid at: `2026-09-12T10:16:07.853Z`
- Verified at: `2026-09-12T10:32:06.343Z`
- Confirmations at the final evidence read: `3942`
- Payment `lastError`: `null`
- AI Credit ledger entries for the order: exactly `1`
- Capacity grants for the order: `0`
- Subscription terms for the order: `0`

The order therefore produced the one expected artifact for an AI Credit top-up and reached final settlement without duplication or manual repair.

## Final owner acceptance

Mario subsequently completed another genuine 10 USDC AI Credit purchase in Firefox with the automatic tracking build and confirmed that the payment flow completed correctly. The resulting evidence was:

- Order ID: `cmty9j22y00qpmj1yc3qhtn9s`
- Merchant order ID: `ULIQUID_1d284a64-8c04-41b0-b07a-9ddbe9d82a99`
- Transaction: `0xc2bb845e84090e5cea36d47a397e1331485d52176f2c127a843bd154c992f2a9`
- Amount: `1000` cents / 10 USDC
- Order status: `PAID`
- Payment status: `onchain_confirmed`
- Paid at: `2026-09-12T10:49:28.279Z`
- Verified at: `2026-09-12T11:04:03.901Z`
- Payment `lastError`: `null`
- AI Credit ledger entries for the order: exactly `1`
- Capacity grants for the order: `0`
- Subscription terms for the order: `0`

The automatic status tracking, receipt-time activation, final settlement, and exact entitlement outcome are therefore production-observed and owner-accepted. A follow-up UI-only release in commits `c98f7a6d` and `a57484c7` removed duplicate success feedback and compacted the desktop and mobile checkout layout without changing billing behavior.

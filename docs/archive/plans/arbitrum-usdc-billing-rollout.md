---
icon: landmark
---

# Arbitrum USDC Billing Rollout

## Purpose and status

This plan governs the controlled replacement of the retired CCPayment checkout with direct native USDC payments on Arbitrum One.

Current production status on 2026-09-12:

- The billing schema migrations, API, web checkout, reconciliation jobs, subscription lifecycle, package administration, Treasury configuration, and dedicated Billing RPC are deployed.
- The production Treasury configuration is revision `1` and the RPC reports Arbitrum One chain ID `42161`, the expected native USDC contract, six decimals, and working `safe` and `finalized` block tags.
- Two historical CCPayment orders are `PAID`; there are no open CCPayment orders.
- One 5 USDC Arbitrum One capacity-add-on canary was paid from the separate sender account and independently verified through network finality, canonical block equality, and the exact Treasury `Transfer` event.
- The canary exposed an advisory-lock result decoding defect and an effective-plan mismatch between checkout and finalization for active admin plan overrides. Both code defects are fixed and deployed in `c7ec5f2bf` and `027ad5c2`; the reviewed order was subsequently resolved through the normal idempotent finalizer after fresh owner approval.
- Receipt acknowledgement and reversible service activation are separated from final settlement as of `ec074035`: after the API proves the successful exact Treasury transfer in the current canonical block, it immediately activates the product and shows "Activated" while parent-chain finality continues automatically in the background.
- Mario re-enabled subscription checkout through the protected admin flow and completed the first post-activation purchase: a 10 USDC AI Credit top-up. The order became `PAID`, created exactly one AI Credit ledger entry, and subsequently reached `onchain_confirmed` with no payment error.
- The first post-activation purchase exposed misleading client fallback copy after the wallet send and a reliance on manual status refresh. Commit `0efaffef` removes the resend instruction and button, preserves the submitted state, and automatically retries only the same idempotent transaction-hash association and reconciliation every three seconds.
- Mario completed a second genuine 10 USDC AI Credit purchase with the automatic tracking build and accepted the payment flow. The order activated immediately after receipt validation, finalized without error, and created exactly one AI Credit ledger entry. Commits `c98f7a6d` and `a57484c7` subsequently removed duplicate success feedback and compacted the responsive checkout layout without changing the payment state machine.
- Network-finality hardening was deployed from commit `14a4f167a` while checkout was paused. Production API and web health, the finalized RPC head, token code, token decimals, empty reconciliation queues, and the rendered admin readiness view were verified.
- The first canary attempt was safely rejected before order creation because the signed-in admin account's linked wallet is also the configured Treasury. The second attempt used the separate sender account successfully.
- The controlled rollout is complete. Routine payment, RPC, entitlement, and reconciliation monitoring continues under normal billing operations.

Code, deployment, browser behavior, wallet signature, transaction inclusion, network finality, Treasury receipt, database reconciliation, entitlement activation, and owner acceptance are separate evidence layers.

## Fixed production parameters

| Parameter | Required value |
| --- | --- |
| Network | Arbitrum One |
| Chain ID | `42161` |
| Token | Native Circle USDC |
| USDC contract | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Token decimals | `6` |
| Minimum L2 confirmations | `12` |
| Irreversibility gate | Receipt block at or below the RPC `finalized` head, with matching canonical block hash |
| Order lifetime | `24 hours` |
| Subscription grace period | `3 days` |

There is no custom payment contract and no approval flow. The connected user wallet calls `USDC.transfer(treasury, amountRaw)` directly and pays gas in ETH.

## Payment flow

1. `POST /settings/subscription/checkout` creates an order with immutable snapshots of the linked sender wallet, Treasury, Treasury revision, chain, token, amount, package lines, and checkout block boundary.
2. The browser verifies the wallet, chain, USDC balance, and ETH gas balance before requesting the direct ERC-20 transfer.
3. `POST /settings/subscription/orders/:id/submit` records only the transaction hash. Submission never grants entitlements.
4. The API independently reads the transaction, receipt, logs, latest L2 head, `finalized` head, and canonical receipt block from the server Billing RPC.
5. After the API proves a successful receipt with the exact sender, token, Treasury, native value, amount, and current canonical block hash, it persists `paymentStatusRaw=payment_received`. In the same idempotent business finalization, the order becomes `PAID`, the plan or add-on is activated, and the browser shows "Activated" without further user action.
6. A provisionally paid `payment_received` order remains in the background reconciliation queue. The API continues checking at least 12 L2 confirmations, the RPC `finalized` head, and the canonical receipt block hash.
7. Final settlement changes `paymentStatusRaw` to `onchain_confirmed` and records `verifiedAt`. A later canonical contradiction routes the already activated order to `REVIEW_REQUIRED` for explicit operator handling; it never creates a duplicate entitlement or automatic refund.
8. The background discovery scanner searches only finalized USDC logs for open Treasury snapshots. It can recover a payment if the browser closes after sending.

The payment reconciler runs every 30 seconds. Subscription lifecycle and reminders run hourly. Cursor overlap, compare-and-swap transitions, unique keys, and idempotency keys prevent replay and duplicate activation.

## Security invariants

A payment may finalize only when all of the following are true:

- The server RPC reports chain ID `42161`.
- The transaction succeeded and was not reverted.
- `transaction.from` matches the wallet linked at checkout.
- `transaction.to` is the fixed native USDC contract.
- The transaction carries no native ETH value.
- The receipt contains exactly one matching USDC `Transfer` event from the expected sender to the Treasury snapshot.
- The raw amount equals `priceCents × 10,000`; no floating-point arithmetic is used.
- The transaction hash belongs to no other order.
- The receipt block is not earlier than the checkout scan boundary.
- At least 12 L2 confirmations exist.
- The receipt block is at or below the RPC `finalized` head.
- The canonical block at the receipt height has the same hash as the stored receipt.

Additional boundaries:

- The client is never authoritative for payment or entitlement state.
- Each user may have only one open payable Arbitrum USDC order.
- Treasury address and revision are immutable per order; rotation affects new orders only.
- RPC or finality-tag failures remain retryable and never activate a purchase.
- User-visible activation and irreversible network settlement are separate states. `payment_received` confirms an observed exact Treasury receipt in the current canonical block, marks the order `PAID`, and grants the reversible service entitlement before parent-chain finality.
- A temporary RPC or finality retry after activation preserves the service entitlement and keeps the payment in background verification.
- Early activation is an explicit product-risk decision for reversible uLiquid service access. Irreversible fund release or external crediting remains forbidden before the `finalized` gate.
- Wrong chain, wallet, token, Treasury, amount, native value, replay, ambiguous transfer, reverted receipt, or canonical block mismatch routes the order to `REVIEW_REQUIRED`.
- `REVIEW_REQUIRED` never triggers automatic activation or refund.
- Validated receipt evidence is persisted before idempotent business activation, and finality evidence is persisted separately so a process restart can resume safely.

## Readiness and configuration

The API uses a dedicated server-side RPC:

```dotenv
BILLING_ARBITRUM_RPC_URL=https://<trusted-arbitrum-one-rpc>
```

Production must explicitly configure this value. The public browser RPC is not a payment authority.

The admin Billing page must show all of the following before activation:

- a valid Treasury address and revision;
- chain ID `42161`;
- the exact native USDC contract and six decimals;
- a current latest RPC block;
- a current finalized RPC block not ahead of latest;
- a successful check timestamp and no RPC error.

Changing the Treasury requires Platform Superadmin access, exact duplicate address entry, recent re-authentication, and an `AdminAuditEvent`. Enabling checkout requires Platform Superadmin access, explicit cutover confirmation, and recent re-authentication. Disabling checkout remains the immediate safety control and does not stop reconciliation of obligations that already exist.

## Subscription and notification behavior

- Paid periods are stored as immutable `SubscriptionTerm` rows with start, end, grace end, and entitlement snapshots.
- Early renewals append to the existing paid chain. A renewal during grace starts at the prior contractual end; a purchase after grace starts at payment confirmation.
- A Pro-to-Premium in-term upgrade charges the full package price difference and preserves the existing term window and credit-cycle markers.
- Add-ons become effective at their target term and do not leak into an unrelated future term.
- Monthly AI Credit grants use unique cycle keys and never grant early solely because a renewal was purchased.
- After the three-day grace period, the subscription falls back to Free and entitlement synchronization is retried until successful.
- End-of-term notifications are deduplicated by term, milestone, and channel, with bounded retry and verified-email fallback where available.

## Monitoring and manual review

During the canary and initial rollout, observe:

- open `PENDING` and `CONFIRMING` orders and their age;
- L2 confirmations and delay to the finalized head;
- `REVIEW_REQUIRED` grouped by `paymentStatusRaw` and `lastError`;
- transaction-hash collisions and ambiguous discovery candidates;
- RPC errors, retries, backoff, and scan-cursor progress;
- `PAID` to the exact expected artifact: one term for a plan, one capacity grant for a capacity add-on, or one AI Credit ledger entry for an AI Credit top-up;
- due `SCHEDULED`, `ACTIVE`, `GRACE`, and `EXPIRED` terms;
- notification retry and failure rows.

Relevant structured logs include `billing_onchain_reconcile_cycle`, `billing_onchain_discovery_cycle_failed`, `billing_onchain_submitted_reconcile_cycle_failed`, `billing_subscription_lifecycle_cycle`, and `subscription_reminder_cycle`.

Use [Billing payment review and refund](../../runbooks/billing-payment-review-refund.md) for any exception. A screenshot or user-supplied hash is never enough to activate or refund an order.

## Controlled completion sequence

- [x] Stop new CCPayment checkouts and remove the active CCPayment runtime.
- [x] Reconcile the historical CCPayment population: two paid, zero open.
- [x] Deploy the billing migrations and application.
- [x] Configure a dedicated production Billing RPC and verify Arbitrum One.
- [x] Configure the Treasury through the protected flow.
- [x] Pause checkout before the finality hardening deployment.
- [x] Deploy the network-finality hardening while checkout remains paused.
- [x] Confirm deployed readiness includes a healthy finalized block head.
- [x] Run one low-value Mainnet canary from the known operator account and wallet after a fresh human transaction approval.
- [x] Reconcile transaction receipt, 12 confirmations, finalized head, canonical block hash, and Treasury receipt.
- [x] Resolve the reviewed capacity-add-on canary after fresh owner approval, then verify exactly one paid order, exactly one capacity grant, zero terms, zero AI Credit ledger entries, effective AI prediction capacity `11`, and audit evidence.
- [x] Re-enable checkout through the protected admin flow after explicit owner acceptance.
- [x] Observe the first post-activation payment through receipt-time activation and final settlement; confirm one expected AI Credit ledger entry, no duplicate entitlement, no stale pending or review state, and no RPC payment error.
- [x] Remove the misleading resend instruction and deploy automatic same-hash status tracking.
- [x] Observe the automatic tracking message and status transition during the next genuine submitted payment, without creating a synthetic payment solely for acceptance.
- [x] Record owner acceptance, verify the exact resulting entitlement and final settlement, and archive this plan.

An isolated Sepolia transaction is not a production prerequisite because the production implementation is intentionally fixed to Arbitrum One and native Mainnet USDC. Contract, amount, replay, reorg, RPC-failure, and lifecycle behavior are covered by deterministic tests; the production-path confidence gate is the low-value Mainnet canary above.

## Stop criteria

Keep or return checkout to disabled when any of the following occurs:

- chain, token, decimals, Treasury, latest head, or finalized head is invalid;
- an RPC does not reliably serve Arbitrum One `finalized` blocks;
- a payment activates zero or multiple terms;
- transaction replay or discovery assignment is not unique;
- underpayment or overpayment escapes `REVIEW_REQUIRED`;
- Treasury rotation or activation lacks the expected protected operation;
- grace downgrade, capacity, license, workspace, or AI Credit synchronization diverges;
- a canonical block hash changes at or below the reported finalized head.

Do not perform a manual entitlement correction or refund until the onchain and database evidence has been reconciled and the capital-moving action has fresh explicit approval.

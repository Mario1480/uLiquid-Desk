# Billing Payment Review and Refund

## Purpose

This runbook defines the fail-closed operator process for an Arbitrum USDC order in `REVIEW_REQUIRED`. It does not authorize a Treasury transaction, database correction, entitlement grant, or refund. Each capital-moving or entitlement-changing action requires fresh explicit owner approval after the evidence packet is complete.

## Safety rules

- Disable new subscription checkout before investigating a production payment anomaly.
- Never accept a screenshot, copied transaction hash, wallet notification, or source-balance change as final evidence.
- Never edit a historical payment, order, term, credit ledger, or audit row in place.
- Never resubmit a user payment or send a Treasury refund merely because an RPC temporarily failed.
- Preserve the original sender, Treasury revision, token, raw amount, scan boundary, receipt block, and block hash.
- Treat retry, paid resolution, entitlement correction, and refund as different decisions.
- A refund is complete only after the outbound Treasury transaction is network-finalized and the recipient balance/event is reconciled.

## Evidence packet

Capture a dated task file under `docs/archive/tasks` containing:

- order ID and merchant order ID;
- provider and current order status;
- expected sender and immutable Treasury snapshot/revision;
- chain ID, token address, token decimals, and expected raw amount;
- submitted or discovered transaction hash;
- transaction sender, destination, native value, receipt status, receipt block/hash, and matching USDC events;
- latest, safe, and finalized heads from the configured Billing RPC;
- canonical block hash at the receipt height;
- existing transaction-hash ownership, terms, capacity grants, AI Credit ledger entries, and entitlement-sync state;
- `paymentStatusRaw`, `lastError`, retry count, and timestamps;
- operator, decision, owner approval reference, and post-action reconciliation.

Do not include secrets, RPC URLs containing credentials, private keys, seed phrases, session cookies, access tokens, or personal production data beyond the minimum identifiers needed for the audit.

## Decision tree

### Retry without mutation

Use this only for a transient RPC, receipt-availability, or finality-delay condition. Keep the order non-terminal, restore no entitlement manually, and let the normal reconciler prove the payment. If the order is already `REVIEW_REQUIRED`, fix the underlying deterministic defect first and use a reviewed forward repair; do not change the status directly in the database.

### Resolve as paid

Resolve as paid only when the original payment satisfies every current automated invariant, including network finality and canonical block-hash equality. Prefer a code fix plus the normal idempotent finalizer. A one-off repair must:

1. run inside a serializable transaction;
2. claim only the exact reviewed order and transaction hash;
3. create or reuse exactly one term by its unique order relation;
4. preserve idempotent AI Credit and capacity grant keys;
5. persist an admin audit event with the evidence reference;
6. run entitlement reconciliation and verify the resulting user, workspace, and license state.

If any invariant remains false, paid resolution is forbidden.

### Refund

Use refund only when the Treasury received value that must not activate the purchase. Before requesting a signature, independently verify the amount actually received from the original sender. The authorized signer must review the Arbitrum One chain, native USDC contract, refund recipient, exact raw amount, and estimated ETH gas.

After signing, record the outbound transaction hash in the dated evidence file and verify:

- successful receipt on Arbitrum One;
- direct native USDC transfer from the approved Treasury to the original sender;
- exact approved raw amount;
- at least 12 L2 confirmations;
- receipt block at or below the `finalized` head;
- canonical block hash equal to the refund receipt block hash;
- no subscription term, capacity grant, or AI Credit grant was created for the rejected order.

The original order remains historical evidence. Do not rewrite it to `PAID`. Record the refund as an audited operational decision and keep any accounting entry append-only.

## Idempotency checks

Before every retry or correction, verify the transaction hash is owned by only one payment and the order has at most one term. Before a refund, search the evidence store and Treasury history for an existing outbound refund for the same order. If ownership or prior action is ambiguous, stop.

After any action, rerun the complete evidence query and compare the result with the pre-action packet. Re-enable checkout only after the anomaly is closed, the queue contains no unexplained entries, and owner acceptance is recorded.

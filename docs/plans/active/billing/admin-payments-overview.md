# Admin payments overview

Date: 2026-09-12
Status: Deployed to production with runtime, source-hash and read-only database verification. Authenticated production browser acceptance remains open.

Release authorization (2026-09-12): Mario explicitly requested committing and pushing this change to main, followed by a production redeploy. Production deployment and read-only smoke checks are now authorized. Payment, wallet, refund and entitlement mutation actions remain outside this release.

Local results and file inventory: [Implementation evidence](../../../archive/tasks/2026-09-12-admin-payments-overview.md).

Release results: [Production deployment evidence](../../../archive/tasks/2026-09-12-admin-payments-production-deploy.md). Application commit: `7db64eea4c17d4050fb73d8a6f8091dc64aca8ff`.

## Decisions

- Reuse BillingOrder, BillingOrderItem, BillingOnchainPayment, SubscriptionTerm, SubscriptionCapacityGrant, AiCreditLedger, and UserSubscription. No schema changes or migrations.
- Add read-only GET /admin/billing/orders and GET /admin/billing/orders/:id, protected by requireAuth and requirePlatformSuperadmin, matching the global platform inventory boundary.
- Use bounded page/pageSize pagination, stable createdAt/id descending ordering, search by user ID/email/order/hash, provider/status and inclusive UTC date filters. Do not invoke checkout, reconciliation, lifecycle, RPC, or entitlement mutation services while reading.
- Return an explicit field allowlist; serialize BigInt as decimal strings. Never return raw provider payloads/responses, webhook bodies, URLs containing credentials, or arbitrary error messages.
- Add /admin/licenses/payments using existing Admin and Desk/Ein components, English/German translations, a responsive table and independently loaded details.
- Prefer immutable item names/code/kind over the current catalog. Mark legacy catalog fallbacks. Display order currency separately from the onchain token/raw amount.
- Separate order status, raw provider status, recorded network verification, order-linked term/grant evidence, and current subscription-wide sync status. Counts prove records exist, not complete fulfillment or currently usable entitlements. Legacy orders and immediate upgrades can lack a directly linked term; do not infer activation from the current subscription.

## Risks and scope

- Existing filters may scan order/user data at large volumes; retain bounded pages and assess production query plans before introducing indexes.
- Reads are database snapshots, not fresh RPC/finality verification. Current subscription sync state is not per-order historical proof. Term status is the persisted lifecycle state; show timestamps and grant expiry.
- API/jobs own existing payment CAS/idempotency, retry/backoff, network finality, and entitlement reconciliation. Runner, contracts and ULIQ benefit flows require no change for this observer.
- The initial implementation excluded production access, commits, pushes and deployment. The subsequent authorization above permits the scoped release and its read-only verification. No new migration, payment, wallet action or entitlement activation is included.

## Validation and acceptance

- API tests: authentication/authorization before reads, invalid filters, stable pagination, safe output, snapshot fallback, BigInt, pending/finalized payment evidence, linked term/grant/sync distinctions, missing detail and generic failures.
- Web tests: payment formatting and status presentation; API/Web typechecks, billing regression suites, i18n integrity, diff hygiene.
- Browser: isolated synthetic fixtures at desktop, 390 px and 360 px; search/filter/page, detail, errors/retry, keyboard focus, translated labels and horizontal containment.
- Manual environment acceptance: platform superadmin opens Admin > Licenses > Payments; locate existing orders by user, merchant ID and hash; inspect mixed cart, pending payment, paid/scheduled term, add-on grants, review-required and legacy orders. Compare existing persisted evidence read-only. Non-superadmins must receive 403 and unauthenticated requests 401.
- Keep release and authenticated real-data acceptance explicitly separate from local checks.

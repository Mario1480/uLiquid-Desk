# Admin payments overview: local implementation evidence

Date: 2026-09-12
Scope: Read-only admin checkout history; implementation and local validation only.

## Result

- New Payments tab under Admin > Licenses, at `/admin/licenses/payments` (localized `/en` and `/de` paths).
- GET `/admin/billing/orders` and GET `/admin/billing/orders/:id` require authentication and platform superadmin authorization. Existing billing configuration permissions are unchanged.
- The list covers user/email, merchant order ID, timestamp, immutable item snapshots and quantities, explicit amount/currency, order/payment states and linked entitlement evidence. Details expose the transaction/explorer, payment timestamps and retry state, linked term dates/status, bounded credit/capacity records, and current subscription sync evidence.
- Filtering supports user ID/email, order ID, merchant ID, transaction hash, provider, order status and inclusive UTC date ranges. Page size defaults to 25 and is capped at 100; ordering is createdAt descending, then id descending. Detail credit/grant groups are capped at 100 with an explicit truncation notice.
- Explicit query/output field selection omits provider payloads, webhook data, credentials and arbitrary internal errors. BigInt amounts and block numbers are returned as decimal strings. No runtime payment or entitlement mutation service is called.
- No Prisma schema/migration, runner, contract, ULIQ benefit, checkout or reconciliation changes.

## Changed source and documentation

| Area | Files |
| --- | --- |
| API projection, query and routes | `apps/api/src/billing/adminOrders.ts`, `apps/api/src/billing/routes.ts` |
| API regression coverage | `apps/api/src/billing/adminOrders.test.ts`, `apps/api/package.json` |
| Payment list and details | `apps/web/app/admin/licenses/payments/page.tsx`, `apps/web/app/admin/licenses/payments/PaymentDetails.tsx` |
| Typed presentation and tests | `apps/web/src/billing/adminPayments.ts`, `apps/web/src/billing/adminPayments.test.ts` |
| Existing shared admin components | `apps/web/app/admin/_components/AdminTable.tsx`, `AdminPagination.tsx`, `AdminSectionNav.tsx`, `admin-sections.ts` (same directory) |
| Layout and translations | `apps/web/app/styles/settings-admin.css`, `apps/web/messages/en/admin.json`, `apps/web/messages/de/admin.json` |
| Documentation | `docs/README.md`, `docs/admin/billing-licenses-and-notifications.md`, `docs/plans/active/billing/admin-payments-overview.md`, this evidence file |

The shared table/pagination additions are optional props with backward-compatible defaults. EinUI material primitives were not changed.

## Local validation

Environment: Node 20.20.2, clean isolated worktree at task start. Dependencies installed locally and Prisma Client generated without database migration or connection. Internal workspace packages built in dependency order.

| Check | Result |
| --- | --- |
| `npm -w apps/api run test:billing` | Passed: 136 tests, including 7 new admin order tests |
| `npm -w apps/api run typecheck` | Passed |
| `npm -w apps/web run test:billing` | Passed: 13 tests, including 3 new admin presentation tests |
| `npm -w apps/web run typecheck` | Passed |
| `npm -w apps/web run i18n:check` | Passed |
| `npm -w apps/web run test:einui` | Passed: 16 tests |
| `node scripts/verify_einui.mjs` | Passed: existing registry, inventory, license, prefix and route isolation checks |
| `git diff --check` | Passed |

API coverage checks authentication and platform authorization before reads, invalid filters, UTC boundaries, deterministic pagination/count filters, snapshot fallback, exact large integers, absence of raw payloads, submitted versus verified payments, scheduled terms, current sync evidence, detail truncation limits, missing orders and sanitized failures.

## Browser evidence

An isolated Playwright browser used a local synthetic read-only API at port 4417 and Next.js dev at port 3317. No real session, wallet or database was used. The fixture used the actual API projection to produce order responses. Local processes were stopped after the smoke.

- English and German routes rendered successfully.
- Search reduced 27 fixtures to one order; filtering resets pagination to page 1. Order-status selection reduced the fixture set to five paid rows.
- Page 2 showed fixtures 25 and 26; no-match filters showed the localized empty state.
- An injected list failure showed the translated error and unavailable state; reset restored the list.
- An independently injected detail failure left the list available. Refresh recovered the detail view after removing the injected failure.
- Opening details focused the details region. Closing restored focus to the merchant-order button. The button is in the first column so mobile users can open details without scrolling to the end of the table.
- At desktop 1440 px, mobile 390 px and mobile 360 px, document width matched viewport width. The table scrolls within its own container. Detail fields and hashes wrap on mobile.
- Filter, table and details surfaces computed to the central dense material: `rgba(20, 33, 53, 0.94)` with `blur(20px)`. The existing EinUI select portal was exercised. No dialog or material primitive changes were made.
- Screenshots and browser logs are local artifacts under `/Users/marioeuchner/.codex/visualizations/2026/09/12/01a095b6-902b-7ae1-9197-1df25ab319ed/admin-payments`.

An initial loopback-host rewrite loop was resolved by starting Next.js and accessing the browser with the same `localhost` hostname. No repository routing change was needed.

## Manual acceptance path

1. In a separately authorized test environment, sign in as a platform superadmin and open Admin > Licenses > Payments.
2. Locate existing records using email, merchant ID and transaction hash. Exercise status/provider/date filters, an empty result and the next/previous page controls.
3. Open an existing mixed plan/add-on order. Compare snapshot names, quantities, currency, amounts, transaction hash, recorded verification time and linked records against the stored database evidence.
4. Inspect pending/confirming, review-required, active/scheduled term, standalone add-on, expired and legacy/upgrade orders. Confirm that payment, historical term status and current subscription sync remain distinct.
5. Confirm submitted hashes without verifiedAt remain pending verification, missing term/grant linkage does not claim activation, and sync without a success timestamp remains unknown.
6. Verify 401 without authentication and 403 for ordinary users or delegated backend admins who are not platform superadmins. Verify at desktop, 390 px and 360 px, including focus return and a failed detail request.
7. Do not create a payment, activate an entitlement or trigger a refund for this acceptance. Use existing data and read-only comparisons.

## Remaining gates and limits

- No live PostgreSQL integration or production data query was performed. Actual query latency and authenticated environment acceptance remain unverified.
- Large history searches/counts, particularly related credit-ledger counts, may require query-plan analysis and separately reviewed indexes. No speculative migration was introduced. Offset pages can shift when new orders arrive; list/count reads are not an immutable accounting snapshot.
- Records are persisted evidence, not fresh network verification or proof of complete/current entitlement fulfillment. Current subscription sync is not per-order history; old orders and immediate upgrades can lack a direct term link.
- No commit, push, deployment, production change, payment, wallet action or activation was performed. Release remains explicitly gated in the active plan.

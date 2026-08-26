# Premium Plan Gating - Stage 5 Subscription UI and Immediate Upgrade

Date: 2026-08-26

## Status

Stage 5 is code-complete and locally verified. No database migration, package reconciliation, deployment, checkout activation or live payment was executed.

## Product decision implemented

- Pro to Premium becomes effective immediately after the difference payment is confirmed.
- The difference is the target package list price minus the immutable source-term list-price evidence. It is not time-prorated.
- The existing term start, end and grace end stay unchanged. This is duration-neutral and therefore supports a future annual pair when both source and target packages use the same `billingMonths`; no annual package or annual price was introduced here.
- A scheduled future term, expired/grace-only source term, mismatched duration, missing price evidence or changed term state fails closed.
- Existing capacity grants, AI Credit balance, reservations, ledger history, grant counters and next grant timestamp are preserved. The Premium recurring grant amount takes effect at the next existing monthly cycle; no retroactive partial-cycle credits are minted.
- The paid order retains its target-package snapshot plus explicit upgrade metadata. The active term records an append-only upgrade-history entry while keeping its original order link.

## API and frontend contract

- `GET /settings/subscription` now exposes the display name, base/add-on/effective quotas, current usage, real exchange-account usage with Paper explicitly excluded, the canonical plan catalog and an evidence-backed upgrade preview.
- Subscription cards show Free / Pro / Premium prices and entitlements from the canonical backend catalog.
- Upgrade CTAs distinguish Pro and Premium. A Pro-to-Premium CTA is clickable only when the backend can safely produce the immediate-upgrade preview and the Premium package is active.
- The order page shows the difference rather than the full Premium list price for an eligible upgrade and keeps the authoritative backend checkout amount.
- Admin package editing supports Premium and `maxExchangeAccounts`; a blank exchange-account limit means commercially unlimited.

## Verification

- API typecheck: passed.
- Web typecheck: passed.
- API billing suite: 117 tests passed.
- Targeted lifecycle suite: 55 tests passed, including monthly and future annual-duration difference pricing and fail-closed conflicts.
- Web i18n integrity: passed.

## Remaining rollout gates

- The additive Premium migration remains unexecuted.
- Stage 4 reconciliation/backfill remains unexecuted.
- `premium_monthly` remains inactive by default, so Stage 5 does not expose an always-denied checkout action.
- Browser smoke, isolated staging migration/dry-run, Premium package activation, payment canary and deployment require their separately approved rollout steps.

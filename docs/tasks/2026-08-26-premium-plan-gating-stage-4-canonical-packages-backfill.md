# Premium Plan Gating - Stage 4 Canonical Packages and Backfill Tooling

Date: 2026-08-26

## Status

Stage 4 is code-complete and locally verified as preparation for an isolated staging run.

No database migration, package reconciliation, subscription/term backfill, deployment or production enablement was executed. The Stage 0 prerequisite remains authoritative: data reconciliation may run only after Premium-compatible code and the additive schema migration are deployed to the approved target under a separate Gate B approval.

## Implemented scope

- One typed canonical package catalog defines:
  - Free: $0, 1 real exchange account, 2 shared bot slots, 0 AI schedules, 0 composite schedules and 0 recurring AI Credits.
  - Pro Monthly: $29, commercial unlimited exchange accounts, 5 shared bot slots, 3 AI schedules, 2 composite schedules and 10,000 monthly AI Credits.
  - Premium Monthly: $69, commercial unlimited exchange accounts, 15 shared bot slots, 10 AI schedules, 5 composite schedules and 30,000 monthly AI Credits.
  - Each capacity add-on remains $5/month and is plan-neutral in package storage so the existing paid-plan resolver can make it valid for Pro and Premium.
  - AI topups remain 10k/$10, 25k/$25, 50k/$50 and 100k/$100.
- `premium_monthly` is created inactive by the reconciler. Checkout/UI activation remains a later rollout gate.
- The reconciliation command defaults to dry-run and produces:
  - scanned/create/update/unchanged/review counts,
  - before and projected-after entitlement aggregates,
  - a field-level change list,
  - a review list for rows that cannot be classified safely.
- Apply mode requires both `PREMIUM_STAGE4_COMPATIBLE_CODE_DEPLOYED=true` and the exact confirmation `APPLY_PREMIUM_STAGE4`.
- Apply mode uses row-version compare-and-set updates for terms/subscriptions. Concurrently changed rows are placed in the review output instead of being overwritten.
- `SubscriptionTerm.plan` is classified only from consistent typed plan, entitlement snapshot and linked plan-order evidence. Missing or conflicting evidence is reviewed; it never defaults upward to Pro or Premium.
- Active, grace and scheduled Pro term entitlement snapshots are versioned as `billing-entitlement/v2` and reconciled to 5/3/2/10k while retaining dates, linked orders, add-on lines and grant-cycle fields.
- Free and Pro subscription entitlement fields are projected to their canonical base limits. Existing AI credit balances, reservations, ledger rows, orders and payment evidence are outside every mutation payload.
- Paid-plan validity is dual-written to `planValidUntil` and the compatibility field `proValidUntil`; the legacy column is retained.
- Legacy paid capacity grants remain valid across Pro and Premium, while Free cannot consume them.
- Capacity add-ons are excluded from ULIQ discounts. In mixed plan/capacity carts, only the plan line is discount-eligible; AI-credit-only carts retain the AI-credit discount path.
- The manual `set-user-plan` operator command now requires an explicit Free/Pro/Premium plan, reads canonical quotas and no longer grants a hidden one-million-credit fallback.

## Reconciliation command

The commands below are documented only; no database-connected invocation was performed in this stage.

```bash
# Default/read-only projection after Gate B target approval and compatible deployment
npm -w apps/api run reconcile:premium-stage4 -- --dry-run --report ./stage4-report.json

# Write mode only after reviewing the dry-run and receiving separate approval
PREMIUM_STAGE4_COMPATIBLE_CODE_DEPLOYED=true \
  npm -w apps/api run reconcile:premium-stage4 -- \
  --apply --confirm APPLY_PREMIUM_STAGE4 --report ./stage4-apply-report.json
```

Report files use exclusive creation and will not overwrite an existing evidence artifact.

## Verification

- API typecheck: passed.
- Stage 4 reconciliation and ULIQ targeted tests: passed.
- Full API billing suite: 114 tests passed.
- Full API ULIQ suite: 56 tests passed.
- `git diff --check`: passed.
- Apply safety probe without the compatible-deployment environment gate: failed closed with `stage4_compatible_deployment_not_confirmed` before any database query.

## Still open / separate authority required

- Product approval for Pro-to-Premium activation timing is still open. Current billing behavior schedules the next paid plan after the existing paid term; no immediate proration behavior was introduced.
- No live/read-only database census or Stage 4 dry-run was performed because the required compatible deployment/schema target is not yet established.
- Gate B must separately authorize the exact isolated staging target, deployment, additive migration, dry-run and any subsequent apply run.
- Premium checkout remains inactive. Production migration, deployment and enablement require their own later approval and staging evidence.

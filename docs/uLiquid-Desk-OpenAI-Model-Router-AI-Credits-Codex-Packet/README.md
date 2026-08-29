# uLiquid Desk OpenAI Model Router and AI Credits

This packet extends the planned AI Agent Chat with production-oriented OpenAI model routing and cost-based AI credit accounting.

## Confirmed scope

- OpenAI is the only initial AI provider.
- Model selection is server-controlled and capability-aware.
- OpenAI usage is paid from a prepaid AI credit balance.
- Credits are reserved before a run and settled from actual usage afterward.
- Failed or abandoned reservations require deterministic release or recovery.
- Tool-specific OpenAI charges must be represented separately in the pricing registry.
- Users and operators need clear balance, usage, failure, and reconciliation visibility.

## Pricing snapshot

The original packet recorded a pricing snapshot dated 2026-08-03. Pricing is time-sensitive and must be verified against current official OpenAI pricing before configuration or rollout. Do not treat values in planning documents as a live billing source.

## Architecture principles

- Keep the model catalog and pricing registry server-side.
- Resolve the effective model from capability, policy, user plan, and operational availability.
- Use idempotent ledger entries and reservation identifiers.
- Store provider usage and cost evidence without storing secrets or unnecessary prompt content.
- Separate user-facing credits from provider currency calculations.
- Fail closed when balance, pricing, authorization, or reservation state is uncertain.
- Reconcile interrupted runs and surface unresolved reservations to operators.

## Packet contents

### Specifications

- `specs/01-current-state.md` — verified repository baseline.
- `specs/02-model-routing.md` — model catalog and routing rules.
- `specs/03-credit-billing.md` — credit accounting and pricing.
- `specs/04-data-model.md` — persistence model.
- `specs/05-api-ui.md` — API, user UI, and admin surfaces.
- `specs/06-security-observability.md` — safety, audit, and operations.
- `specs/07-rollout-tests.md` — testing and staged rollout.

### Implementation workstreams

- `agents/01-schema-and-migration.md`
- `agents/02-pricing-engine.md`
- `agents/03-credit-ledger-reservations.md`
- `agents/04-openai-responses-provider.md`
- `agents/05-model-router.md`
- `agents/06-agent-run-integration.md`
- `agents/07-api-ui-admin-tests.md`

Use `CODEX-MASTER-PROMPT.md` for packet execution. This packet remains active until migration, rollout, billing reconciliation, security, and acceptance gates are complete.

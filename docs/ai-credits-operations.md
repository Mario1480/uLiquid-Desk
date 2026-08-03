# OpenAI Router and AI Credits Operations

## Scope

The production AI path is OpenAI-only. The API key is read from the existing encrypted Admin API Keys setting; no second credential or client-visible key is used. Users select an agent profile and skills, while the server selects GPT-5 nano, GPT-5.6 Luna, Terra, or Sol.

AI output remains analysis-only. This rollout does not enable autonomous exchange actions.

## Deployment order

1. Back up Postgres and verify no AI agent run is active.
2. Deploy the schema migration `20260803110000_openai_model_router_ai_credits`.
3. Deploy API and Web with `AI_CREDIT_BILLING_V2=false`, `AI_MODEL_ROUTER_V1=false`, `AI_RESPONSES_API_AGENT=false`, and `AI_DEEP_ANALYSIS_ENABLED=false`.
4. Verify the Admin OpenAI credential health, `/api/billing/ai-credits`, `/api/ai/runs/estimate`, pricing revisions, and an unbilled read-only Agent Chat smoke.
5. Enable the Admin `aiCreditBillingEnabled` setting.
6. Enable `AI_MODEL_ROUTER_V1=true` and `AI_RESPONSES_API_AGENT=true` for internal Agent Chat users.
7. Enable `AI_CREDIT_BILLING_V2=true` for a controlled canary and verify reserve, usage, settle, release, and idempotent retry evidence.
8. Enable Deep Analysis separately only after Sol reservation estimates and per-run limits have been approved.

No old token balances or token ledger entries are migrated. The previous system was unused; the migration resets those values before the direct credit cutover.

## Required monitoring

- active or expired `ai_credit_reservations`
- reservations in `RECONCILIATION_REQUIRED`
- failed and reconciliation-required `ai_usage_records`
- provider versus retail microusd by model class
- reserved credits compared with subscription reserved totals
- OpenAI response and request IDs for provider reconciliation
- HTTP errors for balance, daily, monthly, run, pricing, and settlement limits

Prompt bodies and decrypted API keys must never be included in metrics, traces, or admin responses.

## Failure handling

- A failure before provider usage releases the reservation.
- Confirmed usage is recorded and settled even if later parsing or tool orchestration fails.
- An incomplete or ambiguous provider response marks the reservation for reconciliation and does not guess a charge.
- Pricing lookup ambiguity or absence fails closed before dispatch.
- No automatic model fallback is allowed for a routed paid request.

## Rollback

1. Set `AI_CREDIT_BILLING_V2=false` to stop new reservations and charges.
2. Keep the migrated tables and usage evidence intact; do not reverse the migration after billable runs exist.
3. Allow active provider calls to complete, then settle confirmed usage and manually reconcile ambiguous reservations.
4. Roll back application code only after the active reservation count is zero.
5. Do not restore the retired token-debit path or copy credit values into legacy token fields.

Production migration, feature activation, canary traffic, and reconciliation are explicit operator actions and are not performed by repository tests.

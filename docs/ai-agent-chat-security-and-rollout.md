# AI Agent Chat – Security, Operations and Rollout

Stand: 2026-09-04

## Scope

The Agent Chat is a separate read-only product surface. It does not share persistence, routes, prompts or tool policy with the Prediction Builder. The first release contains the `Market Analyst` and `Position Copilot` profiles. Trade drafts and all execution capabilities are excluded.

## Server gates

- `AI_AGENT_CHAT_ENABLED` is the master gate and defaults to off in production.
- `AI_AGENT_ACCOUNT_READS_ENABLED` controls private portfolio skills. Production deploys now default it to `true`; an operator can explicitly export `false` for rollback.
- `AI_POSITION_COPILOT_ENABLED` controls read-only manual Position Copilot analysis. Production deploys default it to `true`; plan capability and account ownership checks still apply.
- `AI_POSITION_MONITORING_ENABLED` controls automatic position-change and periodic analysis. Production deploys default it to `true`; an operator can close either Position gate explicitly for rollback.
- `AI_AGENT_CUSTOM_PROFILES_ENABLED` controls user profile overrides.
- `AI_AGENT_TRADE_DRAFTS_ENABLED` remains off. The read-only runtime rejects draft and execution action levels even when configuration is incorrect.
- `AI_AGENT_CHAT_TIMEOUT_MS` controls the complete agent run window and defaults to 90 seconds. `API_AGENT_CHAT_REQUEST_TIMEOUT_MS` defaults to 120 seconds so the HTTP layer remains open longer than the run budget.
- Product capabilities `product.ai_agent_chat`, `product.ai_agent_account_reads` and `product.ai_agent_custom_profiles` are evaluated on every request. Admin preview bypasses the product license only; it does not bypass the environment master gate.
- Pro unlocks Agent Chat and the public-data Market Analyst profile. Premium is required for Position Copilot, private account reads, position monitoring, multi-exchange private analysis and user-defined profiles.
- An explicit Enterprise strategy license inherits Premium product capabilities, but never bypasses `AI_AGENT_CHAT_ENABLED`, `AI_AGENT_ACCOUNT_READS_ENABLED`, ownership checks or the read-only runtime policy.

## Enforced boundaries

- The runtime registry contains only descriptors with `sideEffect: false`.
- Unknown tool names, skills outside the resolved profile and market-type capability mismatches fail closed.
- User and account IDs are never model arguments. Private tools accept only `accountRef: selected`; the server resolves the account from conversation context and repeats ownership checks for every call.
- Account reads never fall back to another venue. Public market reads may fall back only when the requested venue is `auto`; the result and activity record mark that fallback.
- Position risk uses the versioned `position.snapshot.v1` and `position.risk.v1` routines, with compatibility exports preserving existing Position Copilot callers. No nested AI call is made and deterministic warnings cannot be removed by a tool.
- Every skill has a concrete output schema. A result that fails output validation is recorded as `agent_chat_tool_result_invalid` and is never exposed to the model as trusted evidence.
- Funding, OI and order-book snapshots expose provider/source venue, observed/fetched timestamps, age, timestamp source, quality, fallback and warning codes. A missing provider timestamp is degraded rather than presented as fresh.
- User text, market intelligence and tool results are wrapped as untrusted data. Tool arguments, results, errors and audit summaries pass through recursive secret redaction.
- A deterministic scope guard handles clearly off-topic requests, courtesy-only messages and obvious prompt-override attempts before model routing or credit reservation. Guarded requests produce a persisted zero-credit response without exposing tools.
- Per-user request limits, one concurrent run per user, four tool iterations, twelve calls, two calls per skill, a bounded 30-180 second run timeout (90 seconds by default) and bounded payloads constrain cost and resource abuse.

## Persistence and retention

Conversations and messages are user-owned and cascade on user deletion. Runs store profile/context snapshots and compact metadata. Tool activity stores only redacted arguments and result summaries, not candle arrays, complete prompts, credentials or raw exchange payloads. The authenticated Decision Log endpoint projects user-owned runs, validated assistant blocks, evidence provenance, quality and read-only permissions from existing records. It does not introduce a new table. A production retention period for run/tool activity must be approved with the legal/operations policy before General Availability; conversations remain user-managed product data.

## Operations signals

The persisted run and tool-call models expose status, provider/model, latency, token usage, skill/routine versions, output schema, venue, quality, degraded/fallback state and stable error code. `AiTraceLog` receives a compact `agent_chat` summary plus the assistant message ID used for exact Decision Log association. Legacy runs use a bounded timestamp association and are explicitly labeled. High-cardinality tool payloads and secret values are intentionally absent.

## Rollout

1. Internal: enable only `AI_AGENT_CHAT_ENABLED`, use Market Analyst, and verify Binance, Hyperliquid and Bitget public reads.
2. Limited Beta: account reads are enabled for admins and plans with `product.ai_agent_account_reads`; validate ownership denial, stale data and provider degradation.
3. General read-only: enable custom profiles after activity, cost and error-rate review.
4. Trade drafts: not part of this release; requires a separate security review and Mario's explicit approval.

## Rollback

Set `AI_AGENT_CHAT_ENABLED=false` and restart API/web services through the normal deployment procedure. Do not roll back the additive migration solely to disable the feature. Existing conversations remain stored while API and navigation access are closed. Prediction Builder, Predictions, Prediction Copier, Trading Desk, wallets, vaults and billing do not depend on the Agent Chat tables.

To close only private account reads while keeping Market Analyst available, deploy the API with `AI_AGENT_ACCOUNT_READS_ENABLED=false ./scripts/deploy_prod.sh api`.

To close Position Copilot and automatic monitoring without changing plan entitlements, deploy the API with `AI_POSITION_COPILOT_ENABLED=false AI_POSITION_MONITORING_ENABLED=false ./scripts/deploy_prod.sh api`.

## Known first-release constraints

- Responses are atomic with pollable persisted activity; streaming/SSE is not enabled.
- Private position/open-order reads are initially limited to perpetual accounts. Public spot market analysis uses the existing spot/CCXT client layer.
- Activity retention duration and production allowlist administration remain operational configuration decisions.
- The first cold Agent Chat test run can pause while the third-party Hyperliquid SDK is loaded from the local filesystem. The 2026-09-04 Phase 1 acceptance isolated that import delay; after loading, the full suite completed and exited normally without forced termination.

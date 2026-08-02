# AI Agent Chat – Security, Operations and Rollout

Stand: 2026-08-02

## Scope

The Agent Chat is a separate read-only product surface. It does not share persistence, routes, prompts or tool policy with the Prediction Builder. The first release contains the `Market Analyst` and `Position Copilot` profiles. Trade drafts and all execution capabilities are excluded.

## Server gates

- `AI_AGENT_CHAT_ENABLED` is the master gate and defaults to off in production.
- `AI_AGENT_ACCOUNT_READS_ENABLED` controls private portfolio skills.
- `AI_AGENT_CUSTOM_PROFILES_ENABLED` controls user profile overrides.
- `AI_AGENT_TRADE_DRAFTS_ENABLED` remains off. The read-only runtime rejects draft and execution action levels even when configuration is incorrect.
- Product capabilities `product.ai_agent_chat`, `product.ai_agent_account_reads` and `product.ai_agent_custom_profiles` are evaluated on every request. Admin preview bypasses the product license only; it does not bypass the environment master gate.

## Enforced boundaries

- The runtime registry contains only descriptors with `sideEffect: false`.
- Unknown tool names, skills outside the resolved profile and market-type capability mismatches fail closed.
- User and account IDs are never model arguments. Private tools accept only `accountRef: selected`; the server resolves the account from conversation context and repeats ownership checks for every call.
- Account reads never fall back to another venue. Public market reads may fall back only when the requested venue is `auto`; the result and activity record mark that fallback.
- Position risk uses `buildPositionCopilotSnapshot` and `buildDeterministicPositionAnalysis`. No nested AI call is made and deterministic warnings cannot be removed by a tool.
- User text, market intelligence and tool results are wrapped as untrusted data. Tool arguments, results, errors and audit summaries pass through recursive secret redaction.
- Per-user request limits, one concurrent run per user, four tool iterations, twelve calls, two calls per skill, a 20-second run timeout and bounded payloads constrain cost and resource abuse.

## Persistence and retention

Conversations and messages are user-owned and cascade on user deletion. Runs store profile/context snapshots and compact metadata. Tool activity stores only redacted arguments and result summaries, not candle arrays, complete prompts, credentials or raw exchange payloads. A production retention period for run/tool activity must be approved with the legal/operations policy before General Availability; conversations remain user-managed product data.

## Operations signals

The persisted run and tool-call models expose status, provider/model, latency, token usage, skill, venue, degraded/fallback state and stable error code. `AiTraceLog` receives a compact `agent_chat` summary for existing AI operations visibility. High-cardinality tool payloads and secret values are intentionally absent.

## Rollout

1. Internal: enable only `AI_AGENT_CHAT_ENABLED`, use Market Analyst, and verify Binance, Hyperliquid and Bitget public reads.
2. Limited Beta: enable account reads for an explicit allowlist/capability cohort and validate ownership denial, stale data and provider degradation.
3. General read-only: enable custom profiles after activity, cost and error-rate review.
4. Trade drafts: not part of this release; requires a separate security review and Mario's explicit approval.

## Rollback

Set `AI_AGENT_CHAT_ENABLED=false` and restart API/web services through the normal deployment procedure. Do not roll back the additive migration solely to disable the feature. Existing conversations remain stored while API and navigation access are closed. Prediction Builder, Predictions, Prediction Copier, Trading Desk, wallets, vaults and billing do not depend on the Agent Chat tables.

## Known first-release constraints

- Responses are atomic with pollable persisted activity; streaming/SSE is not enabled.
- Private position/open-order reads are initially limited to perpetual accounts. Public spot market analysis uses the existing spot/CCXT client layer.
- Activity retention duration and production allowlist administration remain operational configuration decisions.

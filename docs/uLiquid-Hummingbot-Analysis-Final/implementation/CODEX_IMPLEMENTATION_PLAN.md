# Codex Implementation Plan

## Principle
**No big-bang rewrite.** Consolidate existing uLiquid foundations first. Add Hummingbot-specific interfaces and feature flags only for the isolated POC, and keep existing exchange paths until the Decision Gate passes.

## Workstream 0 — Preflight
Map existing exchange adapters, market data, bot/execution state, AI Predictions/Agents, credential storage and Hyperliquid/Vault boundaries. Produce a dependency graph before edits.

## Phase 1 — Consolidate Quick Wins
Extend and test the existing foundations:
- extract reusable deterministic Routines from calculations already embedded in Agent Chat and Position Copilot
- extend the existing typed Agent Skill catalog and permission checks; do not create a parallel production Skill runtime
- extend the existing Futures Capability Registry with provider, data-quality and certification dimensions
- project structured, user-facing Decision Logs from existing Agent Run, Tool Call, Message and Trace records before adding new persistence
- add derived Funding, open-interest and order-book analytics with freshness, provenance and quality metadata

Use existing uLiquid providers and data paths. Do not introduce Hummingbot or migrate existing adapters in this phase.

## Phase 2 — Shared Data and Existing AI Upgrade
Build a provider-neutral Shared Market Data foundation and a versioned Feature Registry with snapshot/provenance support. Upgrade the existing Market Analyst and Position Copilot to consume the Phase 1 Skills, shared features and Decision Logs. Keep Market Analyst read-only and Position Copilot recommendation-only.

Shared Market Data is uLiquid-owned and must proceed regardless of the later Hummingbot POC result. It may initially use the existing native providers.

## Phase 3 — New Product Features
Implement deterministic Arbitrage and XEMM Scanners with fees, slippage, depth, inventory readiness and opportunity scoring. Scanner-only: no automated cross-market execution.

## Phase 4 — Parallel Infrastructure Validation
After the Phase 1 contract review, define and test the provider-neutral Exchange Gateway by extending the existing futures adapter and capability foundations. Add provider health, canonical execution identities and idempotency boundaries. Create an isolated `hummingbot-provider-poc` for Bitget so native and Hummingbot paths can be compared without changing product-facing APIs.

Build a certification harness for authentication, data, orders, fills, reconnects, restarts, rate limits, idempotency, reconciliation, tenant isolation, latency and resource usage.

This workstream may run in parallel with Phases 2–3. It must not force Hummingbot-specific DTOs or lifecycle assumptions into the Shared Market Data, Agent or Scanner contracts.

## Decision Gate
Classify the Bitget POC as `PASS`, `PARTIAL` or `FAIL` from recorded evidence. Do not continue to production Hummingbot adoption merely because the happy path can place an order.

## Phase 5 — If the POC Is Successful
Add the production Hummingbot CEX Provider to the existing Shared Market Data and Exchange Gateway contracts. POC and certify TWAP and DCA independently, then certify additional exchanges one connector/market/executor combination at a time.

## Phase 6 — Advanced
### Phase 6A — Bot Architect Drafts
Add Bot Architect with BotSpec validation and simulation/paper mode. It cannot deploy live.

### Phase 6B — Approved Bot Deployment
Allow deployment only through an explicit approval flow followed by fresh-state, capability and risk validation.

### Phase 6C — Automated Arbitrage
Proceed only after dual-leg idempotency, capital reservation, reconciliation and recovery are proven.

### Phase 6D — XEMM
Proceed only after an independent Hedge Watchdog, maximum-unhedged-duration policy and emergency recovery are proven.

### Phase 6E — Autonomous Agents
Policy-constrained autonomous Agents come last and require the complete permission, risk, audit, replay, evaluation and kill-switch stack.

## Required engineering rules
- No raw HB DTOs outside provider module.
- No raw exchange credentials outside Credential Service.
- No direct Agent → provider execution.
- Every monetary request uses ExecutionIntent + idempotency + fresh-state validation.
- Every provider action is reconciled.
- All AI/skill/routine/provider versions are observable.
- Pin Hummingbot versions and test upgrades through canary/shadow workflows.

## Definition of Done for Phase 1
The existing Routines, typed Skills, Capability Registry and Agent observability foundations have been consolidated without parallel implementations. Decision Logs and Funding/OI/Orderbook Analytics are tested, observable and integrated through existing uLiquid boundaries without introducing Hummingbot dependencies.

### Phase 1 implementation record (2026-09-04)

- Added a static typed Routine Registry for technical indicators, Position Copilot snapshot/risk, Funding, OI and order-book analytics.
- Extended the existing Futures Capability Registry with stable provider identity, per-field native/linked/unsupported support and conservative live-certification state.
- Consolidated Agent Skill market-data reads through the existing normalized clients, added concrete output validation and persisted skill/routine provenance.
- Added the authenticated Decision Log projection and upgraded the existing right-side activity surface without adding a Prisma model or migration.
- Kept Market Analyst and Position Copilot read-only. No Hummingbot dependency, execution tool, trade draft, credential change or deployment was introduced.

Verification on 2026-09-04:

- Futures Core: 16/16 tests passed.
- Futures Exchange: 162/162 tests passed across core, CEX and Hyperliquid suites.
- Agent Chat, routines and derivatives normalization: 50/50 tests passed and the process exited normally.
- Focused Position Copilot: 13/13 tests passed.
- Agent Chat UI: 7/7 tests passed; English/German translation integrity passed.
- Targeted TypeScript validation for every changed Agent Chat web module passed. The repository-wide web TypeScript command generated route types, then stalled without diagnostics at zero CPU in the local environment and was stopped after a bounded wait.
- The API TypeScript command reported only pre-existing errors outside the Phase 1 files in billing, dashboard and ULIQ modules.
- Browser-level Decision Log acceptance passed for fresh Market Analyst evidence, auto fallback, stale Position Copilot evidence, unsupported BingX data, recent-run selection, technical-activity disclosure and a 390 px mobile viewport without horizontal overflow. This used the production React component in an isolated local harness because the full Next development route stalled before its first response; authenticated end-to-end acceptance remains a separate target-environment check.
- `git diff --check` passed.

The implementation is complete at code and focused-test level. Full authenticated browser E2E and live provider certification remain open and must not be inferred from fixture or component evidence.

## Definition of Done for the Phase 4 Decision Gate
The Bitget Hummingbot provider has a recorded `PASS`, `PARTIAL` or `FAIL` result from the POC/certification suite and can be switched on/off without changing product-facing APIs. Only `PASS` authorizes consideration of the full Phase 5 scope; each production connector and executor still requires its own certification.

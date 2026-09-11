# Codex Implementation Plan

## Principle
**No big-bang rewrite.** Consolidate existing uLiquid foundations first. Add Hummingbot-specific interfaces and feature flags only for the isolated POC, and keep existing exchange paths until the Decision Gate passes.

## Workstream 0 — Preflight
Map existing exchange adapters, market data, bot/execution state, AI Predictions/Agents, credential storage and Hyperliquid/Vault boundaries. Produce a dependency graph before edits.

## Phase 1 — Consolidate Quick Wins — `COMPLETE`
Extend and test the existing foundations:
- [x] extract reusable deterministic Routines from calculations already embedded in Agent Chat and Position Copilot
- [x] extend the existing typed Agent Skill catalog and permission checks; do not create a parallel production Skill runtime
- [x] extend the existing Futures Capability Registry with provider, data-quality and certification dimensions
- [x] project structured, user-facing Decision Logs from existing Agent Run, Tool Call, Message and Trace records before adding new persistence
- [x] add derived Funding, open-interest and order-book analytics with freshness, provenance and quality metadata

Use existing uLiquid providers and data paths. Do not introduce Hummingbot or migrate existing adapters in this phase.

## Phase 2 — Shared Data and Existing AI Upgrade — `COMPLETE`
Build a provider-neutral Shared Market Data foundation and a versioned Feature Registry with snapshot/provenance support. Upgrade the existing Market Analyst and Position Copilot to consume the Phase 1 Skills, shared features and Decision Logs. Keep Market Analyst read-only and Position Copilot recommendation-only.

Shared Market Data is uLiquid-owned and must proceed regardless of the later Hummingbot POC result. It may initially use the existing native providers.

The active [Phase 2 implementation plan](PHASE_2_IMPLEMENTATION_PLAN.md). Phase 2 is complete by Mario’s full-test confirmation and owner acceptance on 2026-09-07. Shared data, versioned features, existing AI upgrades, bounded provider histories and persisted evidence are accepted. Earlier test records remain historical evidence, not new benchmark measurements.

## Phase 3 — New Product Features — `COMPLETE`
The [Phase 3 implementation plan](PHASE_3_IMPLEMENTATION_PLAN.md) records the deterministic Arbitrage and XEMM Scanners with size-aware fees, slippage, depth, inventory readiness, freshness evidence and opportunity scoring. Production deployment and authenticated desktop/mobile acceptance completed on 2026-09-09 under Mario's delegated acceptance request. The implementation remains scanner-only: no automated cross-market execution, private balance read, credential use or persistence path was added.

## Phase 4 — Parallel Infrastructure Validation — `COMPLETE — PARTIAL`
After the Phase 1 contract review, define and test the provider-neutral Exchange Gateway by extending the existing futures adapter and capability foundations. Add provider health, canonical execution identities and idempotency boundaries. Create an isolated `hummingbot-provider-poc` for Bitget so native and Hummingbot paths can be compared without changing product-facing APIs.

Build a certification harness for authentication, data, orders, fills, reconnects, restarts, rate limits, idempotency, reconciliation, tenant isolation, latency and resource usage.

This workstream may run in parallel with Phases 2–3. It must not force Hummingbot-specific DTOs or lifecycle assumptions into the Shared Market Data, Agent or Scanner contracts.

## Decision Gate — `CLOSED — PARTIAL`
The 2026-09-08 evidence accepts the bounded public-data, restart and public WebSocket reconnect slice. Private execution, recovery and multi-account scaling remain unassessed. Mario deferred this certification on 2026-09-10 until a separate Bitget Demo API Key and bounded test window are available; the connected live account is excluded from Hummingbot execution testing. Phase 5 remains gated.

## Phase 5 — If the POC Is Successful — `PREPARATION COMPLETE — IMPLEMENTATION GATED`
Add the production Hummingbot CEX Provider to the existing Shared Market Data and Exchange Gateway contracts. POC and certify TWAP and DCA independently, then certify additional exchanges one connector/market/executor combination at a time.

The [Phase 5 preparation plan](PHASE_5_PREPARATION_PLAN.md) records the completed architecture, interface, isolation, observability, rollback and certification design. It does not permit runtime integration, credentials, orders, migrations, deployment or provider switching.

## Phase 6 — Advanced — `GATED`
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

## Area 4 and Area 5 coverage register

This register is the authoritative roadmap mapping for
[`04_AGENTS_CONDOR_ARCHITECTURE.md`](../04_AGENTS_CONDOR_ARCHITECTURE.md) and
[`05_SKILLS_SYSTEM.md`](../05_SKILLS_SYSTEM.md). Their local Phase A–G and P1–P3 labels are
area-specific maturity or priority labels, not additional consolidated roadmap phases.

An item appearing in either analysis must be represented below as completed, assigned to a
consolidated phase, separately gated, optional, or rejected. Being described in an analysis does
not by itself authorize implementation, production execution or Hummingbot adoption.

| Area 4/5 capability | Consolidated placement | Current disposition |
|---|---|---|
| Deterministic Routine Registry, typed Skill catalog, output validation, profile compatibility, permission checks, invocation provenance and Decision Logs | Phase 1 | `COMPLETE` within the accepted Phase 1 scope; extend the existing implementation rather than create a parallel registry/runtime |
| Market Analyst and Position Copilot read-only analytical Skills using Shared Market Data, feature snapshots and bounded histories | Phase 2 | `COMPLETE` within the accepted Phase 2 scope; additional skill breadth remains separately planned below |
| Skill Standard controls: schemas, deterministic routines, freshness/provenance/confidence, explainability, least-context retrieval, security tests, versioning and audit | Phases 1–2 foundation; mandatory for every later phase | Accepted Phase 1–2 controls are `COMPLETE` within their recorded scope; every new Skill must satisfy all applicable controls before its phase can close |
| Cross-market `arbitrage-scan`, `xemm-analysis`, funding/basis analysis and exchange-capability enrichment | Phase 3 | `COMPLETE` within the accepted scanner/read-only scope; no automated execution, private balance read or credential authority was added |
| Additional read-only analytical breadth: volatility regime, support/resistance, deeper SMC, trade plans, correlation, bot review and strategy comparison | Phase 3 or the consuming Phase 6A product scope | `NOT STARTED`; prioritize through a phase implementation plan rather than treating the analysis priority labels as approval |
| Hummingbot development skills used for isolated comparison work, provider health and deterministic monitoring evidence | Phase 4 | POC/internal tooling only; never expose Hummingbot administration to Desk product Agents |
| Hummingbot-backed market/exchange Skills | Phase 5 | `GATED` by a documented Bitget POC `PASS` and subsequent connector/market certification; product Skills continue to call uLiquid contracts, not Hummingbot scripts directly |
| Versioned structured Agent Definitions, autonomy levels 0–2, Agent Orchestrator, scoped Context Builder, structured outputs and first-party Skill discovery/lifecycle/version pinning/progressive loading/context budgets/caching | Phase 6A prerequisite | `GATED`; extend the accepted Phase 1–2 foundation before Bot Architect release and do not introduce a second production Skill runtime |
| Durable Agent sessions/journals and decision snapshots; approved user preferences scoped by tenant/user/agent; model independence/routing, token/cost and AI-credit telemetry, replay and evaluation | Phase 6A prerequisite | `GATED`; live market, position and portfolio truth must always be reloaded from tools and must never come from memory |
| Role separation and product UX for Market Analyst, Position Copilot, Prediction Builder and Bot Architect; typed handling of untrusted external context | Phase 6A prerequisite | `GATED`; avoid premature specialist proliferation and enforce prompt-injection defenses outside the model |
| Bot Architect, deterministic `BotSpec`, grid/DCA/TWAP design, strategy validation, backtest/simulation and infrastructure-enforced paper/dry-run mode | Phase 6A | `GATED`; drafts and simulations cannot deploy or trade live |
| Read-only Hyperliquid/Vault Skills (`hyperliquid-market-analysis`, `vault-analysis`, `vault-bot-readiness`) | Phase 6A prerequisite | `GATED`; remain uLiquid-native and require fresh contract, account and reconciliation state |
| Monitoring Skills (`bot-health`, `exchange-health`, portfolio summaries) | Phase 4 foundation; Phase 6A–6B prerequisite | `GATED` by the relevant provider/runtime evidence; deterministic monitoring triggers explanation rather than granting execution |
| Level-3 approved Agent actions, scoped capability context, fresh-state validation, risk policy, execution ownership/capital reservation and Execution Intent through the Exchange Gateway | Phase 6B | `GATED`; every monetary action requires explicit user approval and reconciliation |
| Automated Arbitrage skills/execution and capital ownership attribution | Phase 6C | `GATED` by proven dual-leg idempotency, reservation, reconciliation and recovery |
| XEMM builder/execution and hedge monitoring | Phase 6D | `GATED` by an independent Hedge Watchdog, maximum-unhedged-duration policy and emergency recovery |
| Level-4 policy-constrained autonomy, event-driven/tick loops, per-Agent P&L, shared-account ownership, durable learning and multi-Agent delegation/review | Phase 6E | `GATED`; multi-Agent operation is last, optional and must remain subordinate to deterministic policy and kill switches |
| Statistical arbitrage, multi-strategy capital allocation and autonomous position management | Separate Phase 6E strategy gates | `NOT APPROVED`; each strategy needs its own risk, evaluation, capital, reconciliation and recovery evidence |
| Declarative user-created Skills | Separate post-foundation product gate | `NOT APPROVED`; consider only after the first-party system is proven, with sandboxing and no permission escalation |
| Third-party Skill marketplace or independently distributed Skill repository | Separate future product/legal/security gate | `NOT APPROVED`; no committed roadmap phase |
| Condor runtime | Optional isolated lab POC only | No production dependency and no committed phase; uLiquid owns Agent, tenant, permission and execution authority |
| Hummingbot deploy/developer/core administration skills and LP Agent | Internal-only or out of scope | Never expose to Desk users; LP work requires a separate product decision |
| Skill-defined permissions, embedded secrets, arbitrary user shell/Python, direct raw exchange/provider calls, direct Hummingbot admin access, unpinned automatic updates and loading every Skill into every prompt | Never | `REJECTED` architecture |

### Coverage acceptance rule

Before any phase is marked complete, its implementation plan must reference the applicable rows
above and record each one as delivered, explicitly deferred to its named later gate, or rejected.
Phase 6A must not be considered complete merely because Bot Architect can produce a schema: its
assigned Agent Platform, Skill Platform, memory/session, evaluation, paper-mode,
Hyperliquid/Vault and monitoring prerequisites must also have explicit evidence or an owner-approved
scope decision. Phase 6E must not inherit execution authority from Phase 6B implicitly.

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
- Kept Market Analyst and Position Copilot read-only. The implementation introduced no Hummingbot dependency, execution tool, trade draft or credential change.

Verification on 2026-09-04:

- Futures Core: 16/16 tests passed.
- Futures Exchange: 162/162 tests passed across core, CEX and Hyperliquid suites.
- Agent Chat, routines and derivatives normalization: 50/50 tests passed and the process exited normally.
- Focused Position Copilot: 13/13 tests passed.
- Agent Chat UI: 7/7 tests passed; English/German translation integrity passed.
- Targeted TypeScript validation for every changed Agent Chat web module passed. The local repository-wide web TypeScript command generated route types, then stalled without diagnostics at zero CPU and was stopped after a bounded wait. The production Docker build subsequently completed the full Next.js TypeScript and 97-page generation pipeline successfully.
- The API TypeScript command initially exposed pre-existing errors outside the Phase 1 files in billing, dashboard and ULIQ modules. Those release blockers were corrected with explicit types; the complete API typecheck and production Docker build then passed.
- Browser-level Decision Log acceptance passed for fresh Market Analyst evidence, auto fallback, stale Position Copilot evidence, unsupported BingX data, recent-run selection, technical-activity disclosure and a 390 px mobile viewport without horizontal overflow. This used the production React component in an isolated local harness because the full Next development route stalled before its first response; authenticated end-to-end acceptance remains a separate target-environment check.
- `git diff --check` passed.

Production release evidence on 2026-09-04:

- Phase 1 implementation commit: `dddfe9d8`.
- Production release head after build and policy-test corrections: `837d7d12`.
- API, web, runner, PostgreSQL, Redis and Python strategy service reported healthy after deployment.
- Prisma reported 114 migrations and no pending migration; no contract deployment or onchain/capital action occurred.
- External API health returned HTTP 200, web and Agent Chat reached the login surface, and the unauthenticated Decision Log request was rejected with HTTP 401.
- Runner typecheck, 244/244 Runner tests and the production Runner build passed after aligning stale test expectations with the new fail-closed plan capabilities.

As of the September 4 release, authenticated browser E2E and live-provider acceptance remained a separate follow-up. On 2026-09-05, Mario confirmed Phase 1 as tested and formally complete and authorized Phase 2. This closes the Phase 1 acceptance follow-up by owner decision; it does not rewrite the historical test evidence or automatically certify individual connectors.

## Recommended next step

Phase 3 is complete and documented in the [Phase 3 implementation plan](PHASE_3_IMPLEMENTATION_PLAN.md) and [production acceptance record](../../../../archive/tasks/2026-09-09-phase3-production-acceptance.md). The Phase 4 `PASS` reassessment is deferred until Bitget demo access is available. The next executable roadmap work is the non-runtime [Phase 5 preparation track](PHASE_5_PREPARATION_PLAN.md); implementation remains gated by the current Phase 4 `PARTIAL` Decision Gate.

The Bitget Hummingbot POC remains a separate workstream. Its comparison run requires a stable, measurable native Bitget baseline and is not started by the Phase 2 implementation.

## Definition of Done for the Phase 4 Decision Gate
The Bitget Hummingbot provider has a recorded `PASS`, `PARTIAL` or `FAIL` result from the POC/certification suite and can be switched on/off without changing product-facing APIs. Only `PASS` authorizes consideration of the full Phase 5 scope; each production connector and executor still requires its own certification.

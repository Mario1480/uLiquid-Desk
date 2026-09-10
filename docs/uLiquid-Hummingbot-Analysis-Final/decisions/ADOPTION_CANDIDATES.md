# Adoption Candidates

## Phase 1 — Consolidate Existing Foundations — `COMPLETE`
Existing deterministic Routines; existing typed Agent Skill catalog; existing Futures Capability Registry; existing Agent Run/Tool Call/Trace records; Decision Log projection; Funding/OI/Orderbook Analytics.

Production-deployed at release head `837d7d12`. Mario confirmed verification and formal Phase 1 completion on 2026-09-05. Separate connector certification is unchanged.

## Phase 2 — Provider-Neutral Platform and Existing AI — `COMPLETE`
Shared Market Data; canonical market/data schemas; deterministic analytics; Feature Registry and snapshots; Market Analyst upgrade; Position Copilot upgrade.

The [active Phase 2 plan](../implementation/PHASE_2_IMPLEMENTATION_PLAN.md). Phase 2 is complete by Mario’s full-test confirmation and owner acceptance on 2026-09-07. Shared data, versioned features, existing AI upgrades, bounded provider histories and persisted evidence are accepted. Earlier test records remain historical evidence, not new benchmark measurements.

## Phase 3 — Read-Only Product Features — `COMPLETE`
The scanner-only Arbitrage and XEMM experiences were deployed and accepted on production on 2026-09-09. Opportunity history, alerts and automated execution were not part of the accepted scope and remain unimplemented.

## Parallel Phase 4 — Hummingbot Infrastructure Validation — `COMPLETE — PARTIAL`
Additive Exchange Gateway contracts, ExecutionIntent/idempotency, provider health and synthetic credential/tenant boundaries are implemented. The Bitget Hummingbot POC observed bounded public data, restart and reconnect behavior; private execution/recovery/scaling remain unassessed.

## Decision Gate — `CLOSED — PARTIAL`
The 2026-09-08 result does not unlock Phase 5. Mario deferred the private certification on 2026-09-10 until Bitget demo access is available; the connected live account is excluded from Hummingbot execution testing. A later `PASS` reassessment requires private demo execution, recovery, isolation and scaling evidence.

## Phase 5 — Only After POC PASS — `PREPARATION COMPLETE — IMPLEMENTATION GATED`
Architecture and certification preparation is documented in the [Phase 5 preparation plan](../implementation/PHASE_5_PREPARATION_PLAN.md). Production Hummingbot CEX Provider, separately certified TWAP and DCA integrations, and additional connector/market/executor combinations remain gated.

## Phase 6A–6E — Separately Gated Advanced Work — `GATED`
Bot Architect drafts/simulation; approved Bot deployment; automated Arbitrage; XEMM; policy-constrained autonomous Agents. Hyperliquid cross-market execution and statistical/basis/funding arbitrage remain later candidates.

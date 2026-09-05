# Target Architecture

**Implementation status:** Phase 1 is `COMPLETE` by Mario's acceptance on 2026-09-05. Phase 2 is `IN PROGRESS`: shared datasets, run pinning, persisted feature values, feature-aware AI context, standalone perpetual Copilot and sidebar presentation are implemented locally. See [the active Phase 2 plan](PHASE_2_IMPLEMENTATION_PLAN.md) for historical scope, spot enrichment and acceptance follow-ups. The Hummingbot provider and execution-gateway expansion remain `NOT STARTED` or `GATED`.

```text
uLIQUID DESK
   │
Product API
   │
uLiquid Control Plane
   ├─ AI Platform
   │  ├ Predictions / Builder
   │  ├ Market Analyst / Position Copilot / Bot Architect
   │  ├ Skills / Context / Memory
   │  └ Decision Logs
   ├─ Trading Control
   │  ├ Permission Gateway
   │  ├ Risk Engine
   │  ├ Execution Gateway
   │  └ Reconciliation
   └─ Market Platform
      ├ Provider Adapters
      ├ Normalized Shared State
      ├ Data Quality
      ├ Deterministic Analytics
      └ Feature Registry

Provider Layer
├─ Hummingbot CEX
├─ Native Hyperliquid / HyperEVM / Vault V3
└─ Paper

All layers → Product Analytics / Security Audit / AI Cost / Debug-Replay
```

## Stable contracts
ExchangeProvider, MarketDataProvider, CapabilityDescriptor, MarketId, FeatureSnapshot, ExecutionIntent, ProviderHealth, AgentDefinition, SkillManifest, AgentDecision and ActionProposal.

## Security
Clients never access provider admin APIs. Agents never access credentials. Skills never grant permissions. Fresh state is required before monetary actions. Provider/exchange/agent kill switches are first-class.

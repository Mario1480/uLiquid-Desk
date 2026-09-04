# Decision Matrix

| Component | Decision | Roadmap placement |
|---|---|---|
| Existing Futures Capability Registry | EXTEND; do not duplicate | Phase 1 |
| Existing typed Agent Skill catalog | EXTEND; do not add a parallel runtime | Phase 1 |
| Deterministic Routines | EXTRACT/CONSOLIDATE | Phase 1 |
| Decision Logs | PROJECT from existing Agent records first | Phase 1 |
| Funding/OI/Orderbook Analytics | ADOPT | Phase 1 |
| Shared Market Data | ADOPT independent of Hummingbot | Phase 2 |
| Feature Registry and snapshots | ADOPT | Phase 2 |
| Market Analyst | UPGRADE existing | Phase 2 |
| Position Copilot | UPGRADE existing; retain read/recommend boundary | Phase 2 |
| Arbitrage/XEMM Scanner | ADAPT; scanner-only first | Phase 3 |
| Exchange Gateway | ADOPT by extending existing adapter foundations | Parallel Phase 4 |
| Credential/KMS boundary | ADOPT | Parallel Phase 4 |
| Hummingbot Bitget integration | ISOLATED POC | Parallel Phase 4 |
| Hummingbot CEX connectors | INTEGRATE only after POC PASS | Phase 5 |
| Hummingbot Market Data | INTEGRATE via provider after POC PASS | Phase 5 |
| TWAP/DCA | POC and certify separately after POC PASS | Phase 5 |
| Additional exchanges | CERTIFY per connector/market/executor | Phase 5 |
| Order/Position Executor | POC after provider certification | Phase 5 or later |
| CEX Grid | POC after provider certification | Phase 5 or later |
| Paper Provider | RETAIN/EXTEND | Phase 2 and Phase 6 prerequisites |
| HL/Vault Grid | RETAIN NATIVE | All phases |
| Native Hyperliquid | RETAIN NATIVE | All phases |
| Bot Architect drafts/simulation | ADOPT | Phase 6A |
| Approved Bot deployment | CONDITIONAL | Phase 6B |
| Automated Arbitrage | CONDITIONAL | Phase 6C |
| XEMM Automation | CONDITIONAL | Phase 6D |
| Autonomous Agents | LATER | Phase 6E |
| Condor runtime | REFERENCE/LAB | No production dependency |
| Condor architecture | ADOPT principles | Phases 1–2 |
| Hummingbot tenant/auth authority | REJECT | Never |
| HB-only credential authority | REJECT | Never |

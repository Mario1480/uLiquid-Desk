# Decision Matrix

| Component | Decision | Roadmap placement | Implementation status |
|---|---|---|---|
| Existing Futures Capability Registry | EXTEND; do not duplicate | Phase 1 | `IMPLEMENTED` |
| Existing typed Agent Skill catalog | EXTEND; do not add a parallel runtime | Phase 1 | `IMPLEMENTED` |
| Deterministic Routines | EXTRACT/CONSOLIDATE | Phase 1 | `IMPLEMENTED` |
| Decision Logs | PROJECT from existing Agent records first | Phase 1 | `IMPLEMENTED`; authenticated production E2E is `FOLLOW-UP` |
| Funding/OI/Orderbook Analytics | ADOPT | Phase 1 | `IMPLEMENTED`; live-provider acceptance is `FOLLOW-UP` |
| Shared Market Data | ADOPT independent of Hummingbot | Phase 2 | `NOT STARTED` |
| Feature Registry and snapshots | ADOPT | Phase 2 | `NOT STARTED` |
| Market Analyst | UPGRADE existing | Phase 2 | `NOT STARTED` |
| Position Copilot | UPGRADE existing; retain read/recommend boundary | Phase 2 | `NOT STARTED` |
| Arbitrage/XEMM Scanner | ADAPT; scanner-only first | Phase 3 | `NOT STARTED` |
| Exchange Gateway | ADOPT by extending existing adapter foundations | Parallel Phase 4 | `NOT STARTED` |
| Credential/KMS boundary | ADOPT | Parallel Phase 4 | `NOT STARTED` |
| Hummingbot Bitget integration | ISOLATED POC | Parallel Phase 4 | `NOT STARTED` |
| Hummingbot CEX connectors | INTEGRATE only after POC PASS | Phase 5 | `GATED` |
| Hummingbot Market Data | INTEGRATE via provider after POC PASS | Phase 5 | `GATED` |
| TWAP/DCA | POC and certify separately after POC PASS | Phase 5 | `GATED` |
| Additional exchanges | CERTIFY per connector/market/executor | Phase 5 | `GATED` |
| Order/Position Executor | POC after provider certification | Phase 5 or later | `GATED` |
| CEX Grid | POC after provider certification | Phase 5 or later | `GATED` |
| Paper Provider | RETAIN/EXTEND | Phase 2 and Phase 6 prerequisites | Existing provider retained; planned extensions `NOT STARTED` |
| HL/Vault Grid | RETAIN NATIVE | All phases | Existing native path retained |
| Native Hyperliquid | RETAIN NATIVE | All phases | Existing native path retained |
| Bot Architect drafts/simulation | ADOPT | Phase 6A | `GATED` |
| Approved Bot deployment | CONDITIONAL | Phase 6B | `GATED` |
| Automated Arbitrage | CONDITIONAL | Phase 6C | `GATED` |
| XEMM Automation | CONDITIONAL | Phase 6D | `GATED` |
| Autonomous Agents | LATER | Phase 6E | `GATED` |
| Condor runtime | REFERENCE/LAB | No production dependency | No production dependency introduced |
| Condor architecture | ADOPT principles | Phases 1–2 | Phase 1 principles `IMPLEMENTED`; Phase 2 `NOT STARTED` |
| Hummingbot tenant/auth authority | REJECT | Never | Rejection boundary enforced |
| HB-only credential authority | REJECT | Never | Rejection boundary enforced |

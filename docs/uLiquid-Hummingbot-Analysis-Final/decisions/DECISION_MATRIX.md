# Decision Matrix

| Component | Decision | Roadmap placement | Implementation status |
|---|---|---|---|
| Existing Futures Capability Registry | EXTEND; do not duplicate | Phase 1 | `IMPLEMENTED` |
| Existing typed Agent Skill catalog | EXTEND; do not add a parallel runtime | Phase 1 | `IMPLEMENTED` |
| Deterministic Routines | EXTRACT/CONSOLIDATE | Phase 1 | `IMPLEMENTED` |
| Decision Logs | PROJECT from existing Agent records first | Phase 1 | `COMPLETE`; owner acceptance confirmed 2026-09-05 |
| Funding/OI/Orderbook Analytics | ADOPT | Phase 1 | `COMPLETE`; separate connector certification unchanged |
| Shared Market Data | ADOPT independent of Hummingbot | Phase 2 | `COMPLETE`; owner acceptance 2026-09-07; existing read-only scope retained |
| Feature Registry and snapshots | ADOPT | Phase 2 | `COMPLETE`; owner acceptance 2026-09-07; existing read-only scope retained |
| Market Analyst | UPGRADE existing | Phase 2 | `COMPLETE`; owner acceptance 2026-09-07; existing read-only scope retained |
| Position Copilot | UPGRADE existing; retain read/recommend boundary | Phase 2 | `COMPLETE`; owner acceptance 2026-09-07; existing read-only scope retained |
| Arbitrage/XEMM Scanner | ADAPT; scanner-only first | Phase 3 | `COMPLETE`; production acceptance 2026-09-09 |
| Exchange Gateway | ADOPT by extending existing adapter foundations | Parallel Phase 4 | Additive contracts `IMPLEMENTED`; no production router |
| Credential/KMS boundary | ADOPT | Parallel Phase 4 | Synthetic binding/redaction `IMPLEMENTED`; private flow `NOT ASSESSED` |
| Hummingbot Bitget integration | ISOLATED POC | Parallel Phase 4 | `COMPLETE — PARTIAL`; public reads/restart/reconnect observed, execution unassessed |
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
| Condor architecture | ADOPT principles | Phases 1–2 | Phase 1 `COMPLETE`; Phase 2 `COMPLETE` |
| Hummingbot tenant/auth authority | REJECT | Never | Rejection boundary enforced |
| HB-only credential authority | REJECT | Never | Rejection boundary enforced |

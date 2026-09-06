# Phase 2 live acceptance findings — 2026-09-06

Status: partial acceptance with reproducible blockers. No implementation, commit, push or deployment was performed by this test pass.

## Authorization and environment

Mario authorized live testing, including paid read-only AI analyses. Tests used the existing authenticated Chrome and Firefox sessions on `https://desk.uliquid.vip`, plus three unauthenticated public BingX market-data requests. No orders, protection levels, leverage, credentials, monitoring settings or infrastructure were changed. The existing monitoring mode remained Off. Temporary Chrome viewport and language changes were restored.

Browser observations below are not a new deployment/image attestation. The previously recorded zero-price release remains the deployment reference. Private position quantities, balances, PnL, account identifiers and raw provider payloads are intentionally omitted.

## Completed checks

| Check | Observation |
|---|---|
| Binance Market Analyst, fixed snapshot prompt | Completed at approximately 09:38 UTC; 64 credits, 15.3 seconds, four market features |
| Source and quality | Binance-only; fresh book, provisional/degraded indicators and incomplete funding cadence; no invented historical OI trend or annualization |
| Shared derivatives evidence | Funding and OI displayed the same input snapshot identity |
| Reload persistence | Expanded Decision Log text, feature values and snapshot identifiers matched exactly before and after full reload |
| Desktop/mobile rendering | Chrome desktop and 390x844 English/German drawers rendered; open/close worked and document width did not exceed the viewport |
| Console | Captured Chrome warnings/errors originated from wallet extensions; no application error or framework overlay was observed in this public-analysis check |
| Existing zero-price analysis | Original successful Copilot v6 run remained selectable after newer failures; corrected no-positive-price wording and routine v1.1.0 provenance survived reload |
| Trading Desk zero-price display | BingX positions reporting zero showed the no-liquidation-price label and no fabricated zero-percent distance |
| Fully unsuccessful Agent Chat runs | Both budget-exceeded runs persisted, retained successful skill/feature evidence, and showed no recommendation instead of borrowing the older successful answer |
| Standalone positive-position Copilot | Manual analysis completed with technical-indicator context, a medium deterministic risk floor and qualified no-positive-liquidation-price wording; no notification activation |
| Billing final state | Reservations returned to zero after completed reloads; no stuck reservation was observed |

Screenshots were emitted in the task conversation, not committed to the repository. Firefox was inspected using native accessibility; no Firefox developer-console or mobile-console acceptance is claimed.

## Findings

### 1. Agent Chat position plus market context exhausts its tool budget

Two requests for one selected BingX perpetual position reproduced `agent_chat_tool_budget_exceeded`:

- Approximately 09:41 UTC: position risk, 1h indicators, book, and explicit unsupported Funding/OI checks; 9.3 seconds, 29 credits.
- Approximately 09:42 UTC: reduced prompt requesting only portfolio risk, 1h indicators and book, with no Funding/OI; 9.0 seconds, 31 credits.

Both logs contained four successful calls: `portfolio.get_positions v2`, `risk.analyze_position_snapshot v2`, `market.get_indicators v3`, and `market.get_orderbook v3`. The final answer was absent. The reduced prompt did not produce a successful completion, so this is not closed by suggesting a shorter user request.

Local runtime inspection shows separate tool-round, total-call and per-skill limits using the same error code. The runtime clamps tool rounds to four and still offers tools on the final model iteration. The UI evidence does not identify which exact budget check fired or which additional tool the model attempted. Diagnose that distinction before changing policy. Do not blindly increase budgets or weaken read-only permissions. A budget-aware final synthesis with already validated evidence is a candidate for a separately authorized correction.

### 2. Standalone BingX orderbook request uses an invalid depth

The standalone answer correctly disclosed that no orderbook snapshot was available, although the Agent Chat book calls succeeded. The CEX-integration preflight confirmed the cause:

- `position-copilot/marketContext.ts` requests `client.getDepth(symbol, 25)`.
- `BingxUsdMPerpClient.getDepth` passes this integer through after only numeric clamping.
- Public `GET /openApi/swap/v2/quote/depth` for the same public symbol with `limit=25` returned HTTP 200, provider code `109400`, identifying allowed limits `5 10 20 50 100 500 1000`.
- Control requests with limits 20 and 50 returned provider code 0 and the requested number of bid/ask levels.

This is a provider-contract mismatch, not a missing BingX orderbook capability. A follow-up should map requested coverage to a supported provider depth and trim normalized output while preserving coverage identity. No adapter change was made in this test pass.

### 3. Standalone quality label and duplicate findings need review

The standalone header displayed `Data: complete`, while the explanation correctly described degraded market context and unavailable datasets. Local code retains deterministic position data quality independently of `marketContext`; the UI label does not communicate that distinction. It should distinguish position-data completeness from market-context quality, rather than implying all inputs are complete.

The stop-loss warning also appeared twice with slightly different wording. Local `mergeAnalysis` concatenates deterministic and model findings without deduplication. Neither observation changed the correct medium risk floor or permitted an execution action.

## Cost accounting

| Analysis | Credits |
|---|---:|
| Public Binance Market Analyst | 64 |
| First Agent Chat position-context budget failure | 29 |
| Reduced Agent Chat position-context budget failure | 31 |
| Standalone manual Copilot | 3 |
| Total | 127 |

The public run charge was shown by the UI; the other charges were verified using bounded before/after account credit differences with zero final reservations. Failed runs consumed model work and were not treated as free. Temporary reserved-credit header values were not mistaken for final charges.

## Remaining gates

- Correct and retest Agent Chat position-context completion and standalone BingX depth normalization.
- Clarify standalone position versus market data quality and review duplicated findings.
- Verify exact standalone feature provenance and cached explanation behavior at the response/persistence boundary; the rendered answer alone is not sufficient for those gates.
- Genuine stale-at-analysis and automatic venue-fallback target-environment acceptance remain open. A historical Decision Log is deliberately evidence at run time, not a live freshness test.
- A full successful positive-position Agent Chat answer using market features remains open despite successful individual tools.
- The single repeated public prompt is not a controlled before/after quality, latency, credit or provider-request benchmark.
- Historical Funding/OI and standalone spot scope still require explicit decisions in the active Phase 2 plan.

No production faults, new positions or historical records were manufactured to obtain test cases. The two reproducible Agent Chat failures were not repeatedly retried after the bounded reproduction.

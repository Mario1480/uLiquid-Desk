# Post-release Copilot browser acceptance — 2026-09-06

Status: the three authorized live analyses passed; mobile Decision Log layout remains a release follow-up. Phase 2 is not complete.

## Scope and environment

- Production `desk.uliquid.vip`, following code release `111b9de6e` and its documented API/web deployment.
- Existing authenticated Chrome and Firefox sessions, controlled through Computer Use after Mario unlocked the Mac.
- Paid read-only analyses were explicitly authorized. No orders, transfers, notification changes, account settings or execution actions were performed.
- This acceptance did not deploy or change application code. Existing unrelated local UI edits were preserved.

## Live results

| Consumer | Result | AI Credits | Observed latency |
| --- | --- | ---: | --- |
| Standalone BingX ADAUSDT Copilot | Medium risk, complete position data, degraded market context, fresh available orderbook, one missing-stop-loss finding | 3 | Not recorded |
| Market Analyst v6, Binance BTCUSDT | Completed at 14:54:14 UTC with indicators, Funding, OI and book evidence | 117 | 15.4 s |
| Position Copilot v7, BingX ADAUSDT | Completed at 14:55:48 UTC with portfolio risk, 1h indicators and fresh book | 169 | 19.3 s |

Total: **289 AI Credits**. Both account headers showed zero reserved credits after reload. These are observed charges, not a controlled before/after benchmark: existing conversations contained earlier history.

- Both position surfaces avoided treating the exchange's zero liquidation-price state as a critical zero-distance event or a guarantee of permanent liquidation protection.
- The standalone result separated position completeness from forming-candle degradation. Its orderbook was available and its stop-loss finding appeared only once. Unsupported Funding/OI remained explicit.
- The formerly failing Agent Chat position flow produced a complete final recommendation using three read tools, without a tool-budget failure. This does not establish that the reserved final model round was specifically exercised.
- Public Funding and OI shared an input snapshot. Missing cadence and historical context remained explicit; no snapshot-derived OI trend was fabricated.
- Expanded public Decision Log text was identical before and after full reload. Position Decision Log text, after removing accessibility node numbers, was also identical; all four feature/input snapshot identifiers matched.
- Selecting the older failed position run still showed no recommendation and the original tool-budget error. The latest successful v7 run was restored afterward.

## Browser checks and mobile finding

- Desktop Chrome at 1512×862: expected application identity, no framework overlay or horizontal overflow. Captured console contained 24 extension-origin warnings/errors and no application-origin warning/error.
- English and German mobile checks at 390×844: drawer open/close worked, but the production drawer was not fully contained in the viewport. Therefore mobile layout acceptance **failed**, despite no horizontal overflow.
- Reproduction: open Agent Chat at 390×844, open Decision Log, return to the top of the page. The observed panel extended from approximately y=614 to y=1205 with a viewport bottom at y=844. Its fixed overlay also ended at y=1205.
- Diagnostic observation: ancestor `.appMain` had computed identity transform `matrix(1, 0, 0, 1, 0, 0)` and height about 1066 px. This is consistent with the fixed overlay being anchored to a transformed ancestor instead of the viewport; a correction and repeat acceptance are still required.
- Chrome viewport override was reset and the original English Agent Chat route restored. Firefox was left on the latest successful position run.

## Remaining gates

- Fix and retest mobile Decision Log viewport containment.
- Verify standalone cached explanation/evidence identity at the consumer boundary; the live UI checks alone do not establish it.
- Complete live stale and eligible fallback scenarios without changing production provider/settings behavior solely to manufacture them.
- Run a controlled fixed-prompt quality/latency/credit comparison.
- Resolve the remaining Phase 2 historical analytics and standalone spot-enrichment scope explicitly.
- No comprehensive UI, accessibility, performance, provider-certification or trading acceptance is claimed.

Related: [release evidence](2026-09-06-einui-copilot-production-release.md), [Phase 2 plan](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md).

## Local mobile correction — subsequent authorized fix

- `apps/web/app/styles/desk.css` disables the shell entrance animation only for `.appMain` containing Agent Chat. This avoids the transform-created containing block without changing other routes, drawer controls, theme, data or permissions.
- Added a focused CSS contract regression to the Agent Chat UI suite: 10/10 passed. Web TypeScript check, i18n integrity and `git diff --check` passed.
- A temporary Playwright layout fixture used the actual shell/desk CSS and representative nested drawer markup with long content. Chromium, Firefox and WebKit each passed 390×844, 360×740, 844×390 and 1512×862 checks (12 combinations). Removing the fix reproduced the below-viewport panel in all mobile cases; restoring it passed viewport bounds, page scrolling, panel scrolling, close/reopen and no horizontal overflow. No page runtime errors were recorded. A mobile screenshot was visually inspected.
- The first Firefox attempt encountered a missing browser revision. Retesting used another already-installed matching Playwright runtime; no dependency or browser installation was performed.
- The fixture does not certify the full authenticated React app, translated content, focus behavior or production integration. Screenshots and the temporary runner remain outside the repository. The browser plugin skill was unavailable, so the frontend testing skill's regular Playwright path was used.
- This fix is local and not committed, pushed or deployed. Production mobile acceptance remains open until release and repeat verification. Existing unrelated UI edits were preserved; no further paid analyses ran.

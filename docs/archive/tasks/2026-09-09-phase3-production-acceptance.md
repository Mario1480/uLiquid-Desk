# Phase 3 Cross-Market Production Acceptance

Date: 2026-09-09

## Scope and release identity

Mario requested Codex to perform Phase 3 production acceptance. The scanner application release was deployed from `ca4f912e461527f4d44422c8fec8afe8c702e66a`. A stale-result UI correction found during acceptance was committed and deployed as `d400baf16b7acc8d401caa78fde35dfbcfc4bbe8`.

The acceptance covered authenticated production behavior for the Arbitrage and XEMM tabs, provider coverage, size-aware result evidence, client validation, responsive layout and the read-only product boundary.

## Authenticated browser evidence

- The English production page loaded under an authenticated session with the Cross-Market navigation entry, Phase 3 heading, Read-only badge and scanner-only disclosure.
- A BTCUSDT Arbitrage scan with Binance, Bitget and Hyperliquid returned 3/3 fresh sources and six directed venue evaluations. The result exposed gross edge, net edge, expected net PnL, executable size, depth coverage, score, fees, slippage and safety buffer.
- The best observed Arbitrage result remained negative after costs and was shown as `Below threshold`; candidates remained zero.
- A BTCUSDT XEMM scan showed maker side, taker hedge, maker direction, size-aware cost evidence and blocked/below-threshold states. A broad scan returned 5/5 fresh sources across Binance, Bitget, Hyperliquid, MEXC and BingX.
- Selecting fewer than two venues displayed `Select at least two venues.` without invoking a scan.
- Changing the provider selection after a completed scan originally retained stale results and produced a contradictory source denominator. The deployed correction now clears candidates, best edge, source count, update time, opportunities and source evidence whenever any scan input changes.
- At 390×844, the navigation collapsed, both scanner tabs and controls remained usable, and an authenticated XEMM scan returned 4/4 fresh sources. Result cards remained single-column without horizontal overflow.
- The viewport override was reset after the responsive check.

## Provider failure evidence

Every selected production provider was healthy during acceptance, so no live outage was manufactured. The existing deterministic service test verifies a partial response with two successful books plus a stable `provider_unavailable` failure, and the fail-closed path when fewer than two providers succeed. The focused Cross-Market suite passed 9/9 after the production checks.

This is combined runtime and deterministic evidence. It does not claim that a natural provider outage was observed in production.

## Runtime and safety evidence

- The web production build completed successfully and the corrected web image was deployed.
- API, web, runner, PostgreSQL, Redis and the Python strategy service reported healthy after deployment.
- The public API health endpoint returned `{"ok":true}`.
- No Cross-Market errors appeared in the inspected production API or web logs.
- The inspected browser console contained no application-origin error; the observed warnings and one provider-injection conflict came from installed wallet extensions.
- The page exposed no order, draft, launch or execution action.
- No private exchange read, credential access, order, capital reservation, database migration, contract call or onchain transaction was performed.

## Decision

Phase 3 is accepted and marked `COMPLETE` under Mario's delegated acceptance request. Phase 4 remains `COMPLETE — PARTIAL`, and Phase 5 remains gated pending a separate evidence-based Phase 4 `PASS` reassessment.

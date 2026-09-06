# Phase 2 Copilot Corrections — Local Evidence, 2026-09-06

## Authorization and scope

Mario authorized fixing the findings in the [live acceptance report](2026-09-06-phase2-live-acceptance-findings.md). This work changes local code, tests and documentation only. No commit, push, deployment, production setting change, private provider call, additional paid AI analysis, order or capital action was performed. Parallel EinUI changes in the checkout were preserved, including overlapping Trading Desk edits.

## Implemented corrections

1. **Agent Chat budget-aware synthesis.** Each model call receives the remaining tool budget. Exhausted skills are no longer advertised. The already-reserved final call has no tools and explicitly requests a final JSON answer grounded in validated evidence, with missing coverage and quality warnings preserved. No additional round, timeout, credit cap or tool allowance was added. Unexpected final-round tools and excessive calls in a single batch still fail closed. Existing permission, ownership, output-validation, billing settlement and read-only execution boundaries remain in place. Built-in Market Analyst advances from version 5 to 6 and Position Copilot from 6 to 7 for the changed system policy.
2. **BingX depth normalization.** The native perpetual public client maps requested coverage to a supported provider limit and trims the normalized levels. Requested 25 maps to upstream 50 and returns at most 25. Existing maximum normalized coverage remains 200; timestamps are preserved. Native Funding/OI remain unsupported. No adapter replacement or private request change was introduced.
3. **Honest standalone quality labels.** The Trading Desk now renders separate `Position data` and `Market context` badges from the same analysis response. Missing, malformed or incompatible market-context versions show unavailable, never fresh. Fresh, stale, degraded and unavailable states are translated into English/German. Existing Desk styles and warning classes are reused, without a layout redesign.
4. **Duplicate findings.** Deterministic findings take precedence over model duplicates matched by stable code, common stop-loss aliases or normalized identical message. The stronger severity is retained, not downgraded. Additional distinct findings remain visible. The prompt asks for additions rather than paraphrases, and the standalone cache namespace advances from `v3` to `v4` so older duplicate output is not reused. Unknown paraphrases are not claimed to be universally semantically deduplicated.

Routine and skill calculation versions are unchanged. No Hummingbot, execution tool, migration, provider credential or historical data storage was added.

## Automated verification

All suites below exited normally; no forced termination was used to obtain passing results.

| Check | Result |
| --- | --- |
| `npm -w apps/api run test:agent-chat` | 106/106 passed |
| `node node_modules/tsx/dist/cli.mjs --test apps/api/src/position-copilot/*.test.ts` | 26/26 passed |
| `npm -w apps/web run test:agent-chat-ui` | 9/9 passed |
| `node node_modules/tsx/dist/cli.mjs --test apps/web/src/trade/positionCopilot*.test.ts` | 4/4 passed |
| `npm -w apps/api run typecheck` | Passed |
| `npm -w apps/web run typecheck` | Passed in the combined checkout |
| `npm -w apps/web run i18n:check` | Passed |
| `git diff --check` | Passed |

New runtime tests cover both profiles reaching the fifth, tool-free model call after four read rounds, exhausted-skill filtering, no added budgets, stale evidence persistence and final recommendation association. Negative tests retain final-round and per-skill fail-closed behavior. Native BingX tests cover accepted depth mapping, coverage trimming, non-finite/clamped limits, numeric levels and timestamp preservation. A standalone market-context integration fixture exercises the actual native client with mocked HTTP and retains unsupported derivative warnings. Merge tests retain deterministic risk floors and stronger finding severities while collapsing stop-loss duplicates. Web tests cover malformed/legacy quality and all four market states in both languages. A stale navigation assertion was aligned with the existing read-only `/agent-chat` destination; navigation behavior was not changed.

The first new server-rendered component test exposed a missing React binding under the test runner's classic JSX transform. Adding the explicit React import corrected it; the final test result above includes that correction.

## Public-provider and browser evidence

- A single unauthenticated read through the patched BingX native client requested `ADAUSDT` coverage 25 and returned 25 bids, 25 asks, a provider timestamp and an uncrossed book. No private account or production configuration was accessed. Earlier direct native controls established that 25 was rejected while 20/50 succeeded; those remain in the live findings report.
- Chrome Computer Use rendered the real `PositionCopilotDataQuality` component, actual translation files and existing Desk CSS in an isolated local server-rendered fixture. Synthetic records covered all four market states alongside complete position data. English desktop at 2037×1211 and German mobile at 390×844 displayed distinct labels with warning styling only on non-fresh market context. No horizontal document overflow or framework overlay appeared. Screenshots were inspected.
- No application warnings/errors were captured in the fixture. Wallet-extension injection/listener errors and warnings were present and are not represented as application errors. The viewport override was reset and the temporary browser tab was closed.
- This is component rendering acceptance, not full Trading Desk authentication, hydration, production API or live-model acceptance. Fixtures do not certify complete real-world portfolio coverage or provider behavior beyond the specific public smoke.

## Remaining release and acceptance gates

- Obtain publication authorization, isolate these corrections from parallel UI changes and deploy the selected release.
- Repeat the previously failing real Agent Chat Copilot request and confirm a final answer, honest missing coverage, persisted feature provenance, latency and settled credits within unchanged limits.
- Repeat a standalone BingX analysis and inspect the now-supported book evidence, independent quality labels, findings and cached/reloaded provenance.
- Keep genuine stale/automatic-fallback acceptance, fixed-prompt quality/cost comparison, exact standalone cache evidence and historical/spot scope decisions open in the [Phase 2 plan](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md).

Phase 2 is not complete. Local regression success is not a claim that the production failures have already been repaired.

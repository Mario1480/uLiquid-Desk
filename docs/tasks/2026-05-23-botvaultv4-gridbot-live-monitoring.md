# 2026-05-23 BotVault V4 GridBot Live Monitoring

## Context

- User: `cmn4a70gc0dyap62e5febk3z7`
- Bot: `b132ae99-ccf3-4b7f-8680-d30f5cd57506`
- Bot name: `Vault Test Bot (BTCUSDC)`
- Exchange: `hyperliquid`
- Symbol: `BTCUSDC`
- Previous live monitoring doc: `docs/tasks/2026-05-21-botvaultv4-gridbot-live-monitoring.md`

## Baseline Before New Start

- Docker services were healthy during the start window: `api`, `runner`, `web`, `postgres`, `redis`, `py-strategy-service`, and `salad-proxy`.
- Agent Wallet prewarm from the prior run was in place.
- BotVault V4 runtime path was active.
- AI/Salad was already known degraded from earlier checks; this did not block GridBot/BotVault execution.

## Live Start

New BotVault/GridBot start was observed on 2026-05-23 around 12:31 UTC.

Runtime IDs:

- Grid instance: `cmpibv82o0zrol31yhszulrdw`
- BotVault: `cmpibv8480zrql31yp9tswcg4`
- Bot: `b132ae99-ccf3-4b7f-8680-d30f5cd57506`
- BotVault address: `0xDaC4201aF78069Aa6E6B3B07365D9FF676b7e51f`
- Agent wallet: `0xf9ac451068c7ad47f4e22a8138697797e8efad27`
- Vault model: `bot_vault_v4`

Grid configuration observed:

- `invest_usd=1.81`
- `extra_margin_usd=3.19`
- Grid trading allocation: `5 USDC`
- BotVault principal allocation: `6 USDC`
- Accounting/create component: `1 USDC`
- Leverage: `20`
- Initial seed: `30%`

## Onchain Actions

Create action:

- action id: `cmpibv8550zrsl31yuy9w3hjn`
- action type: `create_bot_vault_v4`
- status: `confirmed`
- tx: `0x21e9613d95216ca8ecdc58984e44b12340ba5cdc474ea2aa688e77bb2d9bf437`
- created at: `2026-05-23 12:31:32.346 UTC`
- confirmed at: `2026-05-23 12:31:47.866 UTC`

Funding action:

- action id: `cmpibvwbh10bal31yvb39jews`
- action type: `fund_bot_vault_v4`
- status: `confirmed`
- amount: `6 USDC`
- tx: `0xe5da681932fbef6e3f07b1b3f27233251dfef58be98de6f29672816caa86e1c8`
- created at: `2026-05-23 12:32:03.666 UTC`
- confirmed at: `2026-05-23 12:33:55.377 UTC`

Auto-activate and HyperCore funding:

- auto-activate tx: `0xb365e1c0c2ef1228e30e108c79497d3426c628e4a421eb6d3206a75d3accc8d8`
- HyperCore deposit tx: `0xe6984ddf3739f88069043a887a40b8b71fc26b6ff766aeb35846eb2e6feb06de`
- HyperCore lifecycle stage reached: `hypercore_funded`
- HyperCore lifecycle timestamp: `2026-05-23T12:35:05.782Z`

## Funding And Readiness Progression

Observed progression:

- 12:34 UTC: Funding was confirmed on HyperEVM.
  - `funding_status=hyper_evm_confirmed_onchain`
  - `principal_allocated=6`
  - `allocated_usd=6`
- 12:35 UTC: HyperCore deposit was confirmed and metadata moved to `hypercore_funded`.
- The visible status columns initially lagged the lifecycle metadata:
  - `hypercore_funding_status=pending`
  - `execution_status=created`
  - Grid state remained `created`
  - Grid provisioning phase remained `submitted_waiting_hypercore_funding_indexer`
- 12:38 UTC: V4 margin finalization completed automatically through reconciliation/finalizer.
  - transfer to Perp: `5 USDC`
  - transfer tx: `0xee8bf0138c1f8c27db1df19de0f59383b6cc3ff3573e17e2a642ea327255811d`
  - Core Spot USDC after transfer: `0`
  - Perp equity after transfer: `5`
  - HYPE reserve state: `ready`
  - HYPE reserve observed balance: `0.01`
  - verification state: `funding_verified`
  - funding lifecycle stage: `execution_ready`
- 12:39 UTC: `hypercore_funding_status` was updated to `funded`, while execution was still waiting for the next autostart cycle.
- 12:41 UTC: onchain reconciliation autostarted the GridBot execution.

Autostart event:

- event id: `cmpic7pxk1bhxl31yoxz8n8rd`
- source key: `bot_vault:cmpibv8480zrql31yp9tswcg4:onchain_reconciliation_autostart`
- action: `start`
- result: `succeeded`
- status transition: `created -> running`
- created at: `2026-05-23 12:41:15.270 UTC`

## Live Execution Result

Final BotVault state after autostart:

- BotVault status: `ACTIVE`
- funding status: `hyper_evm_confirmed_onchain`
- HyperCore funding status: `funded`
- execution status: `running`
- funding lifecycle stage: `execution_ready`
- lifecycle state: `execution_active`
- `canAcceptNewOrders=true`
- execution last error: empty

Final Grid/Bot state:

- Grid instance: `running`
- Bot: `running`
- Grid provisioning phase: `execution_active`
- `last_plan_error`: empty
- latest observed `last_plan_at`: `2026-05-23 13:19:54.865 UTC`

Initial seed:

- Initial seed request:
  - side: `buy`
  - type: `market`
  - seed pct: `30`
  - quantity: `0.00015 BTC`
  - mark price at request: `74711`
  - seed notional: `11.20665 USDC`
  - client order id: `grid-cmpibv82o0zrol31yhszulrdw-seed-buy-1`
- Submit result:
  - status: `confirmed`
  - tx: `0x6a6895c9e667f02c05a68b42d7bf554aa2eccf70079cee8ec83d85c8d724ed97`
  - order id: `cloid:0:335642239514704683759062835783944982873`
- Persisted fill:
  - fill id: `cmpic96fk000dtl01zeposf1h`
  - exchange order id: `438884042657`
  - side: `buy`
  - fill price: `74714`
  - fill qty: `0.00015 BTC`
  - fill notional: `11.2071 USDC`
  - fee: `0.005043 USDC`
  - fill timestamp: `2026-05-23 12:41:45.481 UTC`

Open orders after seed:

- Buy BTC `0.00017` at `70000`
  - client order id: `grid-cmpibv82o0zrol31yhszulrdw-long-0`
  - exchange order id: `cloid:0:16657870729647880829708039844692525853`
  - status: `open`
  - reduce only: `false`
- Reduce-only sell BTC `0.00015` at `80000`
  - client order id: `grid-cmpibv82o0zrol31yhszulrdw-long-2`
  - exchange order id: `cloid:0:335329215285621562717569697763351306253`
  - status: `open`
  - reduce only: `true`

## Operational Notes

Recoverable warning during the new start:

- One early warning was logged for this new vault:
  - `vault_onchain_reconciliation_v3_hypercore_advance_failed`
  - BotVault: `cmpibv8480zrql31yp9tswcg4`
  - issue class: `recoverable_track`
  - mismatch category: `funding_verification_missing`
  - recovery action: `retry`
  - error: `bot_vault_v3_deposit_hypercore_tx_failed`
- The warning did not persist as a live blocker. The later indexer/reconciliation path confirmed HyperCore funding, finalized margin, and autostarted execution.

Unrelated warnings during observation:

- Old v3/v4 rows still emit unrelated reconciliation warnings:
  - `cmnom483402ahqk1yaqgb810j`: `transfer_not_allowed` / recovery-required funding lifecycle counterevidence.
  - `cmnki5pkj00dqo926p84dnbq7`: contract read reverts for legacy v3 contract methods.
- These warnings were not tied to `cmpibv8480zrql31yp9tswcg4`.

Web/API performance side note:

- Salad/Ollama was failing with HTTP `403/503`, which made Prediction refreshes noisy and pushed API CPU high.
- AI provider was temporarily set to `disabled` in `admin.apiKeys` at `2026-05-23 13:03 UTC`.
- API CPU dropped from roughly `225-300%` to below `1%` after disabling AI.
- This does not change BotVault/Grid execution state; it only pauses AI-backed Predictions until Salad is restored.

Tradingdesk side note:

- BingX rate-limit cooldown logs appeared from Manual Trading.
- A Tradingdesk frontend fix was committed and pushed:
  - commit: `2cbd0f5 Throttle Tradingdesk live refresh on exchange rate limits`
  - pushed to `origin/main`

## Post-Start Checks

- Containers after observation:
  - `api`: healthy
  - `web`: healthy
  - `runner`: up
  - `postgres`: healthy
  - `redis`: healthy
  - `py-strategy-service`: healthy
- Fee/profit-share rows for this BotVault at the time of the check:
  - `fee_events=0`
  - `profit_share_accruals=0`
- GitHub `main` after the Tradingdesk rate-limit fix:
  - local `HEAD` and `origin/main` both at `2cbd0f5`
  - `HEAD...origin/main = 0 ahead / 0 behind`

## Follow-Up Optimization

Implemented after reviewing the slow start flow:

- The onchain indexer now gets the BotVault runtime service and, after confirmed V4 HyperCore funding, immediately attempts:
  - initial margin finalization,
  - execution-ready verification,
  - BotVault/Grid autostart.
- Reconciliation keeps the same logic as a fallback and can now autostart in the same cycle after a successful V4 margin finalization.
- Production polling was tightened:
  - `VAULT_ONCHAIN_INDEXER_INTERVAL_SECONDS=5`
  - `VAULT_ONCHAIN_RECONCILIATION_INTERVAL_SECONDS=20`
- Legacy BotVault rows are excluded from production onchain reconciliation:
  - `VAULT_ONCHAIN_RECONCILIATION_INCLUDE_LEGACY_BOT_VAULTS=0`
  - this stops old non-V4 BotVaults from producing ongoing reconciliation noise.
- AI/Salad was intentionally left out of this optimization pass.

Deployment/checks:

- API image rebuilt and `api` container recreated.
- Runtime env in container verified:
  - `indexer=5`
  - `reconciliation=20`
  - `include_legacy=0`
- API health after deploy:
  - `GET /health` returned `200`
  - response time observed around `0.004-0.011s`
- No new `vault_onchain_*` V3 legacy warnings were observed in the first post-deploy log sample.

## Current Summary

The 2026-05-23 BotVault V4 start succeeded end-to-end:

- Create confirmed.
- Funding confirmed.
- HyperCore deposit confirmed.
- V4 margin transfer to Perp confirmed.
- HYPE reserve was ready.
- Funding lifecycle reached `execution_ready`.
- Reconciliation autostarted execution.
- GridBot and BotVault reached `running`.
- Initial seed executed and two follow-up grid orders remained open.

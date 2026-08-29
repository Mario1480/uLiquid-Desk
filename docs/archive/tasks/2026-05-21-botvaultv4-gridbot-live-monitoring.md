# 2026-05-21 BotVault V4 GridBot Live Monitoring

## Context

- User from previous run: `cmn4a70gc0dyap62e5febk3z7`
- Previous live doc: `docs/archive/tasks/2026-05-20-grid-bot-vault-api-fixes.md`
- Previous V4 Grid instance: `cmpdy5e8z025ynz1x9z5qhy8i`
- Previous BotVault: `cmpdy5eaf0260nz1x3euq34qe`
- Previous BotVault address: `0x42B2552366585F90CbD87bf5F8481e4d86104Ec4`

## Baseline Before New Start

- Docker services are healthy: `api`, `runner`, `web`, `postgres`, `redis`, `py-strategy-service`.
- Latest V4 BotVaults for the user are closed or close-only; no new V4 GridBot start was visible yet at initial check.
- Previous V4 HYPE reserve path is deployed: direct agent HyperCore Spot `spotSend` for the BotVault HYPE reserve.
- Previous autostart fix is deployed: V4 `execution_ready` rows can be picked up by reconciliation and moved into running execution.

## Live Monitoring Notes

- 2026-05-21 11:15:43 UTC: `create_bot_vault_v4` submitted.
  - tx: `0x671770578eb2024360156cdeeb4def5f55bb37c94110127697dbf9d9349b1a3f`
- New live rows:
  - Grid instance: `cmpfe9v3m0n5il71y45jvcpxg`
  - BotVault: `cmpfe9v7k0n5wl71yd8q76rjv`
  - Bot: `7e0ba6a0-39d3-426e-9d23-3923d31cb08c`
  - BotVault address: `0xF0D1Af6B8F87a5448D73d43e1C3ae4733A4071a2`
  - Agent wallet: `0xe74d337ae262ad52030a80045f6d185dacb0392a`
- 2026-05-21 11:16 UTC state:
  - Grid state: `created`
  - Bot status: `stopped`
  - BotVault funding status: `deployed`
  - HyperCore funding status: `not_funded`
  - Execution status: `created`
  - Funding lifecycle stage: `deployed`
  - Provisioning phase: `pending_reserve_signature`
  - Grid config observed: `invest_usd=2.31`, `extra_margin_usd=7.69`, `leverage=20`, `initial_seed_pct=30`
  - Prepared funding action: `cmpfeb1av0nuil71y1k5tvhry`, `fund_bot_vault_v4`, `amountUsd=11`
- Hyperliquid live state before funding:
  - Spot balances: empty
  - Perp account value: `0.0`

## Live Result

- Funding action:
  - action: `cmpfeb1av0nuil71y1k5tvhry`
  - tx: `0xfa54c71eba64d5b207d8c44f9d2eaa73380343f0967eeb6f9b127f5a3c137009`
  - status: `confirmed`
- HyperCore Spot funding was observed with `10.0 USDC`.
- A transient API/Prisma pool saturation occurred around 11:19 UTC; API restarted once cleanly and returned healthy.
- Direct V4 reconcile was run for `cmpfe9v7k0n5wl71yd8q76rjv`.
- Manual V4 margin finalization was run with `amountUsd=10` because the Core->Perp margin finalization had not been submitted automatically.
- Margin finalization result:
  - `transferToPerpAmountUsd=10`
  - Core Spot USDC after transfer: `0`
  - Perp account value: `10.0`
  - HYPE reserve: `ready`
  - HYPE balance: `0.01`
  - Funding lifecycle stage: `execution_ready`
  - Verification state: `funding_verified`
- Autostart result:
  - Bot status: `running`
  - Grid state: `running`
  - BotVault execution status: `running`
  - Lifecycle metadata: `execution_active`, `canAcceptNewOrders=true`
- Initial seed:
  - Filled BTC long seed: `0.00018 BTC` at `77268`
  - Notional: `13.90824 USDC`
  - Fee: `0.006258 USDC`
  - Fill hash: `0xbfd1b5d2f1bfda9dc14b043be647af00000ccdb88cb2f96f639a6125b0b3b488`
- Live/open orders after seed:
  - Buy BTC `0.00021` at `70000`
    - local client id: `grid-cmpfe9v3m0n5il71y45jvcpxg-long-0`
    - exchange oid: `435893666757`
  - Reduce-only sell BTC `0.00018` at `80000`
    - local client id: `grid-cmpfe9v3m0n5il71y45jvcpxg-long-2`
    - exchange oid: `435893705810`

## Follow-up Risk

- `botVaultGridReadiness` in `grid_bot_instances.state_json` still contains a stale blocked snapshot from 11:24 UTC, but the current row state and order placement are healthy:
  - `last_plan_error` is empty.
  - `last_plan_at=2026-05-21 11:26:21.167`.
  - `gridHealth` is no longer populated.
- The API restart and Prisma connection pool saturation should be reviewed separately if it repeats under UI polling/live monitoring load.

## API Stability Follow-up

Observed root cause:

- API logs showed Prisma pool saturation with `Timed out fetching a new connection from the connection pool`.
- At the same time, Postgres showed many concurrent `UPDATE bot_vaults SET execution_last_synced_at...` statements waiting on locks.
- A `globalSetting.findUnique` rejection then escaped one Grid mapping path and terminated the API process.

Patch deployed on 2026-05-21:

- Added per-BotVault in-flight dedupe for non-transactional `syncExecutionState` calls.
- Added global `syncExecutionState` concurrency limit via `VAULT_EXECUTION_LIFECYCLE_SYNC_CONCURRENCY`, default `4`.
- Added missing error handling around Grid pilot access lookup in `resolveCurrentAllowedGridExchanges`.
- Added API `unhandledRejection` logging so transient rejected promises do not terminate the Node process.

Validation:

- `npm -w apps/api run typecheck` passed.
- `node ../../node_modules/tsx/dist/cli.mjs --test src/vaults/executionLifecycle.service.test.ts` passed.
- `node ../../node_modules/tsx/dist/cli.mjs --test src/grid/routes-instances.test.ts` passed.
- `npm -w apps/api run build` passed.
- API redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.

## Fourth Close Recovery

Close recovery was handled on 2026-05-21 around 17:58-18:15 UTC for:

- BotVault: `cmpfpjm0300xro71ypznq0i7f`
- Grid instance: `cmpfpjlyk00xpo71y60h9qtbi`
- BotVault address: `0x0b5298098668e265F4C39af0Db60616B9aF32CDd`
- Agent wallet: `0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27`

Observed blocker:

- User close failed with `HyperCore still holds funds or positions for this BotVault`.
- Live Hyperliquid state had no open orders and no perp positions.
- Perp was empty; the remaining blocker was HyperCore Spot dust:
  - `0.00009999 USDC`
  - `0.00079632 HYPE`
- The practical funds had already reached HyperEVM before close (`3.9999 USDC`).

Manual settlement notes:

- A dust/init transfer from the vault to the agent (`0.00000001 USDC`) unexpectedly incurred a normal HyperCore Spot transfer fee of `1.0 USDC`.
  - tx: `0xfe66efe0f810d956852a0f2b263052c47c63404df7d478f23c72b11fc03c6a9f`
  - This was not profit share; it was a venue transfer fee.
- Agent-to-vault HYPE reserve transfer:
  - `0.01 HYPE`, ledger hash `0x037975f15ab3389204f3043beb31c902050e00d6f5b65764a742214419b7127c`
- Spot-to-HyperEVM settlement transfers that moved the recoverable USDC:
  - `2.9 USDC`, tx `0xda3269849516c0d64381f7638780c055b26772e3f66b5d1c4a8927ff720d46d8`
  - `0.09 USDC`, tx `0x53a176dbab15c29705c84a1a143cb1e64ebe96b43f749b73379c91461729f7a3`
  - `1.0009 USDC`, tx `0x51c794e2c6bf5238ff46d9bb26291ce213672a5a3c0e093c6e63015b4abc5a59`
  - Tiny `0.00009990 USDC` tx `0x80b17b00e096d11a5c58a4f498432a083ca2e3ac38a532fad7a714f3be1a2cfd` had an EVM receipt but did not clear HyperCore dust.

Patch deployed:

- V4 HYPE reserve target default changed to `0.01 HYPE`, matching the practical transfer size.
- Close settlement now treats HyperCore USDC dust up to `BOT_VAULT_V4_HYPERCORE_EXIT_DUST_USD` (default `0.001`) as non-blocking.
- Reconciliation now uses the same dust threshold for economically closed vaults, so `0.0001 USDC` no longer leaves a blocking health issue.
- Closed/settled summary mapping no longer lets stale funding-operation errors override the settled funding display.

Validation:

- `npm -w packages/futures-exchange run build` passed.
- Direct `transferUsdcSpotToEvm` adapter regression passed.
- `npm -w apps/api run test:botvault-v4-transitions` passed.
- Targeted display/health tests passed.
- `npm -w apps/api run typecheck` passed.
- API redeployed and ended healthy with restart count `0`.

Final close result:

- Close tx: `0x694fbaa81c5c3e751475856ff5e40d4615f295fdcdbd9136d6572a257af5d655`
- BotVault status: `CLOSE_ONLY`
- Funding status: `settled`
- HyperCore funding status: `withdrawn`
- Execution status: `closed`
- Close amount / withdrawn: `3.9999 USDC`
- Operation state: `close_vault_confirmed`
- Reconciliation: `ok`, issues `[]`
- Live Hyperliquid:
  - open orders: `0`
  - positions: `0`
  - perp account value: `0`
  - remaining non-blocking dust: `0.00009999 USDC`, `0.00079632 HYPE`

Profit-share check:

- `feePaidTotal`: `0`
- `profitShareAccruedUsd`: `0`
- `fee_events`: `0`
- `profit_share_accruals`: `0`

## Fourth Start Monitoring

New BotVault/GridBot start observed on 2026-05-21 around 16:31 UTC.

Runtime IDs:

- BotVault: `cmpfpjm0300xro71ypznq0i7f`
- Grid instance: `cmpfpjlyk00xpo71y60h9qtbi`
- Bot: `41099585-6fba-46c8-a12e-5584c0ce058d`
- BotVault address: `0x0b5298098668e265F4C39af0Db60616B9aF32CDd`
- Agent wallet: `0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27`

Observed flow:

- Create tx confirmed: `0x91983e81462815cda372f1999aa5528a06f04cce1b6306ac9581ab559181fafe`.
- Fund tx confirmed: `0x64ee53c912a0c7f74095cb2d6f2c278ab8a9183c422b73c3204cf31228e4f173`.
- HyperEVM USDC reached the BotVault and was deposited to HyperCore.
- Backend initially stuck at `hypercore_funded` / `submitted_waiting_hypercore_funding_indexer` with Grid still `created`.
- Live Hyperliquid check before the fix:
  - Vault Spot USDC: `5.0`
  - Vault Perp account value: `0.0`

Patch applied during this start:

- Reconciliation job now auto-calls the v4 initial margin finalizer once HyperCore funding is visible, using the Grid allocation (`investUsd + extraMarginUsd`) instead of the full principal including the 1 USDC create/accounting component.
- Reconciliation now preserves stored HYPE reserve retry details when classifying a pending reserve state, avoiding a false `recovery_required` downgrade.
- Agent HyperEVM-to-Core HYPE topup retries are now rate-limited with `BOT_VAULT_V4_AGENT_HYPE_CORE_TOPUP_RETRY_DELAY_MS=1800000` to avoid repeated pending topup transactions.

Validation:

- `npm -w apps/api run test:botvault-v4-transitions` passed.
- `npm -w apps/api run typecheck` passed.
- `npm -w apps/api exec -- node ../../node_modules/tsx/dist/cli.mjs --test src/jobs/vaultOnchainReconciliationJob.test.ts` passed before the final cooldown patch.

Post-patch live state:

- Spot-to-Perp transfer succeeded:
  - transfer tx: `0xadda92ec677b0b777ac09f192aac85da02247bafcbcdb56f3798e2ea384fc2ad`
  - Vault Perp account value: `5.0`
  - Vault Spot USDC: `0.0`
- BotVault remains blocked only on v4 HYPE reserve:
  - lifecycle: `perp_margin_transferred`
  - verification: `hype_reserve_retryable`
  - blocking reason: `bot_vault_v4_hype_reserve_agent_core_topup_pending`
  - last pending topup tx observed: `0xd0bedb8eed6a0b6c333a462785452ea4fe8e217eb95168575053837f5f728c77`
- After deploying the cooldown patch, subsequent reconciliation cycles reused the same pending topup hash and did not emit a new topup transaction.
- Post-deploy checks:
  - API `healthy`, restart count `0` after replacement.
  - Postgres active connections stayed low; no `idle in transaction`.
  - No new Prisma pool timeout logs in the observation window.
  - Live GridBot remained `running`, `execution_active`, `execution_ready`, with empty `last_plan_error`.

## V4 HYPE Reserve Duplicate-Transfer Follow-up

Observed issue:

- The agent wallet sent two direct HyperCore Spot transfers to the new BotVault:
  - `0.005 HYPE`, hash `0x4fc22d2afba6a52a513b043be63bb402021e001096a9c3fcf38ad87dbaaa7f14`
  - `0.005 HYPE`, hash `0x2498a9a759dbc15a2612043be63bca02040b008cf4dee02cc86154fa18df9b44`
- Total transferred HYPE for this BotVault: `0.01 HYPE`.
- Expected bootstrap target from metadata/config path: `0.005 HYPE`.
- Likely trigger: V4 reconcile/finalize paths could both observe missing HYPE before either transfer was visible, then both call the agent `spotSend` path.

Patch deployed on 2026-05-21:

- Added per-API-process in-flight dedupe for V4 agent HYPE reserve bootstrap by `contractVersion:vaultAddress`.
- Added a Postgres advisory transaction lock around the same bootstrap path when Prisma is available, so concurrent API processes serialize the transfer and re-read the HYPE balance before sending.
- Kept the old `bot_spot_buy` fallback outside this lock path.

Validation:

- `node ../../node_modules/tsx/dist/cli.mjs --test --test-name-pattern "dedupes concurrent v4 HYPE reserve agent transfers|tops up missing v4 HYPE reserve from the agent wallet|finalizeMarginAdd exposes pending v4 HYPE reserve bootstrap verification|finalizeMarginAdd classifies retryable v4 HYPE reserve bootstrap failures" src/vaults/botVaultV3.service.test.ts` passed.
- `npm -w apps/api run test:botvault-v4-transitions` passed.
- `npm -w apps/api run typecheck` passed.
- `npm -w apps/api run build` passed.
- API redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.
- Post-deploy checks:
  - API `healthy`, restart count `0` after replacement.
  - No new pool-timeout, unhandled-rejection, or HYPE-reserve duplicate logs in the observation window.
  - Postgres `idle in transaction=0`, `waiting_on_locks=0`.
  - Hyperliquid ledger still shows only the two earlier transfers above; no additional HYPE transfer was sent after the fix.
  - Live BotVault remains `funded` / `running`, lifecycle `execution_ready`, HYPE spot balance `0.01`.
  - Live Grid remains `running`, `last_plan_error` empty.

## Close Monitoring

- 2026-05-21 12:02:55 UTC: user stopped/ended the GridBot.
  - Bot status moved to `stopped`.
  - Grid state moved to `stopped`.
  - Hyperliquid live state after stop:
    - open orders: `0`
    - positions: `0`
    - perp account value: `0.0`
    - HYPE spot balance: `0.00997867`
- 2026-05-21 12:04:47 UTC: BotVault onchain status observed as `CLOSE_ONLY`.
- 2026-05-21 12:05:03 UTC: close settlement persisted.
  - BotVault status: `CLOSE_ONLY`
  - HyperCore funding status: `withdrawn`
  - execution status: `closed`
  - funding lifecycle stage: `settled`
  - Grid state: `archived`
  - close tx: `0xea1638a03b9ac1d2725ae808636fef72df9041078530680854930cd4c737a284`
  - principal returned / withdrawn: `9.974037 USDC`
  - profit fee: `0`
- A transient `transfer_pending_reconciliation` warning appeared during settlement, then resolved through reconciliation and persistence.
- Post-close checks:
  - API `healthy`, restart count `0`.
  - No new API pool timeout, unhandled rejection, or settlement failure logs after the close settled.
  - Postgres `idle in transaction=0`, `waiting_on_locks=0`.
  - Hyperliquid open orders and positions remained `0`.

## Agent HYPE Auto-Refill Fix

Observed issue:

- The managed agent wallet had enough native HyperEVM HYPE (`0.02470955`) but only `0.000846 HYPE` on HyperCore Spot.
- The V4 reserve bootstrap sends BotVault reserve HYPE via HyperCore `spotSend`, so native HyperEVM HYPE alone was not sufficient.
- There was no user-facing UI path to move the managed/server-side agent wallet's native HyperEVM HYPE to HyperCore, because the browser UI can only sign with the connected user wallet.

Patch deployed on 2026-05-21:

- When the V4 agent reserve path sees insufficient agent HyperCore Spot HYPE, the API now:
  - reads the agent wallet native HyperEVM HYPE balance,
  - sends a native HYPE top-up from the managed agent wallet to the HyperEVM -> HyperCore HYPE system address,
  - waits for HyperCore Spot HYPE visibility,
  - then sends the normal `0.005 HYPE` BotVault reserve transfer.
- Default top-up amount: `0.01 HYPE`.
- Default native gas reserve left on HyperEVM: `0.001 HYPE`.
- The HYPE reserve bootstrap lock now serializes by agent wallet, so concurrent V4 vaults cannot race the same agent reserve.

Validation:

- `node ../../node_modules/tsx/dist/cli.mjs --test --test-name-pattern "tops up missing v4 HYPE reserve from the agent wallet|refills agent HyperCore HYPE from HyperEVM before v4 reserve transfer|dedupes concurrent v4 HYPE reserve agent transfers" src/vaults/botVaultV3.service.test.ts` passed.
- `npm -w apps/api run test:botvault-v4-transitions` passed.
- `npm -w apps/api run typecheck` passed.
- `npm -w apps/api run build` passed.
- API redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.
- Post-deploy checks:
  - API `healthy`, restart count `0`.
  - No new pool-timeout, unhandled-rejection, or HYPE-reserve logs in the observation window.
  - Postgres `idle in transaction=0`, `waiting_on_locks=0`.
  - Agent balances before the next start remain unchanged: HyperCore Spot HYPE `0.000846`, native HyperEVM HYPE `0.02470955`.

## Second Start Monitoring After Auto-Refill Fix

New run started on 2026-05-21 around 12:39:55 UTC:

- Grid instance: `cmpfhab020087qn1yi5zigzr7`
- BotVault: `cmpfhab240089qn1y777my8zx`
- BotVault address: `0x740e38Dd78bE240fba998E10849d1000DeaCA71D`
- Agent wallet: `0xe74d337ae262ad52030a80045f6d185dacb0392a`
- Create tx confirmed: `0x9f4a2b0440d13f66b426807941308b1171bc0c1d2a0e972ab4b380ec30bd284c`

Observed live progression:

- 12:40:10 UTC: `create_bot_vault_v4` confirmed.
- 12:44:15 UTC: the local `fund_bot_vault_v4` action was marked `failed` without a tx hash, but onchain state later showed the vault had been funded.
- 12:46:02 UTC: reconciliation observed HyperEVM funding and HyperCore deposit tx `0x5e5e0aa4db2154b85d0a5cf417f7ec8bdbef8aaa21ec4f046ca4b0344065b416`.
- 12:49:10 UTC: runtime reconciliation advanced the funding lifecycle to `execution_ready`.
- HYPE reserve status became ready with observed balance `0.005 HYPE`.
- 12:52:30 UTC: onchain reconciliation autostarted execution.
- 12:52:42 UTC onward: BotVault `running`, Grid `running`.
- 12:53:11 UTC: initial seed submission started.
- 12:55:27 UTC: seed pending state cleared; Grid remained `running`.

Fixes made during this run:

- Catalog and `/bots/grid/new` provisioning flows now only mark reserve/hypercore auto-signature attempts as triggered after a successful transaction path; failed or cancelled wallet attempts can retry.
- The catalog and new-grid progress cards now show a visible button for pending reserve or HyperCore signatures.
- Reconciliation now marks unresolved funding actions without a tx hash as `confirmed` when onchain principal is already allocated, instead of leaving them as `failed`.

Validation:

- `npm -w apps/web run typecheck` passed.
- `npm -w apps/web run build` passed.
- `npm -w apps/api run typecheck` passed.
- `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api web` completed.
- Post-deploy:
  - API `healthy`, restart count `0`, started `2026-05-21T13:06:18Z`.

## Third Start Monitoring After Catalog Fix

New run started on 2026-05-21 around 14:40 UTC:

- Grid instance: `cmpfll4ca0094m91ym9qssdw5`
- BotVault: `cmpfll4e40096m91y9lpmh2d0`
- Bot: `3b5a2fa8-6e53-4389-83ed-dd1315811934`
- Agent wallet: `0xe74d337ae262ad52030a80045f6d185dacb0392a`
- Create tx submitted: `0xc551d5f25e3630e06161f52ee717c327aa0e968eebcbbb13de341c752be49017`
- Initial row state:
  - Grid state: `created`
  - BotVault funding status: `deployed`
  - HyperCore funding status: `not_funded`
  - Execution status: `created`
  - Principal allocated: `0`
  - Grid config observed: `invest_usd=5`, `extra_margin_usd=0`, `leverage=20`
- Baseline during start:
  - API `healthy`, restart count `0`.
  - Web `healthy`.
  - No new Catalog `provisioningStatus` SSR crash in Web logs.

Observed live progression:

- 14:40:37 UTC: `create_bot_vault_v4` confirmed.
  - BotVault address: `0xCDb6eC69bb5EA406E0D376210C2DCB5be8f86079`
- 14:41:09 UTC: `fund_bot_vault_v4` confirmed.
  - tx: `0x6ad7e6e605a70fa72dd73440af019614ea641ba2e46a5fc0e22fec3a2a7e14c7`
  - amount: `6 USDC`
- 14:41 UTC state:
  - Funding status: `hyper_evm_confirmed_onchain`
  - HyperCore funding status: `not_funded`
  - Execution status: `created`
  - Lifecycle state: `bot_activation`
  - Provisioning phase: `submitted_waiting_hypercore_funding_indexer`
- 14:43 UTC: reconciliation advanced local funding lifecycle to `execution_ready`, but live Hyperliquid still showed:
  - HyperCore Spot: `5.0 USDC` and `0.005 HYPE`
  - Perp account value: `0.0`
  - open orders: `0`
  - This was a false-positive lifecycle advance; the USDC had not been transferred from Spot to Perp yet.
- Manual recovery during live monitoring:
  - Ran `finalizeMarginAdd` for `amountUsd=5`.
  - Result: `transferToPerpAmountUsd=5`, `coreSpotBalanceAfterUsd=0`, HYPE reserve `ready`, `hypeBalanceAfter=0.005`.
- After recovery, initial seed attempted but Hyperliquid returned `perpMarginRejected` twice.
  - Root cause: BotVault/CoreWriter execution had cached leverage as `isolated`, while CoreWriter order submission effectively uses cross margin. The order notional was too large for the cross leverage state at that time.

Patch deployed during this run:

- Runner now forces BotVault runtime/CoreWriter leverage and order placement to `cross`, matching the actual CoreWriter execution mode.
- Initial-seed retry scheduling now advances the attempt sequence and clears the stale client order id even when the previous attempt is only "missing confirmable order" locally. This avoids reusing the same cloid after venue-side rejection.
- Validation:
  - `npm -w apps/runner run typecheck` passed.
  - `npm -w packages/futures-exchange run typecheck` passed.
  - Runner redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build runner`.
  - Compose also recreated API and py-strategy-service as dependencies; post-deploy API and Runner restart counts were `0` and both became healthy.

Post-fix live result:

- Runner updated leverage cache to `cross`, `leverage=20`.
- Seed succeeded:
  - BTC long position: `0.00039 BTC`
  - Entry: `76935.4`
  - Position value: about `30.01 USDC`
  - Live leverage: `cross 20`
- Grid is `running` with empty `last_plan_error`.
- Live open order:
  - Reduce-only sell BTC `0.00039` at `80000`
  - Exchange oid: `436151823279`
- Hyperliquid live state:
  - Perp account value: about `4.99 USDC`
  - Withdrawable: about `1.99 USDC`
  - Open orders: `1`
  - Web `healthy`, restart count `0`, started `2026-05-21T13:06:40Z`.
  - BotVault status `ACTIVE`, funding `hyper_evm_confirmed_onchain`, hypercore `funded`, execution `running`, lifecycle `execution_ready`.
  - Grid state `running`, Bot status `running`.
  - `fund_bot_vault_v4` action is now `confirmed` with no tx hash, reflecting recovered onchain funding evidence.
  - No duplicate HYPE reserve transfer was observed; reserve amount stayed `0.005 HYPE`.

## Third Close Monitoring

Close was observed on 2026-05-21 around 16:04-16:10 UTC.

Live close progression:

- Initial post-stop Hyperliquid state showed no positions and no open orders.
- Perp funds had been moved back to Spot:
  - HyperCore Perp account value: about `5.083186 USDC`
  - HyperCore Spot USDC: about `5.083186 USDC`
  - HyperCore Spot HYPE reserve: `0.005 HYPE`
- The first settlement attempt logged a `transfer_usdc_spot_to_evm` failure because the managed agent wallet briefly lacked enough native HyperEVM HYPE for the CoreWriter gas estimate.
- The close later completed:
  - Close tx: `0x9f5eadd237e02765050e3c2c5379ab36d7bc6b29cd1b300c070191ce0cbf1d6b`
  - BotVault status: `CLOSE_ONLY`
  - Funding status: `settled`
  - HyperCore funding status: `withdrawn`
  - Execution status: `closed`
  - Bot status: `stopped`
  - Grid state: `archived`

Profit-share check:

- `closeSettlement.grossAmountUsd`: `5.083186`
- `closeSettlement.feeRatePct`: `5`
- `closeSettlement.profitBaseUsd`: `0`
- `closeSettlement.feeAmountUsd`: `0`
- `fee_events`: no rows for this BotVault.
- `profit_share_accruals`: no rows for this BotVault.
- Root cause: the 1 USDC BotVault create/accounting component was included in `principalAllocated=6` but was not marked as excluded principal. The close therefore calculated `5.083186 - 6 = 0` profit instead of comparing the returned funds against the actual grid trading allocation of `5`.

Patch applied after this close:

- New grid BotVault create flows now persist `hypercoreAccountingFeeUsd=1` in BotVault execution metadata.
- Profit-share accounting now has a fallback for existing rows: if metadata is missing, it infers the create/accounting component from `principalAllocated - (grid.investUsd + grid.extraMarginUsd)`, capped by `BOT_VAULT_V4_CREATE_ACCOUNTING_FEE_MAX_USD` with a default of `1`.
- Targeted regression test added for closing with the inferred grid funding delta.
- Validation:
  - Targeted `botVaultV3.service.test.ts` pattern passed.
  - `npm -w apps/api run typecheck` passed.
- API redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.

## Agent Wallet HyperCore Prewarm Fix

Implemented after the fresh Agent Wallet run exposed that native HyperEVM HYPE can be present while spendable HyperCore Spot HYPE is still missing.

- User Agent Wallet summaries now include live HyperCore HYPE readiness:
  - balance, required amount, ready flag, state, bootstrap tx hash, and reason.
- Creating or restoring a managed Agent Wallet now attempts a one-time HyperCore HYPE bootstrap immediately when native HyperEVM HYPE is already available.
- Recording a user Agent Wallet HYPE funding tx now also attempts the same bootstrap after the funding action is tracked.
- Grid preview/create preflight now blocks BotVault v4 startup unless:
  - Agent Wallet exists,
  - native HyperEVM HYPE is above the configured threshold,
  - spendable HyperCore HYPE is already ready.
- Duplicate protection:
  - in-process bootstrap calls are deduped per user/Agent Wallet,
  - recent submitted/prepared bootstrap actions are treated as pending,
  - failed HyperCore balance reads fail closed and do not submit a top-up.
- Validation:
  - Targeted Agent Wallet and v4 HYPE reserve service tests passed.
  - Grid/vault route tests passed.
  - `npm -w apps/api run typecheck` passed.
- API redeployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api`; post-deploy health was `healthy`, restart count `0`.
- Current user Agent Wallet read-only check after deploy:
  - address: `0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27`
  - native HyperEVM HYPE: `0.039388700410176106`
  - HyperCore HYPE: `0.05`
  - required HyperCore HYPE: `0.01`
  - readiness: `ready`

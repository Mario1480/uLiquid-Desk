# 2026-05-20 Grid Bot Vault API Fixes

## Live context

- User: `cmn4a70gc0dyap62e5febk3z7`
- Grid instance: `cmpdy5e8z025ynz1x9z5qhy8i`
- Bot: `25a06720-11cc-49db-844f-c3cf62e6c2de`
- BotVault: `cmpdy5eaf0260nz1x3euq34qe`
- BotVault address: `0x42B2552366585F90CbD87bf5F8481e4d86104Ec4`
- Create tx: `0xaac45175a3217472239a8ea7b458a3068965f7b918d98edb9c5394178e1347ba`
- Fund tx: `0x298244fc498754adca644d1c35f0495f429cb7890df5779927ab762934c928f7`

## Fixes applied

1. `executionLifecycle.service.ts`
   - Root cause: grid detail polling saturated Prisma because `syncExecutionState` held a DB transaction open while doing provider/Hyperliquid reads.
   - Change: when no caller transaction is supplied, reads now happen outside the write transaction; only the persistence step opens a short transaction.
   - Added test coverage for provider reads outside the write transaction.

2. `botVaultV3.service.ts`
   - Root cause: v4 Reconcile could see live perp margin, but if `marginAddFinalization` was missing it could not repair readiness.
   - Change: Reconcile can synthesize verified v4 margin metadata when perp margin and HYPE reserve are both live-visible.
   - Added test coverage for v4 margin verification from live balances.

3. `botVaultV3.service.ts`
   - Root cause: when v4 perp margin was visible but HYPE reserve was not ready, Reconcile left the vault silently pending.
   - Change: Reconcile now persists `hype_reserve_retryable`, `verificationBlockingReason`, HYPE reserve status fields, tx hash, observed balance, and warning mismatch metadata.
   - Added test coverage for `hype_reserve_pending_from_reconciliation`.

4. `ensureHypercoreExitGas`
   - Root cause found after live tx decode: CoreWriter receipt success does not prove HyperCore order/fill success. The first reserve order used an 8-decimal price (`49.58878200`-style payload), while HYPE spot should use Hyperliquid spot precision.
   - Change: HYPE reserve buy now formats price/size with Hyperliquid precision helpers and rounds buy price up to the valid spot tick.
   - Exported precision helpers from `@mm/futures-exchange`.

5. `ensureHypercoreExitGas`
   - Root cause confirmed from live Hyperliquid `historicalOrders`: HYPE reserve orders were rejected with `minTradeNtlRejected`.
   - The vault had only `5 USDC` spot-visible, while the reserve bootstrap budget allowed only `1 USDC`. The attempted `0.01 HYPE` buy was about `$0.51`, below Hyperliquid's spot minimum notional.
   - Change: before sending a CoreWriter spot order, the API now checks `HYPERLIQUID_SPOT_MIN_TRADE_NOTIONAL_USD` (default `10`) against the affordable/budgeted buy notional.
   - If the order cannot meet the minimum notional, Reconcile classifies the vault as user-action-required with `bot_vault_v4_hype_reserve_min_trade_notional` and does not submit another futile CoreWriter order.

## Validation

- Focused BotVault tests passed:
  - `reconcileBotVaultV3ById verifies v4 margin from live balances when finalization metadata is missing`
  - `reconcileBotVaultV3ById persists pending v4 HYPE reserve state when margin is visible`
  - `reconcileBotVaultV3ById classifies v4 HYPE reserve min-notional rejects before retrying`
- `npm -w packages/futures-exchange run build` passed.
- `npm -w apps/api run typecheck` passed.
- `npm -w apps/api run build` passed.
- API deployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.
- Containers healthy after deploy:
  - `uliquid-desk-api-1 restart=0 health=healthy`
  - `uliquid-desk-runner-1 restart=0 health=healthy`
  - `uliquid-desk-py-strategy-service-1 restart=0 health=healthy`

## Current live state

After the final deploy and direct Reconcile:

- Vault remains funded on HyperEVM/perp-margin side, but HYPE reserve bootstrap is blocked.
- `hypercoreFundingStatus` remains `not_funded`.
- Funding lifecycle stage is `recovery_required`.
- Readiness is blocked for user action:
  - `reason=bot_vault_v4_execution_blocked`
  - `detail=bot_vault_v4_hype_reserve_min_trade_notional`
  - `verificationState=hype_reserve_user_action_required`
  - `verificationBlockingReason=bot_vault_v4_hype_reserve_min_trade_notional`
  - `hypeReserveState=user_action_required`
- Latest persisted HYPE reserve tx:
  - `0xfb030706b0edd1f252b6c39e49a5f024154abb1b39b9a9a7bc50589829a07346`
- Latest decoded tx payloads/orders:
  - EVM receipt status `0x1`
  - action id `1` limit order
  - asset `10107` (`10000 + @107` HYPE/USDC spot market)
  - buy `true`
  - size `0.01`
  - reduce only `false`
  - tif `2`
- Hyperliquid `historicalOrders` for the BotVault shows repeated `minTradeNtlRejected` statuses for these HYPE/USDC buys.
- Live Hyperliquid spot state for the vault still shows only USDC:
  - `USDC total=5.0`
  - no HYPE balance

## Important conclusion

The HYPE reserve is not arriving because Hyperliquid rejects the buy orders below the minimum trade notional. HyperEVM CoreWriter receipt success only proves the message reached CoreWriter; the actual HyperCore order can still be rejected. The current code now records this as a user-action-required min-notional blocker and stops retrying underfunded reserve buys.

## Related HYPE transfer evidence

The previous successful v4 HYPE reserve topups did not come from a BotVault spot buy. Hyperliquid ledger shows they were direct HyperCore spot transfers from the user agent wallet:

- Agent wallet: `0xe74d337ae262ad52030a80045f6d185dacb0392a`
- Agent wallet was initially funded on HyperCore Spot with `0.05 HYPE` on 2026-04-10 13:33:04 UTC:
  - source: `0x2222222222222222222222222222222222222222`
  - destination: agent wallet
  - hash: `0x32b23f22bbddcb09342b0438d3e9280207d5000856d0e9dbd67aea757ad1a4f3`
- On 2026-05-19 17:44:12 UTC, agent wallet sent `0.005 HYPE` to BotVault `0xff82B3A7F4E9c251Bd9Ad2483F26A09124b20FB6`:
  - hash: `0x73b9cfacac8c8f727533043bc507db0201590092478fae4417827aff6b80695d`
- On 2026-05-19 18:28:38 UTC, agent wallet sent `0.005 HYPE` to BotVault `0x301F1Ba2dB5A2744eF0e03d7893f2E6b414849B0`:
  - hash: `0xac4dbd5c7b1103bcadc7043bc59e580205f900421614228e501668af3a14dda7`
- Current agent HyperCore Spot balance observed after those sends: `0.015846 HYPE`.

## Agent HYPE reserve automation

Implemented and deployed a V4 HYPE reserve source change:

- New/default V4 reserve source: direct HyperCore Spot `spotSend` from the BotVault's agent wallet.
- `ensureHypercoreExitGas` now checks the BotVault HYPE balance first. If it is below target, V4 sends the missing amount from the agent wallet instead of buying HYPE/USDC from the BotVault.
- Reused V4 BotVaults go through the same Reconcile/Finalize path: if their HYPE reserve is still present, no transfer is sent; if it is missing, the agent wallet tops it up again.
- The old BotVault HYPE/USDC buy path remains available only when `BOT_VAULT_V4_HYPE_RESERVE_SOURCE=bot_spot_buy`.
- V4 margin funding no longer adds the HYPE reserve USDC budget to the required Core Spot deposit when the agent-transfer reserve source is active.
- Added API dependency on `@nktkas/hyperliquid` for backend `spotSend`.

Validation:

- Focused BotVault tests passed for:
  - new V4 vault HYPE reserve bootstrap via agent transfer,
  - reused/reconciled V4 vault missing HYPE reserve topup via agent transfer,
  - legacy min-notional classification for the explicit bot-spot-buy path.
- `npm -w apps/api run typecheck` passed.
- `npm -w apps/api run build` passed.
- API deployed with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api`.

Live result for BotVault `cmpdy5eaf0260nz1x3euq34qe`:

- Direct agent HyperCore Spot transfer submitted on 2026-05-20:
  - source: `0xe74d337ae262ad52030a80045f6d185dacb0392a`
  - destination: `0x42B2552366585F90CbD87bf5F8481e4d86104Ec4`
  - amount: `0.005 HYPE`
  - Hyperliquid ledger hash: `0x4f202679784384555099043bd7fee60202fe005f1346a327f2e8d1cc37475e3f`
- Agent wallet HYPE balance after transfer: `0.010846 HYPE`.
- BotVault spot state after transfer: `5.0 USDC` and `0.005 HYPE`.
- DB state after direct Reconcile:
  - `hypercore_funding_status=funded`
  - funding lifecycle stage `execution_ready`
  - `verificationState=funding_verified`
  - `hypeReserveState=ready`
  - `hypeReserveObservedBalance=0.005`

## Next likely fix

Decide the product/funding rule for v4 HYPE reserve bootstrap:

- Increase the HYPE reserve budget/spot allocation enough to satisfy Hyperliquid's minimum trade notional, currently modeled as `HYPERLIQUID_SPOT_MIN_TRADE_NOTIONAL_USD=10`.
- Or require external/pre-funded HYPE on the BotVault before execution can become ready.
- Or adjust the v4 deposit split so enough USDC remains spot-side for the reserve order before the perp margin transfer consumes the rest.
- Preferred technical path based on the ledger evidence: use the agent wallet as a central HyperCore Spot HYPE reserve and direct-send `0.005 HYPE` to each new BotVault after creation, then reconcile readiness from the BotVault's spot balance.

## Useful commands

Direct Reconcile:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api sh -lc 'node --input-type=module -e "import { prisma } from \"@mm/db\"; import { createBotVaultV4Service } from \"./apps/api/dist/vaults/botVaultRuntime.service.js\"; const svc=createBotVaultV4Service(prisma,{logger:{warn:(m,x)=>console.log(\"WARN\",m,JSON.stringify(x))}}); const r=await svc.reconcileBotVaultV4ById({userId:\"cmn4a70gc0dyap62e5febk3z7\",botVaultId:\"cmpdy5eaf0260nz1x3euq34qe\",persist:true,throwOnPersistFailure:true}); console.log(JSON.stringify({stage:r?.fundingLifecycleStage, hypercoreFundingStatus:r?.hypercoreFundingStatus, readiness:r?.executionReadiness}, null, 2)); await prisma.\$disconnect();"'
```

Live spot state:

```bash
curl -sS https://api.hyperliquid.xyz/info -H 'content-type: application/json' -d '{"type":"spotClearinghouseState","user":"0x42B2552366585F90CbD87bf5F8481e4d86104Ec4"}'
```

Live historical HYPE order rejects:

```bash
curl -sS https://api.hyperliquid.xyz/info -H 'content-type: application/json' -d '{"type":"historicalOrders","user":"0x42B2552366585F90CbD87bf5F8481e4d86104Ec4"}'
```

DB status:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres psql -U mm -d marketmaker -c "select id, funding_status, hypercore_funding_status, execution_status, status, execution_metadata->'fundingLifecycle'->>'stage' as stage, execution_metadata->>'lastAction' as last_action, execution_metadata->'marginAddFinalization'->>'verificationState' as verification_state, execution_metadata->'marginAddFinalization'->>'verificationBlockingReason' as blocking_reason, execution_metadata->'marginAddFinalization'->>'hypeReserveTxHash' as hype_tx from bot_vaults where id='cmpdy5eaf0260nz1x3euq34qe';"
```

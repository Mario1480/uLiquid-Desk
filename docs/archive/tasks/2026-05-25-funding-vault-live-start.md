# 2026-05-25 FundingVault BotVault Launch Live Monitoring

## Context

This note documents the first successful FundingVault-backed BotVault V4 GridBot launch observed on production HyperEVM.

User and vault context:

- User id: `cmn4a70gc0dyap62e5febk3z7`
- FundingVault DB id: `cmp1azite02d5n11zszq1v6tl`
- FundingVault address: `0x0b02727005f3b877d279ccc24b7b1d34eafa0c6d`
- FundingVault owner: `0xa7A53774f9abdaFf5f1c5D194A865c88fe1301EF`
- Current agent/operator wallet: `0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27`
- Previous onchain operator wallet: `0xE74d337Ae262Ad52030A80045f6d185dacB0392A`
- FundingVault factory: `0x9caAc85f03AEfDc925047B75bA88245E4c6eeD78`
- Chain: HyperEVM, chain id `999`

The earlier BotVault flow from the user wallet already worked. This run tested the FundingVault launch path where the server-side agent signs `launchBotVault` on the FundingVault and the FundingVault becomes the BotVault beneficiary.

## Initial Failure

Two launch attempts failed before operator rotation:

- `cmpl396m51bw7qn1zbmgu3ifi`
  - action type: `launch_bot_vault_from_funding_vault`
  - created at: `2026-05-25 10:53:45 UTC`
  - status: `failed`
  - error: `revert: only_operator`
- `cmpl3dus41c0yqn1zf5mnbcbp`
  - action type: `launch_bot_vault_from_funding_vault`
  - created at: `2026-05-25 10:57:23 UTC`
  - status: `failed`
  - error: `revert: only_operator`

Root cause:

- The DB had already been updated to the new agent/operator `0xf9Ac...aD27`.
- The FundingVault contract still had `operator() = 0xE74d...392A`.
- `FundingVaultV1.launchBotVault` is guarded by `onlyOperatorActive`.

Useful checks:

```bash
cast call --rpc-url https://rpc.hyperliquid.xyz/evm \
  0x0b02727005f3b877d279ccc24b7b1d34eafa0c6d \
  'operator()(address)'

cast call --rpc-url https://rpc.hyperliquid.xyz/evm \
  0x0b02727005f3b877d279ccc24b7b1d34eafa0c6d \
  'owner()(address)'
```

## Operator Rotation Runbook

FundingVault rotation does not require deploying a new FundingVault. The owner can call `setOperator(address)` on the existing FundingVault.

Correct target:

```text
to:    0x0b02727005f3b877d279ccc24b7b1d34eafa0c6d
value: 0
data:  0xb3ab15fb000000000000000000000000f9ac451068c7ad47f4e22a8138697797e8efad27
gas:   60000 or 100000
from:  0xa7A53774f9abdaFf5f1c5D194A865c88fe1301EF
```

The first manual attempt failed because it was a plain HYPE transfer:

- tx: `0x01d97bf79c0162cd1db519f9602786af5a905b0cf42b7ccdb293515cd3ea2a3f`
- status: failed
- from: owner wallet
- to: FundingVault
- value: `0.001 HYPE`
- input: `0x`
- trace: FundingVault fallback reverted

MetaMask operational note:

- Enable `Settings -> Advanced -> Show Hex Data` in the browser extension.
- Send to the FundingVault contract with amount `0`.
- Paste the calldata in `Hex Data` / `Input Data`.
- Confirm the transaction is a contract interaction, not a normal HYPE transfer.

After the correct transaction, the onchain state matched DB state:

```text
operator():      0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27
operatorPaused:  false
balance():       25 USDC
```

## Successful FundingVault Launch

Successful launch action:

- action id: `cmpl448j91d73qn1zqgqh67wk`
- action type: `launch_bot_vault_from_funding_vault`
- tx: `0x34e3c69d53426f6cb9a6a63fd9fc4c7e5bb55f95db18dc22908bb35b8fa1826f`
- created at: `2026-05-25 11:17:54 UTC`
- submitted at: `2026-05-25 11:17:56 UTC`
- confirmed at: `2026-05-25 11:21:27 UTC`

Runtime ids:

- Grid instance: `cmpl4488n1d6zqn1z8tjzuwrc`
- BotVault DB id: `cmpl448b21d71qn1zdhthv0y2`
- Bot id: `3cd4ba19-effe-428a-9763-912576d6ddc5`
- BotVault address: `0xd5a9a78e1b402a832b0F2A125FFDCa1f428C476A`
- Funding source: `funding_vault`
- Beneficiary: FundingVault address `0x0b02727005f3b877d279ccc24b7b1d34eafa0c6d`
- Agent wallet: `0xf9Ac451068c7AD47F4e22a8138697797E8eFaD27`

Funding allocation:

- FundingVault before launch: `25 USDC`
- Launch allocation: `6 USDC`
- FundingVault after confirmation: `free_balance=19`, `reserved_balance=0`
- BotVault `allocated_usd=6`
- BotVault `funding_status=hyper_evm_confirmed_onchain`
- BotVault `hypercore_funding_status=funded`

Lifecycle progression:

- API created BotVault row and FundingVault reserve.
- Onchain action moved to `submitted`.
- Grid moved to `funding_pending`.
- HyperEVM launch confirmed after indexer processing.
- Grid moved from `funding_pending` to `created`.
- HyperCore transfer/funding verification completed.
- Logs emitted:
  - `bot_vault_v4_margin_add_verified`
  - `bot_vault_v4_execution_ready_confirmed`
- Onchain reconciliation autostarted execution.
- BotVault ended at `execution_status=running`.
- Grid ended at `state=running`.

Autostart event:

- event id: `cmpl4bk621dfjqn1zhzv54x7k`
- source key: `bot_vault:cmpl448b21d71qn1zdhthv0y2:onchain_reconciliation_autostart`
- action: `start`
- result: `succeeded`
- created at: `2026-05-25 11:23:36 UTC`

## Live Trading Result

Initial seed:

- Grid state: `running`
- Initial seed executed: `true`
- Side: long
- Market order client id: `grid-cmpl4488n1d6zqn1z8tjzuwrc-seed-buy-1`
- Submit tx: `0x361919c79c4347a098edb2191d4efb329502accefdcbad8c71d1334d0fc3bc8b`
- Quantity: `0.00039 BTC`
- Entry/fill price: `77387`
- Notional: `30.18093 USDC`
- Fee: `0.013581 USDC`

Open position:

- Symbol: `BTCUSDC` / `BTC-PERP`
- Side: long
- Size: `0.00039`
- Open position count: `1`
- Latest available margin observed: about `1.964816 USDC`

Open orders observed after seed:

- Reduce-only sell `0.00039 BTC` at `80000`
  - client order id: `grid-cmpl4488n1d6zqn1z8tjzuwrc-long-2`
  - exchange order id: `cloid:0:134521388160645348601685987387732999946`
- Buy order near `77619`
  - client order id: `0x30e7f0bf43aa8b3701c61cda1144890c`
- A partially-filled buy row for the seed was also persisted.

## Rate Limit Observations

The live run exposed HyperEVM RPC rate limits during the critical confirmation window.

Observed log signatures:

- `vault_onchain_indexer_rate_limited`
- `vault_onchain_indexer_receipt_rate_limited`
- `vault_onchain_reconciliation_bot_state_read_failed`

Examples:

- `eth_getTransactionReceipt` for the FundingVault launch tx was rate limited:
  - tx: `0x34e3c69d53426f6cb9a6a63fd9fc4c7e5bb55f95db18dc22908bb35b8fa1826f`
  - API backoff: `nextPollMs=45000`
  - `nextMaxBlockSpan=250`
  - `retryAfter=2026-05-25T11:20:38.634Z`
- Several `eth_call` reads for older BotVault rows were rate limited during the same window.
- Manual operator checks and receipt polling can worsen the same shared RPC quota if performed against the production RPC while the indexer is catching up.

Operational impact:

- The launch was submitted successfully.
- The tx was briefly not readable through `cast tx` / `cast receipt`.
- The app remained in `submitted_waiting_indexer` / `funding_pending`.
- After the indexer backoff elapsed, it processed the event:
  - `vault_onchain_indexer_cycle`
  - `fetchedLogs=1`
  - `processedEvents=1`
  - `failedEvents=0`
- Confirmation and lifecycle advancement then completed automatically.

Important distinction:

- The rate limit was not a funding failure.
- It delayed receipt/event processing and UI/status progression.
- The recovery path was automatic once the RPC allowed reads again.

Implemented mitigation after the live run:

- `vaultOnchainIndexerJob` now prioritizes submitted FundingVault launch/fund actions before broad submitted-action polling.
- Receipt and factory-state `LimitExceededRpcError` handling now applies adaptive backoff and stops the current indexer cycle instead of continuing to poll remaining submitted actions against the same limited RPC quota.
- `vaultOnchainReconciliationJob` now has its own adaptive rate-limit backoff, exposes `totalRateLimitedCycles` and `rateLimitedUntil`, and stops the current reconciliation cycle after a rate-limited master/bot state read.
- Reconciliation BotVault reads are prioritized toward pending funding/lifecycle rows before already-running or closed rows, so scarce RPC reads are spent on active funding flow first.
- Added regression coverage for action/read prioritization and the reconciliation "stop after first rate limit" behavior.

## Reconciliation Drift After Start

After trading began, logs showed:

- `vault_onchain_reconciliation_drift`
- mismatch category: `local_ahead_of_observed_state`
- issue class: `recoverable_track`
- recovery action: `retry`

Observed reason:

- Local trading reconciliation already included fee impact:
  - DB `realizedPnlNet=-0.013581`
- Contract accounting still had:
  - chain `realizedPnlNet=0`
  - chain `feePaidTotal=0`

This is expected immediately after live trading activity when local trading observations are ahead of onchain profit/fee accounting. It was not a launch blocker.

## Recommended Optimizations

### Operator And FundingVault UX

- Add a FundingVault operator mismatch preflight:
  - read `FundingVault.operator()`
  - compare with `funding_vaults.operator_address`
  - block agent launch with a clear `funding_vault_operator_mismatch` reason before submitting.
- Add a UI/Admin rotate-operator flow:
  - build `setOperator(address)` tx request,
  - require owner wallet,
  - display expected old/new operator,
  - prevent normal HYPE transfer mistakes.
- Persist `setOperator` as an `onchain_actions` type, for example `rotate_funding_vault_operator`.
- Add a FundingVault overview field for `onchainOperatorAddress` and `operatorMatches`.

### RPC Rate Limit Reduction

- Use a dedicated HyperEVM RPC quota for API indexer/reconciliation jobs, separate from manual operator checks.
- Add per-job RPC buckets:
  - receipt polling,
  - log scanning,
  - BotVault state reads,
  - trading reconciliation reads.
- Prioritize submitted capital-moving actions over broad scheduled reads:
  - `eth_getTransactionReceipt` for submitted actions should outrank stale legacy BotVault reconciliation reads.
- Temporarily suppress or lower concurrency for legacy/closed BotVault read checks during a pending launch.
- Keep receipt polling jittered and bounded:
  - avoid synchronized retries from indexer and manual scripts.
- Cache immutable contract reads where safe:
  - `owner`,
  - factory,
  - static addresses,
  - known closed vault metadata.
- Back off on `LimitExceededRpcError` globally per RPC host, not only per call site.
- Add metrics for:
  - RPC method,
  - job name,
  - action id,
  - rate-limit count,
  - retry-after,
  - time from `submitted` to `confirmed`.

### Indexer And Lifecycle Robustness

- Make `submitted_waiting_indexer` expose a richer pending reason in UI:
  - `receipt_rate_limited`,
  - `tx_not_found_yet`,
  - `waiting_confirmations`,
  - `event_processing_pending`.
- When provider read already discovers `providerState.vaultAddress`, persist it as provisional metadata while waiting for receipt/event confirmation, with clear `provisional` status.
- Add an admin action to re-check one specific submitted action by id, with single-flight protection.
- Include pending action status in the GridBot launch drawer after FundingVault launch.

## Useful SQL Checks

```sql
select id, action_type, status, tx_hash, bot_vault_id, created_at, updated_at
from onchain_actions
where user_id = 'cmn4a70gc0dyap62e5febk3z7'
order by created_at desc
limit 10;

select id, funding_vault_id, funding_source, grid_instance_id, bot_id,
       vault_model, vault_address, execution_status, funding_status,
       hypercore_funding_status, allocated_usd, available_usd, status, updated_at
from bot_vaults
where id = 'cmpl448b21d71qn1zdhthv0y2';

select id, state, invest_usd, state_json, last_plan_error, updated_at
from grid_bot_instances
where id = 'cmpl4488n1d6zqn1z8tjzuwrc';

select free_balance, reserved_balance, updated_at
from funding_vaults
where id = 'cmp1azite02d5n11zszq1v6tl';
```

## Useful Log Filters

```bash
docker compose -f docker-compose.prod.yml logs -f --since "$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" api runner web \
  | rg --line-buffered -i "funding_vault|launch_bot_vault_from_funding_vault|bot_vault|onchain|receipt|revert|txHash|submitted|confirmed|execution_ready|rate_limited|funding_pending|only_operator"
```

Avoid heavy repeated `cast receipt` polling during the live indexer window. Prefer one-off checks, then let the API indexer recover its own rate-limit backoff.

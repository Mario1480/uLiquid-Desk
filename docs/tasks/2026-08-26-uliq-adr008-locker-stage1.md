# ULIQ ADR-008 Locker Stage 1

Date: 2026-08-26

## Scope

- Arbitrum Sepolia only (`chainId = 421614`).
- Deploy a replacement `ULIQLocker` for the existing V3 ULIQ token.
- Preserve the existing token, presale, vesting, custody, treasury and DEX history.
- No staging runtime switch, feature-flag activation, token transfer, lock creation or mainnet action.

## Deployment

- Source commit: `7032642706246ef648e312bf8685926eea6ddcf4`
- Script: `packages/contracts/script/uliq/DeployULIQLockerTestnet.s.sol`
- Deployer: `0x4165Df9092aD2adffFE6A63ad10863F696cac125`
- Existing V3 token: `0xAe4f9400248775A5FaDbE201Bf4CA0649e8910c6`
- New locker: `0x65E51e90e790e8510b412c97d4b5AD1Ab89aA6F9`
- Transaction: `0x27de661315f704c8feda3bd528c86c73831e160746ce84952d3ec209873bbe57`
- Deployment block: `302290715`
- Gas used: `614175`
- Paid: `0.00001240510665 ETH`
- Sourcify: `exact_match`

## Post-deployment checks

- Receipt status: success.
- Receipt block hash matched the canonical RPC block hash.
- Runtime bytecode length: `2122` bytes.
- `token()` returned the existing V3 token.
- `nextLockId()` returned `1`.
- `totalLocked()` returned `0`.
- `31 days`, `184 days` and `366 days` were accepted.
- The superseded `30 days` duration was rejected.
- `extendLock(uint256,uint64)` selector: `0x7ab6489d`.

## Rollout status

`STAGING_LOCKING_ACTIVE_DISCOUNTS_CLOSED`

Deployment block `302290715` was included by the Arbitrum Sepolia RPC
`finalized` tag before the separately approved runtime switch.

## Staging runtime switch

Date: 2026-08-27

- Target: Hostinger VPS `1286926` (`76.13.10.40`), isolated staging only.
- Active source commit: `7032642706246ef648e312bf8685926eea6ddcf4`.
- `ULIQ_LOCKER_ADDRESS` now points to
  `0x65E51e90e790e8510b412c97d4b5AD1Ab89aA6F9`.
- `ULIQ_LOCKING_ENABLED=true`.
- `ULIQ_DISCOUNTS_ENABLED=false`; monetary benefits remain closed pending the
  separate E2E acceptance and activation gate.
- `/opt/uliquid-desk/.env.prod` and `/etc/uliquid-desk/staging.env` were
  reconciled after separate root-only backups.
- Active env backup:
  `/root/uliq-staging-env-pre-locker-switch-20260827T132008Z.prod`
  (`sha256:18671bc3fc85fe57f5d822178fd90f270972f785926038cc9ec64b2aa9da9b60`).
- Canonical env backup:
  `/root/uliq-staging-system-env-pre-locker-switch-20260827T132008Z.env`
  (`sha256:44863737a55f9b02e82be70db80e834d9e4a95bc04b15bcd48899644a6ce6aac`).
- Only the API container was recreated; Web, Runner, Postgres, Redis and the
  strategy service were not restarted.
- API health: healthy, restart count `0`; private and public health endpoints
  passed and `/uliq/presale` returned HTTP `200`.
- Finalized read at block `302563264`: `token()` matched the V3 token,
  `nextLockId()` was `1`, and `totalLocked()` was `0`.
- ULIQ indexer cursor: block `302563264`, failure count `0`.
- Latest reconciliation: `OK`, mismatch count `0`.
- No lock events or active lock positions existed at switch time, as expected.

## First-lock indexer recovery

Date: 2026-08-27

- Scope: isolated staging on Hostinger VPS `1286926`; API and database
  migration only.
- Deployment commit: `4da16781a6ae3287d08dff0c1dfc48eed978fc33` on
  `codex/uliq-lock-duration-fix`.
- The first real lock transaction
  `0x5ca39badc9da440f16433be2501d0e3bebbd7bd34e61f2e9c69c09f5e15fb80e`
  was already finalized at block `302572939`.
- Root cause: the historical database constraint accepted only `30`, `90`
  and `180` days, while ADR-008 and the deployed locker use `31`, `184` and
  `366` days.
- Migration `20260827143000_uliq_lock_duration_constraint_v1` expanded the
  projection constraint to `30`, `31`, `90`, `180`, `184` and `366` days.
  Historical projection values remain readable; new API and contract actions
  continue to accept only the ADR-008 terms.
- Pre-migration database backup:
  `/root/uliq-staging-pre-lock-duration-fix-20260827T142422Z.dump`
  (`sha256:fbc6810ff8b2b20dfddddeb39f5c1dc23b5c3ede4440be18603ce6822233e9da`,
  mode `0600`).
- Rollback API image: `uliquid-desk-api:rollback-lock-duration-20260827T142422Z`
  (`sha256:f80078cf356cd5a142ecb94cb8d871e1ff52fa7c485099888c90deec65a3f91a`).
- New API image:
  `sha256:d70003e4ddd180ffd2ab05ffc062b7a1751dd0fa06e54b3164771f081cd6e9ca`.
- Only the API container was recreated. Web, Runner, Postgres, Redis and the
  strategy service retained their existing containers.
- Migration completed without rollback; the validated database constraint is
  `duration_days = ANY (ARRAY[30, 31, 90, 180, 184, 366])`.
- Lock ID `1` is projected as `ACTIVE` for
  `0x4165Df9092aD2adffFE6A63ad10863F696cac125`, amount `100000 ULIQ`, duration
  `31` days, unlock at `2026-09-27T13:48:27Z`.
- `TokensLocked` and the corresponding `Transfer` event are `FINALIZED`.
- ULIQ indexer cursor passed the lock block at `302573079`; failure count is
  `0` and the previous constraint error is cleared.
- Automatic reconciliation recovered to `OK`, mismatch count `0`, at finalized
  block `302580224`.
- API container health is `healthy` with restart count `0`; public `/health`
  and `/uliq/presale` both returned HTTP `200`.
- Runtime flags remained unchanged: locking enabled, discounts disabled. No
  onchain action, wallet signature, env change, Web deploy or Runner deploy was
  part of this recovery.

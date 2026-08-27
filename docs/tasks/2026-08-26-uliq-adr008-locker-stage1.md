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

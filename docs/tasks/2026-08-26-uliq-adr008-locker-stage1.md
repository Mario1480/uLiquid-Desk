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

`FINALITY_PENDING`

Do not update `ULIQ_LOCKER_ADDRESS` or enable `ULIQ_LOCKING_ENABLED` /
`ULIQ_DISCOUNTS_ENABLED` until deployment block `302290715` is included by the
Arbitrum Sepolia RPC `finalized` tag and the separately approved runtime switch
preflight passes.

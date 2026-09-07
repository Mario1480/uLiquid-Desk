# ULIQ Mainnet locker, native USDC and owner decision follow-up

Date: 2026-09-07. Local implementation and review preparation only. No commit, push, deployment, broadcast, funding, live environment change, migration or runtime activation.

## User decisions and scope

Mario approved listing with manual exceptional handling and Safe-based treasury custody. The previously open project policy questions are recorded as owner-approved in ADR-001; no external legal opinion is claimed. Team/manual vesting is deferred. He requested a Mainnet locker adaptation, native USDC inputs and a concrete inventory of contract rights/parameters for his subsequent item-3 approval.

The [contract approval document](../../../packages/contracts/ULIQ_MAINNET_CONTRACT_APPROVAL.md) records those decisions, exact proposed Safe addresses, constructor economics, existing ownership renunciation and treasury-rotation powers, and still-missing UTC sale dates. Pending USDC is held by the custody contracts; only finalized payments reach the treasury Safe. Manual compensation cannot revoke existing vesting rights.

## Changes

- Added `ULIQMainnetLocker`: no constructor arguments, chain 42161 only, immutable existing ULIQ token, code/decimal validation. It inherits the previously reviewed network-neutral locker logic without changing it.
- Added the isolated Mainnet locker deployment script. It was compiled, not broadcast.
- Added four deterministic adapter tests for wrong chain, missing code, wrong decimals and position ownership/maturity/extension/one-time principal return.
- Entered native Arbitrum USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` in both public-presale environment templates. It is also the prepared payment-token input for both rounds and both custody instances. Legacy Sepolia values and feature flags are unchanged.
- Upgraded the two local deployed-token fork scenarios from mock USDC/legacy locker to the actual native USDC proxy and Mainnet locker adapter. They now assert native-USDC withdrawal, exact treasury credit and zero residual purchase liability as well as full vesting and lock/unlock.
- Updated active review/scope/role documents and the internal index. Original sealed scan artifacts and earlier dated evidence remain unchanged.

## Validation

| Check | Result |
| --- | --- |
| New Mainnet locker unit tests | 4 passed |
| Full `npm -w packages/contracts run test:uliq` | 98 passed, 0 failed, 3 optional fork tests skipped; 101 total across 12 suites |
| Explicit native-USDC/ULIQ fork scenarios | 2 passed |
| `npm -w packages/contracts run build` | Passed; existing Forge lint warnings remain |
| Scoped Forge formatting and `git diff --check` | Passed |

Successful fork: Arbitrum One block `502661705`, observed through RPC `finalized`; block hash `0x350704dc974a48680f70bf35fe38137f20f28ca74a746125ca0cf43a84497f74`. Endpoint: `https://arb1.arbitrum.io/rpc`.

Reproduce from `packages/contracts`:

```bash
forge test --match-contract ULIQDeployedTokenForkAuditTest \
  --fork-url https://arb1.arbitrum.io/rpc \
  --fork-block-number 502661705 -vv
```

The fork impersonates the ULIQ Treasury Safe for fixture funding and the USDC master minter to authorize a local test minter for 500 USDC. All issuer-role changes, minting, candidate deployments and movements exist only inside the local fork. This tests actual token transfer behavior, not control of issuer/Safe keys or a live deployment. No native USDC was purchased or moved on Mainnet.

Earlier attempts at historical block 502625136 failed before execution: the official RPC reported missing USDC account metadata; PublicNode required an archive access token. A newly observed finalized block resolved the official RPC failure; the two scenarios then passed. A Python HTTP probe hit a local certificate-store error; the supported Cast RPC query succeeded. No access token was acquired or certificate verification disabled.

The repository post-edit hook again reported missing `/hooks/validate-schema.py`; file/diff inspection and the successful compilation/tests independently verified the applied edits.

## Remaining technical work

Mario's exact item-3 contract-input/authority approval, full Mainnet graph deployment/configuration preparation, Safe state and execution verification, independent external audit, and application/indexer acceptance remain outstanding. The existing backend locking namespace still enforces Sepolia: the Mainnet locker must have a separately verified runtime integration before activation. The local Mainnet adapter does not switch that runtime.

# ULIQ V3 Stage 0 preflight

Date: 2026-08-24

## Scope and boundary

- Testnet-only review of the V3 unsold-ULIQ release and empty-sale recovery.
- Contract build, deterministic Foundry tests, Arbitrum Sepolia RPC dry-run, and
  an end-to-end deployment/configuration rehearsal on an ephemeral local fork.
- No `--broadcast` was used against Arbitrum Sepolia. No external transaction,
  wallet signature, VPS deployment, environment mutation, migration, V2 state
  change, or production action was performed.

## V3 behavior under test

- `ENDED -> DEX_PENDING` requires `pendingPurchaseCount == 0` and atomically
  releases exactly `allocationCapUliqRaw - finalizedAllocationUliqRaw` to the
  active `paymentCustody.treasury()`.
- Extra ULIQ that does not belong to the presale allocation is not swept.
- A fully sold sale emits the release event with amount zero and makes no token
  transfer.
- An empty sale can be cancelled from `READY`, `ACTIVE`, or `PAUSED`. This
  closes the Stage-0 recovery gap where a funded `READY` instance could have
  stranded its inventory if activation never occurred.
- The release and cancellation paths are owner-controlled and non-reentrant.

## Toolchain and deterministic evidence

- Solidity compiler: `0.8.30`.
- Optimizer: enabled, 200 runs, `via_ir = true`, EVM target `paris`.
- Foundry: `1.5.1-stable`, commit
  `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`.
- `npm run contracts:build`: passed.
- `npm run contracts:test`: 48/48 tests passed, zero failures and zero skips.
- The ULIQ suite contains 19 focused tests, including active and `READY`
  empty-sale cancellation, rotated-treasury release, pending-purchase blocking,
  extra-inventory isolation, full-cap zero release, fixed supply, refund, and
  permissionless finalization.
- Two ULIQ fuzz tests passed with 256 runs each.
- Five ULIQ invariants passed with 256 runs and 128,000 calls each: custody
  accounting, pending-inventory coverage, pending-count accounting, no presale
  minting, and sale-cap enforcement.
- `npm -w apps/api run test:uliq`: 42/42 tests passed, including finalized
  indexing of `UnsoldUliqReleased` as an ordinary treasury holding.
- `ULIQPresale` runtime bytecode was 8,572 bytes, leaving 16,004 bytes below
  the EIP-170 limit. All other ULIQ runtime contracts were also below the
  limit.

Foundry printed existing lint/style notes and its existing invariant-selector
discovery warnings. The repository-wide size command also reports unrelated
oversized contracts outside the ULIQ scope. Slither was not installed, so this
Stage-0 result does not include an independent static-analysis run. Neither the
ULIQ build nor a test failed.

## Arbitrum Sepolia dry-run

- Child chain: Arbitrum Sepolia `421614`; parent chain: Sepolia.
- Public RPC was used only for reads and simulation.
- Simulated finalized-head availability and the exact chain ID were checked
  before the dry-run.
- Admin/deployer input:
  `0x4165Df9092aD2adffFE6A63ad10863F696cac125`.
- Treasury input:
  `0x4165Df9092aD2adffFE6A63ad10863F696cac125`.
- Reused tUSDC input:
  `0xA59C569041Ec4c735776FA8D0f46D19c2ef87220`.
- Withdrawal period: 3,600 seconds.
- Sale start/end inputs were provisional simulation timestamps only and must be
  selected again immediately before an approved deployment.
- `DeployULIQTestnet` completed without `--broadcast` at simulated Arbitrum
  Sepolia block `301540716`.
- Estimated deployment gas: `6,507,211`.
- Estimated amount at the observed gas price:
  `0.000260887109919211 ETH`.

The dry-run predicted the following addresses from the deployer's observed
nonce. They are not deployment records and can change after any intervening
deployer transaction:

- Token: `0xAe4f9400248775A5FaDbE201Bf4CA0649e8910c6`
- Presale: `0x3cbe59783Cd9Cd831a4828902Fcd1aeB218BeF7C`
- Vesting: `0x6A5BdE5935a52676DA471Fadc1e5A09bb465f213`
- Locker: `0xa14f886D0D40Fb5B1C19626F0c7e6bca4EB0C951`
- Payment custody: `0xb87626A75508c80263fb80A9C6d9c8718EC26ba4`

## Local-fork deployment rehearsal

- A fresh ephemeral fork of Arbitrum Sepolia block `301540746` ran locally with
  chain ID `31337`, which is explicitly allowed by the testnet scripts.
- The deploy script created all five new V3 contracts while reusing the current
  tUSDC contract from the fork.
- The configuration script set the Presale address on Vesting and Custody,
  transferred exactly 120,000,000 ULIQ to Presale, and reached `READY`.
- Presale, Vesting, and Custody owner were the intended admin input.
- Vesting and Custody both referenced the predicted Presale address.
- Custody referenced the expected treasury and tUSDC addresses.
- The new `READY -> CANCELLED` recovery path returned exactly 120,000,000 ULIQ
  to the active treasury, left Presale inventory at zero, and preserved total
  supply at 1,000,000,000 ULIQ.
- The local fork was terminated after verification.

## Stage 1 stop conditions

Stage 0 does not authorize a deployment. Before a separately approved Stage 1:

- select fresh sale start/end timestamps and repeat the no-broadcast dry-run;
- recheck deployer balance, nonce, chain ID, RPC health, admin, treasury, and
  tUSDC inputs;
- decide and document V2 containment, because the current V2 deployment and its
  token/history do not migrate into V3;
- record actual receipts and contract addresses, verify source/bytecode and
  ownership/wiring, then wait for the required canonical and `finalized` state;
- keep Stage 2 configuration/funding, staging address switch, and Stage 3
  activation under separate approvals.

Passing Stage 0 is testnet deployment readiness evidence only. It is not an
independent audit, a production safeguarding decision, or legal clearance.

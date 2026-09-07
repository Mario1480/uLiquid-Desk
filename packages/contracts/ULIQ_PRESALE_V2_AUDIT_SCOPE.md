# ULIQ Presale V2 Audit Scope

Status: developer-review package; not audited, not Mainnet-ready, and not authorized for deployment.

This document defines the source set to hand to external reviewers for the current two-round ULIQ presale. Reviewers should receive a pinned commit or tag together with the compiler configuration and dependency lockfile. A working-tree snapshot is not a reproducible audit target.

Candidate Arbitrum One role addresses and read-only verification evidence are recorded in [`ULIQ_PRESALE_V2_MAINNET_ROLES.md`](./ULIQ_PRESALE_V2_MAINNET_ROLES.md). The dated owner decision in ADR-001 closes the previously raised policy approval items; exact contract inputs, independent audit and deployment preparation remain separate. See [Mario's contract review](./ULIQ_MAINNET_CONTRACT_APPROVAL.md).

The [2026-09-05 token deployment audit](./ULIQ_TOKEN_DEPLOYMENT_AUDIT.md) adds token-only agent-review evidence and tests under `test/uliq/shared/`. It does not replace this package's independent audit or cover the other deployable contracts below.

The [2026-09-07 presale, vesting and locking review](./ULIQ_PRESALE_VESTING_LOCKING_REVIEW.md) records the original expired-READY lifecycle deadlock, its subsequent local correction, additional real-custody tests, and local fork integration with the existing Mainnet ULIQ token. The correction is not deployed. A subsequent local Mainnet locker adapter is included below; its deployment/runtime integration and the remaining technical release gates stay open. This internal review does not replace the external audit.

## Existing Mainnet ULIQ token

Use the existing Arbitrum One (`42161`) ULIQ token, `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd`, as the `uliq_` input of both rounds and `token_` input of both vesting pools. The same token is the intended input for a future separately approved Mainnet locker. Do not deploy a replacement token as part of the presale graph. The token address was rechecked read-only at finalized block `502625136`; creation and source-verification evidence remain in the [2026-09-05 record](../../docs/archive/tasks/2026-09-05-uliq-arbiscan-source-verification.md).

`ULIQ_PUBLIC_PRESALE_TOKEN_ADDRESS` in both environment examples now identifies that token. The separate `ULIQ_TOKEN_ADDRESS` belongs to the Sepolia-only legacy runtime and must retain its own network-specific value. Recording this address does not configure already-deployed immutable contracts or enable purchases.

## In-scope deployable contracts

| File | Planned instances | Purpose |
| --- | ---: | --- |
| `src/uliq/shared/ULIQToken.sol` | 1 existing | Fixed-supply ERC-20 with burn and permit support. Review the existing Mainnet token and its compatibility; no replacement mint is part of this graph. |
| `src/uliq/presale-v2/ULIQGlobalListing.sol` | 1 | Stores the one-time listing timestamp shared by both rounds. |
| `src/uliq/presale-v2/ULIQPresaleRound.sol` | 2 | Generic non-upgradeable sale state machine, deployed once for each round. |
| `src/uliq/presale-v2/ULIQPresaleRoundVesting.sol` | 2 | Separate funded vesting pool for each round. |
| `src/uliq/presale-v2/ULIQPaymentCustody.sol` | 2 | Purchase-bound USDC custody; pending funds stay here, finalized funds go to the selected Safe treasury. Owner policy approval recorded. |
| `src/uliq/mainnet/ULIQMainnetLocker.sol` | 1 planned | Pins chain 42161 and the existing ULIQ token. Include inherited `src/uliq/legacy-testnet/ULIQLocker.sol` in the production dependency scope. |

## In-scope interfaces

- `src/uliq/shared/interfaces/IULIQPaymentCustody.sol`
- `src/uliq/presale-v2/interfaces/IULIQGlobalListing.sol`
- `src/uliq/presale-v2/interfaces/IULIQPresaleRoundLifecycle.sol`

The payment-custody interface and `ULIQPaymentCustody` candidate are both in scope. Inclusion is engineering and audit preparation only; it does not establish that onchain self-custody satisfies the required safeguarding model.

## Review configuration

- Solidity: `0.8.30`
- EVM target: `paris`
- Optimizer: enabled, 200 runs
- IR pipeline: enabled
- OpenZeppelin Contracts: exact `5.4.0`
- Upgradeability: none
- ULIQ supply: 1,000,000,000 tokens, minted once to the constructor-supplied allocation controller
- Payment token: native Arbitrum USDC, `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, 6 decimals. Entered in both environment examples and both rounds/custodies' prepared inputs.

| Parameter | Round 1 | Round 2 |
| --- | ---: | ---: |
| ULIQ allocation | 50,000,000 | 100,000,000 |
| Price | 0.002 USDC | 0.0035 USDC |
| Hard cap | 100,000 USDC | 350,000 USDC |
| Buyer minimum | 500 USDC | 100 USDC |
| Buyer cumulative maximum | 10,000 USDC | 5,000 USDC |
| Initial unlock at shared listing | 5% | 25% |
| Cliff | 90 days | none |
| Linear vesting after cliff | 548 days | 274 days |

Round start and end timestamps are owner-configurable only while a round is in `DRAFT` and become frozen at `markReady()`, which rejects an already-expired window. If activation is missed, an expired `READY` round can be ended through permissionless `endSale()` without reopening its dates or bypassing pending-purchase/listing controls. `saleWindowVersion` provides compare-and-set protection so an old Safe proposal cannot overwrite a newer executed window. The prepared withdrawal period is 1,209,600 seconds, recorded for Mario's final parameter review. The generic constructor accepts a positive duration; it does not hard-code 14 days.

## Deployment graph and trust boundaries

1. Reverify the existing Mainnet ULIQ token above and use it throughout the graph; deploy the shared listing controller only under separate authorization.
2. Deploy one vesting contract per round, both pointing to the shared listing controller.
3. Deploy one separately scoped production custody instance per round. A shared custody deployment would require explicit round-aware purchase-ID namespacing and a separate design review.
4. Deploy Round 1 without a predecessor and Round 2 with Round 1 as its predecessor.
5. Freeze an immutable inventory-source Safe in each round constructor. The same Safe may be used for both rounds, but the value is independently stored and verified per round.
6. Bind both rounds in `ULIQGlobalListing`, bind each vesting contract and custody implementation to its round, approve each exact round allocation from its inventory source, call `fundInventory()`, configure the windows, and mark each round ready.

The owner can configure sale windows before readiness, activate, pause, resume, mark listing-pending, complete each sale, release unsold inventory to its immutable source, bind the round addresses, and schedule the shared listing timestamp. Ownership is therefore a critical trust boundary and is expected to be held by independently verified Safe addresses. Buyers can withdraw only their pending purchases during the withdrawal window. Any caller can finalize an expired pending purchase, end an economically exhausted or elapsed round, and acknowledge a reached listing timestamp.

Only the immutable inventory source can call `fundInventory()`, and it can do so only once while the round is in `DRAFT`. Direct token donations do not satisfy the funding gate. `releaseUnsold()` accepts no recipient or amount; it is available only after an ended state with no pending purchases and returns the exact unsold allocation once to the same immutable source. Unexpected direct ULIQ donations are not included in that amount and remain isolated.

The listing contract records a timestamp; it does not create DEX liquidity, verify a DEX pool, execute a listing transaction, or validate a market price. Those operations and their evidence are external to this source set.

## Security invariants expected from the audit

- Presale operations cannot mint ULIQ or exceed the fixed token supply.
- Raised USDC, sold ULIQ, per-wallet purchases, and round allocation never exceed their configured caps.
- Pending allocation is always backed by round inventory.
- Readiness requires the exact allocation to have been pulled once from the immutable inventory source.
- A purchase can be withdrawn or finalized, never both, and payment custody settles it at most once.
- Direct USDC transfers are isolated as surplus and cannot be released through a purchase settlement; accounted payment liabilities remain fully backed.
- No buyer can claim ULIQ before the shared listing timestamp.
- Both rounds must be listing-ready with no pending purchases before the listing timestamp can be scheduled.
- Round 2 cannot activate before Round 1 reaches an ended state.
- A never-activated `READY` round can end at or after expiry; its inventory can return once to its source, and missed activation cannot permanently prevent successor activation or shared vesting. No `READY` round can end before expiry.
- Each vesting pool remains independently funded and follows only its configured release schedule.
- Reentrancy or a failing token/custody transfer cannot leave partial purchase, refund, finalization, or claim state.
- Deployment wiring cannot substitute malicious round, vesting, listing, token, predecessor, or custody addresses.
- Unsold inventory cannot be released before the round ends, while purchases remain pending, more than once, or to any caller-selected recipient.

## Test evidence supplied to reviewers

- `test/uliq/presale-v2/ULIQPresaleRounds.t.sol`
- `test/uliq/presale-v2/ULIQPresaleRounds.invariant.t.sol`
- `test/uliq/presale-v2/ULIQPaymentCustody.t.sol`

The files under `test/uliq/presale-v2/fixtures/` are test doubles only. They are not deployable production components and are excluded from the production audit target. Passing tests are engineering evidence, not an independent audit result.

## Explicitly excluded legacy contracts

The following previous Arbitrum Sepolia MVP contracts are isolated under `src/uliq/legacy-testnet/` and are not part of the Presale V2 audit:

- `ULIQPresale.sol`
- `ULIQPresaleVesting.sol`
- `ULIQTestnetEscrow.sol`
- `ULIQMockUSDC.sol`

Their tests are under `test/uliq/legacy-testnet/`, and their deployment/configuration scripts are under `script/uliq/legacy-testnet/`. The scripts allow only local chain `31337` and Arbitrum Sepolia `421614`; they are not Mainnet scripts.

Exception: `ULIQLocker.sol` is now in scope as the inherited logic of `ULIQMainnetLocker`. The separate Mainnet deployment script is `script/uliq/mainnet/DeployULIQMainnetLocker.s.sol`; legacy testnet deployment scripts remain unchanged.

## Open blockers before an audit freeze or Mainnet deployment

- Record the superseding ADR-001 owner approval; do not reopen the accepted listing/manual-exception/Safe policy as an unanswered question.
- Complete Mario's requested review of withdrawal duration, sale timestamps, exact Safe recipients, thresholds, ownership-transfer sequence and existing contract powers. Native USDC has been selected.
- Freeze and independently verify each immutable inventory-source Safe, its owner set and threshold, then reconcile approval, funding, return receipts, events, balances, and finalized state through the admin workflow.
- Decide whether eligibility/KYC/allowlisting is enforced off-chain or on-chain; the current contracts contain no buyer allowlist.
- Define and review the DEX liquidity/listing procedure; the current listing controller is time-based only.
- Add a chain-guarded, reproducible Mainnet deployment and configuration script plus bytecode/address reconciliation checks.
- Audit deployment graph validation, privileged roles, event/indexer compatibility, failure recovery, and reconciliation with the final custody implementation.
- Obtain an independent security audit and resolve findings before describing the package as production-ready.

# ULIQ Presale V2 Audit Scope

Status: developer-review package; not audited, not Mainnet-ready, and not authorized for deployment.

This document defines the source set to hand to external reviewers for the current two-round ULIQ presale. Reviewers should receive a pinned commit or tag together with the compiler configuration and dependency lockfile. A working-tree snapshot is not a reproducible audit target.

## In-scope deployable contracts

| File | Planned instances | Purpose |
| --- | ---: | --- |
| `src/uliq/shared/ULIQToken.sol` | 1 | Fixed-supply ERC-20 with burn and permit support. Include it if this bytecode will be the Mainnet ULIQ token. |
| `src/uliq/presale-v2/ULIQGlobalListing.sol` | 1 | Stores the one-time listing timestamp shared by both rounds. |
| `src/uliq/presale-v2/ULIQPresaleRound.sol` | 2 | Generic non-upgradeable sale state machine, deployed once for each round. |
| `src/uliq/presale-v2/ULIQPresaleRoundVesting.sol` | 2 | Separate funded vesting pool for each round. |
| `src/uliq/presale-v2/ULIQPaymentCustody.sol` | 2 | Non-upgradeable, purchase-bound USDC custody candidate, deployed once per round. Legal approval is still required. |

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
- Payment token assumption: an ERC-20 with 6 decimals; the intended canonical Mainnet token address must be frozen separately

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

Round start and end timestamps are owner-configurable only while a round is in `DRAFT` and become frozen at `markReady()`. `saleWindowVersion` provides compare-and-set protection so an old Safe proposal cannot overwrite a newer executed window. The production withdrawal period is a constructor parameter and must be frozen to exactly 1,209,600 seconds only after Legal confirms the calendar-day and subscription-period interpretation.

## Deployment graph and trust boundaries

1. Deploy the token and the shared listing controller.
2. Deploy one vesting contract per round, both pointing to the shared listing controller.
3. Deploy one separately scoped production custody instance per round. A shared custody deployment would require explicit round-aware purchase-ID namespacing and a separate design review.
4. Deploy Round 1 without a predecessor and Round 2 with Round 1 as its predecessor.
5. Bind both rounds in `ULIQGlobalListing`, bind each vesting contract and custody implementation to its round, fund the exact inventories, configure the windows, and mark each round ready.

The owner can configure sale windows before readiness, activate, pause, resume, mark listing-pending, complete each sale, bind the round addresses, and schedule the shared listing timestamp. Ownership is therefore a critical trust boundary and is expected to be held by independently verified Safe addresses. Buyers can withdraw only their pending purchases during the withdrawal window. Any caller can finalize an expired pending purchase, end an economically exhausted or elapsed round, and acknowledge a reached listing timestamp.

The listing contract records a timestamp; it does not create DEX liquidity, verify a DEX pool, execute a listing transaction, or validate a market price. Those operations and their evidence are external to this source set.

## Security invariants expected from the audit

- Presale operations cannot mint ULIQ or exceed the fixed token supply.
- Raised USDC, sold ULIQ, per-wallet purchases, and round allocation never exceed their configured caps.
- Pending allocation is always backed by round inventory.
- A purchase can be withdrawn or finalized, never both, and payment custody settles it at most once.
- Direct USDC transfers are isolated as surplus and cannot be released through a purchase settlement; accounted payment liabilities remain fully backed.
- No buyer can claim ULIQ before the shared listing timestamp.
- Both rounds must be listing-ready with no pending purchases before the listing timestamp can be scheduled.
- Round 2 cannot activate before Round 1 reaches an ended state.
- Each vesting pool remains independently funded and follows only its configured release schedule.
- Reentrancy or a failing token/custody transfer cannot leave partial purchase, refund, finalization, or claim state.
- Deployment wiring cannot substitute malicious round, vesting, listing, token, predecessor, or custody addresses.

## Test evidence supplied to reviewers

- `test/uliq/presale-v2/ULIQPresaleRounds.t.sol`
- `test/uliq/presale-v2/ULIQPresaleRounds.invariant.t.sol`
- `test/uliq/presale-v2/ULIQPaymentCustody.t.sol`

The files under `test/uliq/presale-v2/fixtures/` are test doubles only. They are not deployable production components and are excluded from the production audit target. Passing tests are engineering evidence, not an independent audit result.

## Explicitly excluded legacy contracts

The following previous Arbitrum Sepolia MVP contracts are isolated under `src/uliq/legacy-testnet/` and are not part of the Presale V2 audit:

- `ULIQPresale.sol`
- `ULIQPresaleVesting.sol`
- `ULIQLocker.sol`
- `ULIQTestnetEscrow.sol`
- `ULIQMockUSDC.sol`

Their tests are under `test/uliq/legacy-testnet/`, and their deployment/configuration scripts are under `script/uliq/legacy-testnet/`. The scripts allow only local chain `31337` and Arbitrum Sepolia `421614`; they are not Mainnet scripts.

`ULIQLocker.sol` is excluded because it belongs to the older testnet MVP. A Mainnet locking contract has not yet been selected or implemented and requires a separate scope decision and audit.

## Open blockers before an audit freeze or Mainnet deployment

- Obtain written Legal approval for the proposed onchain custody/safeguarding model. If rejected, freeze and audit must stop pending a replacement design.
- Freeze the withdrawal period, exact calendar interpretation, sale timestamps, canonical USDC address, Safe addresses, thresholds, and ownership-transfer sequence.
- Resolve ADR-001 decisions for legal access, safeguarding, cancellation, and refunds.
- Decide and implement the unsold-token recovery policy; Presale V2 currently leaves unsold ULIQ in each round.
- Decide whether eligibility/KYC/allowlisting is enforced off-chain or on-chain; the current contracts contain no buyer allowlist.
- Define and review the DEX liquidity/listing procedure; the current listing controller is time-based only.
- Add a chain-guarded, reproducible Mainnet deployment and configuration script plus bytecode/address reconciliation checks.
- Audit deployment graph validation, privileged roles, event/indexer compatibility, failure recovery, and reconciliation with the final custody implementation.
- Obtain an independent security audit and resolve findings before describing the package as production-ready.

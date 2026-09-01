# ADR-009 - Two-Round Presale and Revised Token Allocation

## Status

`ACCEPTED PARAMETERS / CONTRACT REVIEW DRAFT`

Production use remains `NO-GO` while ADR-001 is blocked. This ADR accepts the economic and lifecycle parameters below; it does not approve Mainnet deployment, production custody, legal access controls, Safe addresses, or audit completion.

## Context

The prior single-round presale model allocated 120,000,000 ULIQ at one price with one 25/75 release schedule. The accepted tokenomics workbook replaces that model with two isolated Desk rounds and a revised fixed-supply allocation.

The first round may be exposed through a dedicated public landing page without a Desk account. This does not remove wallet authentication, versioned terms acceptance, jurisdiction checks, or any onchain access control later required by ADR-001.

## Decision

### Fixed supply allocation

| Bucket | Share | ULIQ |
| --- | ---: | ---: |
| Presale Round 1 | 5% | 50,000,000 |
| Presale Round 2 | 10% | 100,000,000 |
| Liquidity | 8% | 80,000,000 |
| Ecosystem | 19% | 190,000,000 |
| Treasury | 30% | 300,000,000 |
| Team | 15% | 150,000,000 |
| Marketing & Partnerships | 13% | 130,000,000 |
| **Total** | **100%** | **1,000,000,000** |

ADR-009 supersedes the prior 12% Presale and 22% Ecosystem allocation in ADR-002. All other bucket totals remain unchanged.

### Round parameters

| Parameter | Round 1 | Round 2 |
| --- | ---: | ---: |
| Allocation | 50,000,000 ULIQ | 100,000,000 ULIQ |
| Fixed price | 0.002 USDC / ULIQ | 0.0035 USDC / ULIQ |
| Hard cap | 100,000 USDC | 350,000 USDC |
| Minimum accepted purchase | 500 USDC | 100 USDC |
| Maximum net purchase per wallet | 10,000 USDC | 5,000 USDC |
| Initial unlock | 5% at global listing | 25% at global listing |
| Cliff | 3 months | None |
| Linear vesting | 18 months after cliff | 9 months from listing |
| Predecessor | None | Round 1 must have ended |

The minimum applies to each accepted purchase. The maximum is cumulative per wallet and round. A valid withdrawal restores that wallet's available capacity. A hard-cap or allocation remainder below the round minimum is not partially accepted.

### Deployment and isolation model

- Deploy two non-upgradeable instances of the same `ULIQPresaleRound` bytecode.
- Each round has its own inventory, accounting, custody adapter, vesting pool, purchase identifiers, cap, and lifecycle state.
- Each round freezes an immutable inventory-source address in its constructor. Both rounds may use the same source, but each stores and verifies it independently.
- Price, cap, allocation, buyer limits, release share, cliff, duration, and predecessor are immutable deployment parameters.
- `saleStart` and `saleEnd` are configurable by the owner only while the round is `DRAFT`; `markReady()` freezes them.
- Round 2 cannot activate until Round 1 reports an ended-or-later lifecycle state.
- No round may access the other round's token inventory or payment accounting.

### Shared listing and release

- One `ULIQGlobalListing` controller stores the listing timestamp exactly once.
- The controller can schedule listing only when both rounds are `LISTING_PENDING` and both have `pendingPurchaseCount == 0`.
- Finalization transfers the entire finalized allocation to that round's vesting pool; no ULIQ reaches the buyer wallet before the global listing timestamp.
- At listing, Round 1 makes 5% claimable and Round 2 makes 25% claimable.
- Round 1 keeps the remaining 95% behind a three-month cliff, then releases it linearly over 18 months.
- Round 2 releases the remaining 75% linearly over nine months from listing.
- Claims are pull-based, beneficiary-bound, and do not change total eligible ULIQ when the application reconciles wallet plus unreleased vesting correctly.

### Admin scheduling boundary

- The admin API stores the desired `saleStart` and `saleEnd` for both rounds as a versioned, reauthenticated, audited backend draft.
- Allocation, price, hard cap, buyer limits, unlock share, cliff, duration, and predecessor remain read-only values sourced from this ADR.
- The backend draft does not configure a contract, mark a round ready, activate a sale, sign, or broadcast a transaction.
- Onchain preparation and reconciliation remain disabled until both reviewed Mainnet round addresses and the production role model are configured.

### Unsold inventory

The immutable inventory source approves its round and calls `fundInventory()` once while the round is in `DRAFT`; the round pulls its exact allocation. A direct token transfer does not satisfy the readiness gate. After the round has ended and no purchases remain pending, the owner may call parameterless `releaseUnsold()` once. The contract computes the exact unsold allocation and returns it only to the same immutable source. The owner cannot select a different recipient or amount, and the return is not automatic.

## Onchain boundary

The review draft enforces price, cap, allocation, time window, per-wallet limits, predecessor ordering, pending/finalized/withdrawn exclusivity, shared-listing readiness, and vesting arithmetic.

It intentionally does not enforce Desk registration. Wallet authentication, terms evidence, jurisdiction decisions, sanctions screening, and any legally required allowlist or attestation remain outside the current contract until ADR-001 resolves the required model. A UI-only gate is not a security boundary.

## Trust assumptions and privileged operations

- The round owner can configure dates only in `DRAFT`, mark ready, activate, pause, unpause, mark listing pending, return unsold inventory to the immutable source, and complete the lifecycle.
- Only the immutable inventory source can fund the round allocation.
- The listing owner can bind the two round addresses once and schedule the global listing once.
- The vesting owner can bind its presale address once before listing.
- The custody adapter controls collection, refund, and treasury release semantics. `ULIQTestnetEscrow` remains test-only and must not be used as the production safeguarding decision.
- Production role holders are expected to be separately approved Safe or governance addresses; exact addresses and thresholds are not accepted by this ADR.

## Working time conversion

The implementation accepts cliff and vesting durations in seconds. Focused review tests currently use 90 days for the Round 1 cliff, 548 days for its 18-month linear period, and 274 days for Round 2's nine-month period. The legal/product month-to-second convention must be confirmed and frozen before deployment.

## Security implications

- Purchase finalization is permissionless, but the immutable buyer remains the only beneficiary.
- Withdrawal and finalization are mutually exclusive state transitions.
- Checks-effects-interactions, `SafeERC20`, and reentrancy guards protect value-moving paths.
- Both rounds must be free of pending purchases before listing can be scheduled.
- The listing controller, round owners, vesting binding, custody adapters, and deployment wiring are high-impact audit scope.
- Passing unit, fuzz, and invariant tests is not an independent audit.

## Open production gates

1. ADR-001 legal classification, terms, withdrawal, cancellation, jurisdiction, and access-control decisions.
2. Production USDC safeguarding and treasury-release adapter.
3. Exact cancellation behavior for pending and finalized purchases.
4. Independently verified inventory-source Safe addresses, thresholds, approval/funding sequence, and finalized return reconciliation.
5. Exact month-to-second convention.
6. Canonical Arbitrum One USDC, chain configuration, Safe addresses, signer thresholds, and role matrix.
7. Static analysis, independent audit, findings remediation, deployment simulation, and source verification.
8. Backend, indexer, ABI, UI, and reconciliation migration from the current single-round testnet runtime.

## Acceptance criteria

- Two instances use identical implementation bytecode and isolated state.
- The two allocations sum to exactly 150,000,000 ULIQ and all token buckets sum to 1,000,000,000 ULIQ.
- Full sell-through produces exactly 100,000 USDC in Round 1 and 350,000 USDC in Round 2.
- Round-specific minimums and cumulative wallet maximums are enforced onchain.
- A withdrawal restores cap and wallet capacity exactly once.
- Finalization releases zero ULIQ to the buyer before listing.
- Both rounds use the same immutable listing timestamp.
- Round 1 and Round 2 follow their independent accepted release schedules without cross-round accounting.
- Listing scheduling reverts while either round has pending purchases or is not listing-ready.
- Unsold inventory is not moved automatically and can be returned only once to the immutable source after the round ends with no pending purchases.
- No Mainnet deployment script or broadcast is added while the production gates remain open.

## 2026-09-01 public access amendment

Both accepted rounds may be exposed through public Desk-hosted routes without requiring Desk registration. The implementation reuses the Desk wallet stack, but uses a separate 24-hour SIWE session and versioned Presale Terms acknowledgement. Only the active onchain round may be purchased.

The approved product scope does not add KYC, jurisdiction, allowlist, or contract-level attestation controls. This does not resolve ADR-001: Legal must explicitly approve the direct-call access model and publish the versioned Presale Terms before production purchases can be enabled. Until then, public preview may be configured separately while purchases remain fail-closed.

The implementation and remaining gates are recorded in [Public Two-Round Presale Access](12_PUBLIC_PRESALE_ACCESS.md).

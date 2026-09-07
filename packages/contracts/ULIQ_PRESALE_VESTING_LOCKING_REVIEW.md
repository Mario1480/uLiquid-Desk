# ULIQ Presale, Vesting and Locking Review
## Owner approval of items 1–3 — 2026-09-07

Mario explicitly approved the presented Safe addresses, parameters and admin rights, sale timing, and final contract wiring/deployment configuration ("alles richtig und gebe es hiermit frei"). This closes the requested owner review; do not request the same approval again. The approved Admin Safe is `0xf6EB22eC94be977A668967f44F89eB1e056FF70f`; the approved inventory source and USDC treasury Safe is `0x9C96F9AE59e30786fD325EFD969884FC1f751739`. Existing contract rights are approved as presented; disabling ownership renunciation was a recommendation and is not silently implemented by this record.

Approval and supplied execution inputs are separate: the reviewed timing table still contains no actual start/end dates for either round, and no final deployed-address manifest is present. Mario's message supplies no timestamps or new deployment addresses. Record those missing values before execution; never invent them or describe an unperformed onchain verification as completed. Requesting the four missing dates is a data clarification, not a repeat approval request. Independent audit and runtime/deployment evidence remain separate. No transaction was performed when recording this approval.


Date: 2026-09-07. Status: **internal engineering audit and local R-01 remediation completed; owner policy approval recorded; final contract inputs, independent audit and deployment preparation remain open**.

Subsequent owner instruction: Mario approved listing with manual exception handling and Safe-based treasury custody, requested Mainnet locker adaptation and native USDC inputs, deferred Team/manual vesting, and requested a contract-powers review before approving item 3. The current [contract input and authority review](./ULIQ_MAINNET_CONTRACT_APPROVAL.md) supersedes the earlier open policy/scope items. Sealed audit artifacts retain their historical source snapshot.

Originally reviewed contract revision: `f51e0c1309c0bdbdf36c5938e345d586bf325efb`, branch `codex/einui-desk-integration`. The worktree was clean at audit intake. The initial audit did not change contract implementations. Mario subsequently authorized the R-01 fix described below; the contract, tests and documentation now include that local, uncommitted remediation. This is agent-assisted source review with separate baseline and architecture passes, not an independent external audit or a deployment approval.

## Decision

The ordinary purchase, custody, vesting and legacy locking paths have coherent ownership and accounting controls, and the exercised tests pass. No unprivileged theft, duplicate settlement, early claim, or early unlock path was confirmed for the intended ULIQ token.

**The reproduced medium-severity R-01 defect is fixed locally:** an expired round left in `READY` can now terminate through `endSale()`. Recovery tests verify inventory return, successor activation, shared listing and actual beneficiary payouts. Existing deployed non-upgradeable contracts would not receive this source change automatically; no deployment was performed.

The subsequent local Mainnet locker adapter is now implemented; its deployment and runtime integration remain open. Team/manual vesting is deferred by Mario. Cancellation/manual handling and Safe-based treasury custody have owner approval; final deployment wiring and independent audit remain open. A zero count of adversarial findings in the accompanying original-revision Codex Security output must not be interpreted as a clean Mainnet approval: that workflow classifies R-01 as an operational issue because no unprivileged attacker forcing missed activation was established. The local fix is recorded separately from that original audit snapshot.

## Scope and evidence boundaries

| Component | Review result |
| --- | --- |
| `src/uliq/presale-v2/ULIQPresaleRound.sol` | Full source review, lifecycle/cap/accounting checks; R-01 corrected and tested locally |
| `ULIQPaymentCustody.sol` | Full source review; purchase-bound collection, refund, release, treasury rotation and surplus isolation |
| `ULIQGlobalListing.sol` | Full source review; one-time timestamp and both-round readiness; availability depends on owners and correct wiring |
| `ULIQPresaleRoundVesting.sol` | Full source review; funding, initial unlock, cliff, linear release, claim accounting |
| Three shared/V2 interfaces | Reviewed as graph and custody trust boundaries |
| `src/uliq/shared/ULIQToken.sol` | Reviewed compatibility and inherited ERC20/Burnable/Permit semantics; prior token-specific tests rerun |
| `src/uliq/legacy-testnet/ULIQLocker.sol` | Full source review of the available legacy locker; not selection or release of a Mainnet locker |
| ULIQ tests, fixtures and legacy scripts | Supporting evidence; scripts reject Mainnet; new real-custody and deployed-token tests added |
| Team/manual/bucket vesting | No dedicated implementation found in the repository; no safety conclusion for such contracts |

The old single-round testnet presale, vesting and escrow are outside this V2 source audit; their tests ran for regression compatibility. BotVault/FundingVault contracts, API/indexer/UI security, benefit accounting, Safe signer control, DEX liquidity and Legal interpretation were not audited here. Selected runtime configuration and ADRs were inspected only to establish the ULIQ graph and open requirements.

## Original defect R-01: expired READY round has no exit

Original severity: **medium**, high confidence. Current status: **fixed locally, not deployed**. Impact was high; reaching it required missed or unusable owner activation. No ordinary-buyer exploit forcing that condition was demonstrated.

Source anchors in the originally audited `ULIQPresaleRound.sol` at revision `f51e0c1309c0bdbdf36c5938e345d586bf325efb`:

- `configureSaleWindow`, lines 197–205, permits repair only in `DRAFT`.
- `markReady`, lines 225–232, freezes the round without requiring an unexpired window.
- `activateSale`, lines 235–243, rejects timestamps at or after `saleEnd`.
- `endSale`, lines 260–269, accepts only `ACTIVE` or `PAUSED`.
- `releaseUnsold`, lines 295–309, requires an ended-or-later state.

`ULIQGlobalListing.sol:32–54` binds the two rounds permanently and requires both to be listing-ready. `ULIQPresaleRoundVesting.sol:121–123` returns zero vested tokens while the shared timestamp is zero.

Original reproduction: fund and ready both rounds; buy and finalize 500 USDC in Round 1; end Round 1 and mark it listing-pending; let Round 2 reach its end without activation. At the audited revision, Round 2 could no longer activate, end, reschedule or return inventory. Listing could not be scheduled. Its 100,000,000 ULIQ inventory remained trapped, and the buyer's 250,000 finalized Round 1 ULIQ remained unclaimable even though 500 USDC had already reached treasury.

The original `testAuditReproducesExpiredReadyRoundBlockingEarlierVesting` passed by asserting the blocked state using actual candidate custody. It has now been replaced by `testExpiredReadyRoundReturnsInventoryAndUnblocksEarlierVesting`, which requires successful recovery and beneficiary payout. Historical execution remains in the dated audit evidence.

Implemented correction: `endSale()` now accepts `READY`, `ACTIVE` or `PAUSED`. Before `saleEnd`, it still rejects every `READY` round and preserves the existing economic-exhaustion and pending-purchase checks for active/paused rounds. At or after expiry, anyone can move a `READY` round to `ENDED` using the existing event. Only the owner can return the exact unsold inventory to its immutable source and mark the round listing-pending. `READY` cannot contain purchases under the state graph. `markReady()` now rejects an already-expired window, leaving `DRAFT` dates repairable by the owner. No dates are reopened after readiness, no pending purchases are bypassed, and no refund, custody, vesting or listing schedule is changed.

Recovery requires the existing calls; passage of time alone sends no transaction. Both-round readiness, owner availability and pending settlement remain intentional controls. Funded `DRAFT` cancellation, never-listing refunds and feasible deployment windows remain separate policy/preflight items. ABI, enum values, events and storage layout are unchanged.

## Local remediation validation

The expanded regression suite failed on the original source (7 passed, 6 failed) and passed after the fix (13 passed, including two fuzz properties). It verifies the exact expiry boundary and times before/after it, one-time inventory return, blocked reactivation, expired predecessor recovery followed by actual Round 2 claims, actual Round 1 claims after missed Round 2 activation, pending-purchase listing guards, draft rescheduling after rejected stale readiness, and unchanged early-end restrictions.

See the [R-01 remediation evidence](../../docs/archive/tasks/2026-09-07-uliq-ready-expiry-fix.md) for full-suite, local-fork and ABI/storage comparison results. The corrected contract SHA-256 is `aea30febcbb5d0031bb934a2de3e6a3bb853ec81a0cbbe642a118b797f48dd67`.

## Remaining release requirements and trust assumptions

| Priority | Item | Required resolution |
| --- | --- | --- |
| Owner decision recorded | Cancellation and never-listing exits | Mario committed to listing and accepted manual exceptional handling. No automated cancellation is requested. Finalized vesting cannot be revoked by a manual treasury refund; pending USDC remains in custody until withdrawal/finalization. |
| Implemented locally | Mainnet locking | `ULIQMainnetLocker` pins chain 42161 and the existing ULIQ token, reusing reviewed locker logic. Final independent audit, deployment and Mainnet runtime integration remain open. |
| Deferred by owner | Team/manual vesting | Not relevant to the current release scope per Mario. Any future separate pool needs its own implementation and review. |
| Pre-value control | Graph identity | Listing checks distinct code-bearing rounds; vesting checks code presence. Neither proves the complete reciprocal graph. Verify token, chain, round IDs, predecessor, custody/vesting/listing back-references, ownership, exact parameters and bytecode before funding. `markReady` does not check custody's bound presale. |
| Pre-value control | Owner availability | Round/listing/vesting inherit ownership renunciation; custody disables it. Renunciation while an owner action is still required can strand progress. Disable unnecessary renunciation or explicitly constrain it, and rehearse Safe availability/recovery. No new owner-compromise attack is asserted. |
| Pre-value control | USDC behavior | Treasury/custody issuer restrictions or a global payment pause can block settlement. A buyer-only refund rejection does not block post-deadline treasury finalization. The test models transfer failure; it does not audit Circle's proxy/issuer implementation. |
| Scope limit | Invariant coverage | Existing V2 stateful tests exercise one buyer and buy/withdraw with mock custody. Existing locker invariants cover lock/extend. New deterministic tests add lifecycle/exit coverage but do not replace multi-actor stateful finalization/claims/unlock tests. |

Owner scheduling records time only; it does not prove a DEX pool or liquidity exists. Direct contract calls do not enforce backend terms or participant eligibility. The current accepted access amendment adds no KYC/allowlist. The dated owner approval is recorded in ADR-001; no external legal opinion or new access requirement is inferred here.

## Schedule and accounting checks

| Property | Source/test conclusion |
| --- | --- |
| Sale time | Buy accepts `saleStart`, rejects `saleEnd`; draft version prevents stale schedule overwrite |
| Withdrawal | Buyer only; deadline inclusive; finalization starts strictly afterward |
| Round 1 vesting | 5% at listing; remaining 95% starts after 90-day cliff and accrues over 548 days |
| Round 2 vesting | 25% at listing; remaining 75% accrues over 274 days |
| Precision | USDC uses 6 decimals; ULIQ 18; quotes/linear accrual round down; full vesting releases remaining principal |
| Split purchases | Aggregate initial vesting can differ from summed per-purchase initial-unlock event values by at most one smallest ULIQ unit per additional purchase; no additional principal is created |
| Claims | Beneficiary-bound, pull-based, updates released balances before transfer; repeated fully paid claims revert |
| Custody | Stored purchase ID/buyer/amount, one terminal settlement, exact incoming balance delta; surplus cannot fund an extra settlement |
| Failed calls | Uncaught token/custody failure rolls back round, custody, vesting and token state atomically; tested treasury rejection followed by successful retry |
| Pausing | Pausing sale blocks buying, while buyer refunds and matured finalization remain callable |
| Unsold tokens | Exact unsold allocation returns once to immutable source after ending with no pending purchases; donations remain separate |
| Legacy locks | Initial terms are 32/185/367 days; only owner can extend strictly later or withdraw at expiry; no admin confiscation entrypoint |

The month-to-seconds and withdrawal-period interpretations are deployment inputs for Mario's requested parameter review. Generic constructors do not enforce all ADR-009 economic values. Unreleased vesting and matured-but-not-withdrawn locker balances must not be mistaken for currently claimable or still-duration-eligible value by offchain consumers.

## Existing ULIQ address and onchain evidence

Use **`0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd` on Arbitrum One (`42161`)**. Both rounds' `uliq_` and both vesting pools' `token_` must reference this existing token. A future Mainnet locker should use the same verified token. No replacement token deployment is proposed.

Read-only checks on `https://arb1.arbitrum.io/rpc`:

| Evidence | Value |
| --- | --- |
| RPC chain ID | `42161` |
| Observed finalized block | `502625136` |
| Block hash | `0x4e68ecef02d69447fae42253bd938aed362279d3d286c2600a912bca8f25540e` |
| Name / symbol / decimals | `uLiquid Token` / `ULIQ` / `18` |
| Total supply | `1000000000000000000000000000` raw = 1,000,000,000 ULIQ |
| Treasury Safe ULIQ balance at that block | Same full supply, at `0x9C96F9AE59e30786fD325EFD969884FC1f751739` |
| Runtime code hash (Keccak-256) | `0x91e14e66bf769f2f0b89d8a7ef547f5c8c5b68fe43f7063c7f289b2030b46732` |
| Creation receipt | Successful, block `501976598`, contract address matches |
| Creation transaction | `0xf5aa71e7973adf3f5f35ba4f8689f94dc7d0f853f65e80cb2a42dcc671671c7a` |

The [official Arbitrum chain information](https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info) confirms this chain/RPC mapping. [Circle's contract directory](https://developers.circle.com/stablecoins/usdc-contract-addresses) identifies native Arbitrum USDC as `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; its `decimals()` returned `6` at the same block. This identity check does not freeze the production custody design or treasury.

The prior [Arbiscan source-verification record](../../docs/archive/tasks/2026-09-05-uliq-arbiscan-source-verification.md) records an exact match. The browser fetch of Arbiscan was unavailable in this review, so that explorer status is historical evidence, while the RPC reads above are fresh evidence. This run did not independently regenerate the deployed token's full source/bytecode verification package.

The public metadata was already present in `.env.example` and `apps/web/lib/uliqDeployments.ts`; it is now also entered in `.env.prod.example` and the contract handoff/role references. The distinct Sepolia `ULIQ_TOKEN_ADDRESS` remains unchanged. No live environment or immutable deployed contract was updated.

## Original audit validation

Compiler/toolchain: Foundry `1.5.1`, Solidity `0.8.30`, optimizer 200, via IR, Paris, OpenZeppelin `5.4.0`.

| Check | Result |
| --- | --- |
| Baseline `npm -w packages/contracts run test:uliq` | 81 passed, 0 failed, 1 optional fork test skipped |
| New `ULIQAuditRegressionTest` | 7 passed, including the defect reproduction |
| Final `npm -w packages/contracts run test:uliq` | 88 passed, 0 failed, 2 optional fork tests skipped; 90 total |
| Existing-token fork test at block `502625136` | 1 passed; actual deployed ULIQ funds both candidate rounds, finalizes, returns unsold inventory, fully vests and completes lock/unlock |
| `npm -w packages/contracts run build` | Passed; existing repository-wide Forge lint warnings remain |
| `git diff --check` and scoped formatting | Passed |

The current follow-up replaces the mock payment token with native USDC and the legacy locker with the Mainnet adapter. It passed at block `502661705`; see [Mainnet preparation evidence](../../docs/archive/tasks/2026-09-07-uliq-mainnet-preparation.md). Reproduce the current local fork:

```bash
cd packages/contracts
forge test --match-contract ULIQDeployedTokenForkAuditTest \
  --fork-url https://arb1.arbitrum.io/rpc \
  --fork-block-number 502661705 -vv
```

The original audit fork created candidate contracts only in local EVM state, impersonated the Treasury Safe without signatures, and used mock USDC. It proves compatibility with the existing ULIQ token at that block, not actual Mainnet graph deployment, canonical-USDC lifecycle acceptance or control of Safe signers. The existing token-deployment fork test remains independently optional. Slither was not available; no dedicated static-scanner clean result is claimed.

Follow-up order after Mario's policy approval: complete the requested input/authority review and exact Safe recipient/date selection; complete remaining integration and security validation; freeze and independently audit the corrected release revision; then perform authorized deployment and reconciliation. The original audit tables above retain original test counts and fixture assumptions; subsequent Mainnet/native-USDC evidence is recorded separately.

## Review artifacts

The [generated Codex Security report](./audits/2026-09-07-uliq/report.md) preserves the adversarial review classification and explicit partial package coverage. Canonical artifacts: [manifest and threat model](./audits/2026-09-07-uliq/scan-manifest.json), [findings](./audits/2026-09-07-uliq/findings.json), [coverage and operational defect](./audits/2026-09-07-uliq/coverage.json). The full contract package was not audited; the selected ULIQ source scope above was reviewed. Exact scan token usage was unavailable.

See [dated execution evidence](../../docs/archive/tasks/2026-09-07-uliq-presale-vesting-locking-audit.md) for local command results and the release boundary.

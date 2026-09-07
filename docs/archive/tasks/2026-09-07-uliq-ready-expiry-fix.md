# ULIQ R-01 expired READY round remediation

Date: 2026-09-07. Mario authorized fixing the mutually blocking presale lifecycle after the [initial audit](2026-09-07-uliq-presale-vesting-locking-audit.md). Scope: local contract correction, tests and documentation. No commit, push, deployment, broadcast, activation, migration or live environment change.

## Changed behavior

`ULIQPresaleRound.endSale()` now permits `READY -> ENDED` at or after the frozen `saleEnd`. `READY` is never reachable after purchases, so that recovery path has no sold or pending allocation. The caller receives no assets; the existing owner-only `releaseUnsold()` returns the full unsold allocation once to the immutable source. The existing owner can then mark the round listing-pending. `markReady()` rejects an already-expired window, preserving `DRAFT` rescheduling as the repair path.

Before expiry, `READY` still cannot end. Active and paused rounds retain their previous early-end requirements. Pending-purchase gates, vesting/listing timing, ownership, token addresses, economic inputs and source-only inventory return remain unchanged. This does not implement cancellation, discretionary early ending of an unsold round or a never-listing refund.

Original base: `f51e0c1309c0bdbdf36c5938e345d586bf325efb`, branch `codex/einui-desk-integration`. Corrected `packages/contracts/src/uliq/presale-v2/ULIQPresaleRound.sol` SHA-256: `aea30febcbb5d0031bb934a2de3e6a3bb853ec81a0cbbe642a118b797f48dd67`. Existing audit/address worktree changes were preserved.

## Validation

| Check | Result |
| --- | --- |
| Expanded regression suite against original contract | 7 passed, 6 failed, confirming the missing recovery and stale-readiness guard |
| `forge test --match-contract ULIQAuditRegressionTest -vv` after correction | 13 passed, including fuzzed times before/after expiry |
| `npm -w packages/contracts run test:uliq` | 94 passed, 0 failed, 3 optional fork tests skipped; 97 total across 11 suites |
| Local deployed-ULIQ fork at block `502625136` | 2 passed: ordinary lifecycle and missed Round 2 activation followed by full vesting and lock/unlock |
| `npm -w packages/contracts run build` | Passed with existing Forge lint warnings |
| ABI comparison | Identical complete ABI before/after correction |
| Storage comparison | Identical normalized types, labels, slots and offsets before/after correction; compiler AST identifiers excluded |
| Formatting and `git diff --check` | Passed |
| Original Codex Security scan finalization | Completed and sealed; generated manifest, findings, coverage and report copied unchanged into the repository |

The recovered Round 2 case returns 100,000,000 unsold ULIQ to its source and pays the Round 1 buyer the initial 12,500 ULIQ at listing and the remainder of its 250,000 ULIQ allocation over the unchanged schedule. The predecessor case lets an expired unstarted Round 1 return 50,000,000 ULIQ, permits Round 2 activation and verifies a real beneficiary claim. Another regression leaves an expired pending Round 1 purchase unsettled while Round 2 ends: listing and Round 1 inventory return stay blocked until finalization. Duplicate end/return and reactivation attempts fail as expected.

Fork command from `packages/contracts`:

```bash
forge test --match-contract ULIQDeployedTokenForkAuditTest \
  --fork-url https://arb1.arbitrum.io/rpc \
  --fork-block-number 502625136 -vv
```

This fork uses the existing Arbitrum One ULIQ token and candidate contracts created only in local EVM state, mock USDC and Safe impersonation. It does not verify signatures or transact on Mainnet. A first follow-up fork run hit the public RPC's historical metadata error for a synthetic caller; using the already-loaded Treasury Safe as a non-owner caller removed that fixture dependency. Both fork paths then passed. Arbitrary non-owner end calls are also covered by the deterministic local tests. A cached artifact initially lacked storage-layout output; an explicit forced `forge inspect` regenerated it and the normalized comparison passed.

## Cross-layer review and limits

- ABI selectors, errors, event signatures, sale-state enum values and storage layout are unchanged. Existing `SaleStateChanged(READY, ENDED)` uses the same event.
- The public API reads `state()` from the chain and maps the existing enum. The indexer decodes the same ABI and stores existing events; no new purchase status, DB field or migration is needed.
- The current API ABI is intentionally a subset and has no existing `endSale()` preparation workflow. Recovery is a contract call for the deployment/operator runbook; this fix does not create or activate an automated operator.
- Safe readiness preparation can become stale between preparation and execution. The new onchain deadline check remains authoritative and rejects expired execution; a still-`DRAFT` round can be rescheduled.
- No runner or web behavior change was needed for this source correction. No browser/live-indexer acceptance is claimed.
- The repository's missing `/hooks/validate-schema.py` post-edit hook still reported errors after writes. File/diff inspection, Solidity compilation, tests, scoped formatting and independent comparisons confirmed the edits.

R-01 is **fixed and verified locally, not deployed**. Non-upgradeable deployed instances would require a separately approved deployment/recovery plan; changing source does not patch them. Shared listing still depends on both rounds settling and owner scheduling. Mainnet locking, cancellation/safeguarding, final graph and Safe verification, and independent external audit remain open in the [active review](../../../packages/contracts/ULIQ_PRESALE_VESTING_LOCKING_REVIEW.md).

The original audit's incomplete export was subsequently finalized successfully as scan `91fc3376-3351-4570-82c9-9c9a997bf067`. Its [generated report](../../../packages/contracts/audits/2026-09-07-uliq/report.md) preserves the original source revision and operational-defect classification, with the authorized local correction identified separately. The report is an internal source review with explicit partial package coverage, not an independent external audit.

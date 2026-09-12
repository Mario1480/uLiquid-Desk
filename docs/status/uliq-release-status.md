# ULIQ Release Status

Status date: 2026-09-12

This document is the current status source for the ULIQ Mainnet release. The
implementation plans and ADRs retain design rationale and historical gates,
but older `BLOCKED`, `DRAFT`, or `unfunded` statements must be read against this
register.

Evidence layers remain separate:

- Mario supplied the current owner status for legal approval, commercial
  configuration, two-round design, Safe readiness, and audit progress.
- The public production Presale API supplied a read-only finalized Mainnet
  snapshot at block `504405448` on 2026-09-12.
- Independent audit completion, runtime background-job state, wallet
  transactions, sale activation, and DEX launch require their own evidence.

## Current gate register

| Area | Current status | Remaining work |
| --- | --- | --- |
| Legal and product approval | Complete by current owner confirmation | Retain the approved legal artifacts outside the public repository and keep deployed copy aligned with them |
| Independent contract audit | In progress | Complete the audit, resolve findings, and freeze the accepted source/build identity |
| Two-round contract graph | Complete | No architecture decision remains; preserve the deployed graph and ADR-009 parameters |
| Round 1 schedule | Configured in the backend draft: `2026-09-19T12:00:00Z` to `2026-12-31T12:00:00Z` | The contract remains `DRAFT`; execute and reconcile the separately authorized onchain scheduling, readiness, and activation steps when intended |
| Round 1 inventory | Funded with `50,000,000 ULIQ` | Preserve receipt and balance reconciliation through readiness and activation |
| Round 2 schedule | Open | Supply exact UTC start and end timestamps |
| Round 2 inventory | Not funded in the current public snapshot | Fund and reconcile `100,000,000 ULIQ` only in the separately authorized rollout step |
| Published Presale Terms | Complete and online | Current runtime version `2026-09-07`, SHA-256 `4f5e97a64569a271ecc475f9b3db44b2140e3b799e5a202ed54c563ebdeaf71d`, URL `/presale/terms` |
| Tier, subscription discount, and AI Credit cap configuration | Complete by current owner confirmation | Recheck the effective production values as part of the activation evidence |
| Safe setup and authority | Complete by current owner confirmation | Preserve per-operation Safe receipt and finalized-state reconciliation |
| Public Mainnet reads | Complete | The public API returned both rounds as `VALID` at finalized block `504405448` |
| Presale background indexer | Verification required | The public snapshot does not expose job state; replace the older disabled-runtime evidence with a current health/cursor/catch-up record |
| Purchases and automatic finalization | Intentionally disabled before activation | Perform controlled lifecycle canaries only after audit closure and explicit activation authorization |
| DEX, pool, TWAP, and listing | Open by design | Finalize and verify the DEX/pool configuration before listing; do not treat Presale readiness as DEX launch approval |
| Mainnet locker transactions | Reads, indexer, and UI active; deposits and extensions disabled in the last evidence | A separately authorized live lock/extension/mature-withdrawal acceptance remains if this rollout is to be opened |

## Verified public snapshot

The production response from `GET https://api.desk.uliquid.vip/uliq/public/presale`
reported:

- chain `42161`, both round configurations `VALID`, and purchases disabled;
- Round 1 state `DRAFT`, backend schedule configured, inventory funded, and
  `50,000,000 ULIQ` unsold inventory;
- Round 2 state `DRAFT`, no configured schedule, inventory not funded, and a
  `100,000,000 ULIQ` allocation cap;
- published Terms ready with the version and hash recorded above;
- no listing timestamp.

This read-only response proves the displayed finalized snapshot. It does not
prove the background indexer is enabled, authorize a Safe action, activate a
sale, or establish audit completion.

## Remaining completion path

1. Complete the independent audit and any required remediation.
2. Supply the Round 2 UTC window and prepare its later funding sequence.
3. Capture current production Presale indexer health, cursor, reconciliation,
   alert, and catch-up evidence.
4. At the separately authorized time, apply and reconcile Round 1's onchain
   schedule, `READY`, and activation operations.
5. Run the approved low-value purchase, withdrawal/finalization, persistence,
   reconciliation, and recovery canaries.
6. Complete the later Round 2 and DEX/listing gates without combining their
   approvals with Round 1 activation.


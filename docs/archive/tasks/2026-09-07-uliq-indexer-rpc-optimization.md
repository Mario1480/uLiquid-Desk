# ULIQ public Presale RPC optimization

## Implemented locally

The finalized indexer still compares complete contract-log results from two RPC providers for every contiguous range (up to 500 blocks). It now fetches and stores block headers only for event blocks and the range-end checkpoint. Empty intermediate blocks no longer generate individual RPC calls or database records. Existing checkpoint-based rollback and replay, serializable event projection, and cursor compare-and-swap remain in place. No database migration or deletion of historical records is required. No other consumer of public-Presale per-block sentinel records was found in API references.

Additional validation rejects removed/out-of-range/unexpected-address logs, wrong block numbers, and logs whose block hash differs from the checked block header before persistence. Both providers must continue to agree. RPC failures do not advance the cursor.

The indexer default and environment examples now use 60 seconds instead of 15. Existing production overrides must be explicitly changed during rollout. The maximum 500-block range remains sufficient for steady-state catch-up at approximately four Arbitrum blocks per second. Longer intervals without increasing range capacity could create growing lag. Finality delay is unchanged; up to one polling interval is added after data becomes eligible.

Pending-purchase tracking remains at 10 seconds to preserve transaction feedback; it does not read RPC state when there are no pending tracking rows. Ordinary anonymous Presale page visits do not continuously poll the overview. No transaction, sale activation, paid subscription, or production deployment was performed in this optimization task.

## Cost model and remaining provider constraint

An empty 500-block range now uses one header read per provider instead of 500 (99.8% reduction for that part of the workload). Assuming one billed Alchemy endpoint, 30 days, 60-second indexing, no events, no retries, and no initial backfill, a conservative budget is four block reads plus one log read per tick: 43,200 * (4 * 20 + 60) = 6,048,000 CUs, or approximately $2.72 at $0.45 per million CUs. This is a model, not measured production billing. Page views, wallet reads, purchases, backlog, errors, tax, and another paid provider are additional.

Alchemy Free's verified 10-block log-range limit is not fixed by this optimization. Free-tier compatibility still requires an appropriate endpoint or separately validated smaller log batches with sufficient catch-up capacity. Do not enable production based on the cost model alone.

## Validation

- API typecheck passed.
- Thirteen focused tests passed (eight indexer cases and five configuration cases).
- Indexer coverage: empty ranges, caught-up polling, duplicate event-block deduplication, decoded-event persistence, RPC disagreement, interrupted reads, canonical log/header matching, invalid log ranges, and cursor ownership loss with rollback.
- `git diff --check` passed.
- Live RPC cost and sustained indexing validation remain deployment follow-ups.

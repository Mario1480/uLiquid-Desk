# Mainnet locking RPC query adaptation

Date: 2026-09-08. Source commit: `dbfeb8ab9`. Deployment status: API deployed and healthy; activation remains disabled.

Mario requested adapting locking queries using the presale approach. The current presale indexer covers up to 500 blocks per poll, runs at a 60-second default interval and reads only event blocks and the end checkpoint. Its current source does not implement 10-block log chunking. Locking now retains those bounded-range and checkpoint principles and additionally splits each provider's log requests into contiguous ranges of at most 10 blocks.

## Behavior

- Each poll covers at most 500 finalized blocks, using no more than 50 sequential log requests per provider. Both providers are queried in parallel. Short final ranges are included exactly once.
- The default polling interval is 60 seconds. Existing explicit interval overrides still take precedence. This preserves multi-chunk catch-up instead of advancing only 10 blocks per minute.
- Each response must belong to its requested chunk. Provider agreement, event block identity, lease ownership and cursor compare-and-set remain required. Any failed chunk prevents the entire poll's event/projection/cursor commit; retries start at the last persisted boundary.
- Empty intermediate blocks require no individual block fetches or database rows. This keeps the presale checkpoint optimization. Chunking increases log request count compared with unrestricted large queries; no monthly price or quota sufficiency is asserted.
- Presale behavior, activation flags and onchain transaction flows are unchanged.

## Validation

- Eight focused indexer tests passed, including chunk boundaries, a one-block tail, out-of-range responses, late provider failure and retry, and catch-up across two 500-block ranges plus a 21-block tail.
- The complete ULIQ API suite passed: 138 tests. API typecheck and whitespace checks passed.
- Read-only VPS smoke used the actual production RPC configuration and the bundled new reader. Each provider successfully read the first 500 deployment blocks in exactly 50 requests of at most 10 blocks. No events were present. Primary elapsed time: 1763 ms; secondary: 6889 ms. No production database write was made by this smoke.
- All activation flags remain disabled; live indexing and position reconciliation are a subsequent acceptance step.

## Production rollout

The API production image built successfully and only the API container was recreated with `--no-deps --no-build api`. Image: `sha256:b29731fd3c58c8c9971800bbc16aa33f5fe1c7e3901e969a8fb2e4779a73369c`. API Docker health is healthy and public `/health` returns `{"ok":true}`. Web, runner and PostgreSQL container IDs are unchanged and healthy.

The compiled reader inside the newly running API successfully read 21 finalized deployment blocks in exactly three requests on each production RPC, including the short final chunk. All five activation flags were checked and remain false. No explicit interval override is present, so the 60-second code default applies. No database indexing run or onchain transaction was performed.

The attempt to tag the previous API image by its recorded container image reference returned `No such image`; no new rollback tag was created. The previous release remains available in Git. The failed tagging command did not recreate a container; the subsequent explicit API-only rollout succeeded.

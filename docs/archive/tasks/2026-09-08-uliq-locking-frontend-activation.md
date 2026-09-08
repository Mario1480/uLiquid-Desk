# Mainnet locking frontend activation

Date: 2026-09-08. Mario explicitly requested enabling the locker to inspect it in the frontend.

## Enabled scope

- `ULIQ_MAINNET_LOCKING_ENABLED=true`
- `ULIQ_MAINNET_LOCKING_INDEXER_ENABLED=true`
- `NEXT_PUBLIC_ULIQ_MAINNET_LOCKING_ENABLED=true`
- Deposits and extensions remain false. No onchain approval, lock, extension or withdrawal was submitted.

The production environment was backed up in the existing root-only directory before changing exactly these three flags. API was recreated with the existing verified image. Web was rebuilt with the enabled public flag and recreated. No application source changes or database migrations were required. Runner, PostgreSQL, Redis and Python-service container IDs were preserved and remain healthy.

API image: `sha256:b29731fd3c58c8c9971800bbc16aa33f5fe1c7e3901e969a8fb2e4779a73369c`.
Web image: `sha256:be5b52c5f740a75e202b7162a663c41de6e17a0a34715911f28d407e6dda4e4b`.

## Verification

- Fresh deployment preflight passed before activation against both production RPCs.
- The regular indexer started. Bounded manual catch-up calls used the same production indexer, lease and atomic cursor logic while the web build ran. The checkpoint reached its common finalized target `503083618` with failure count zero. No cursor was skipped or manually advanced.
- API and web Docker health are healthy. Runtime flags were read back and checked. The authenticated locking route returns HTTP 401 for an anonymous request, confirming that it is enabled and still requires authentication.
- Chrome's authenticated `/de/uliq/locking` page rendered the Mainnet heading, navigation entry, balance cards, positions section, wallet connection prompt, closed-deposit notice and the actual locker contract link `0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9`. No loading, error or indexer-lag notice remained at the observed snapshot. The tab was left open for Mario.
- This establishes frontend/read/indexer availability. Wallet signing, new locks, extensions and mature withdrawals are separate acceptance steps.

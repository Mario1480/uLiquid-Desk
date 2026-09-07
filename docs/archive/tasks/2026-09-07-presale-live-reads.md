# Presale live contract display

## Scope and configuration

Mario requested completing the production configuration and removing public preview mode. Application revision `6fd429513` separates public reads from background indexing. The public overview shares a 60-second cache and coalesces concurrent requests; transaction preparation and quotes retain their independent fresh reads. RPC failures no longer silently replace live data with preview values. The administrator's missing-contract warning is conditional on missing addresses.

Production configuration enables the public page, live data and API reads. Mario's previously stated Mainnet and terms approvals are recorded in the corresponding flags; these flags record owner approval, not an independent legal assessment. Purchases remain disabled, automatic finalization remains OFF, and background indexing is explicitly disabled. Purchase configuration rejects an explicitly disabled indexer. Alchemy Free cannot serve the normal 500-block indexer range; a compatible indexing configuration is still required before purchases.

The existing English terms are versioned `2026-09-07`, with SHA-256 `4f5e97a64569a271ecc475f9b3db44b2140e3b799e5a202ed54c563ebdeaf71d`. Canonical input is the eleven displayed section titles and bodies: title, LF, body, separated by two LF characters, UTF-8 without a trailing newline. This records the existing text without changing its contents.

## Verification

- API and web typechecks passed; translation integrity passed.
- Seven targeted tests passed, including concurrent snapshot coalescing, retry after failure, and preventing purchases while indexing is paused.
- A read-only Mainnet snapshot at finalized block `502755017` returned `VALID` for both rounds with no configuration issues. Both contracts remain DRAFT, without a sale window or funded inventory.
- API and web production builds passed and only those two services were recreated. Both Docker health checks passed. A protected environment backup was retained before configuration changes.
- Public `/health` and `/uliq/public/presale` returned HTTP 200. The live overview at block `502756203` reports both configurations VALID, both purchases disabled, and the versioned terms ready.
- Browser verification confirms the public page displays `Finalized block 502756203`, no preview badge or preview notice, two Not Live rounds and disabled quote submission. The Chrome admin shows Public UI Visible, Contracts Configured, Onchain API reads Enabled, both approvals Approved, and both inventories unfunded. The remaining Not configured labels refer to missing sale windows.
- Runtime inspection confirms background indexing is false, purchases false and automatic finalization OFF. No paid RPC plan was enabled.

## Remaining sale-start requirements

The owner must supply sale times and complete the required Safe transactions for scheduling, inventory funding, readiness and activation. No dates were invented and no onchain transactions were submitted by this change. Enabling public reads does not constitute a sale start.

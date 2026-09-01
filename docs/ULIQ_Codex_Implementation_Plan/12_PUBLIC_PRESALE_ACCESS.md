# Public Two-Round Presale Access

## Status

`PRODUCTION UI PREVIEW ACTIVE / SCHEDULE ADMIN ACTIVE / ONCHAIN ACTIVATION BLOCKED`

The public application path is deployed in the existing Desk web and API services. The static public UI preview and the schedule-only Superadmin surface became active on the canonical production host on 2026-09-01 at commit `18f9960a`. The preparation migration was applied after a verified database backup. This status does not authorize contract deployment, public onchain reads, Mainnet activation, purchase activation, or any onchain transaction. Deployment evidence is recorded in [the production release note](../archive/tasks/2026-09-01-uliq-public-presale-preview-production-deploy.md).

## Product boundary

- Public entry points: `/presale`, `/presale/vesting`, and `/presale/terms` on the Desk host.
- Authenticated Desk entry points remain `/uliq/presale` and `/uliq/vesting`. When the public runtime is enabled, those routes render the same transaction components inside the authenticated Desk shell.
- Both accepted rounds are visible. Only the onchain-active, correctly configured round can expose purchase controls.
- Before contract addresses are configured, the public routes render a clearly labelled static preview using the approved ADR-009 round parameters. The preview never creates a wallet session and never prepares a transaction.
- The static preview is excluded from the sitemap and marked `noindex, nofollow`; search indexing remains blocked until live data is separately enabled.
- A buyer does not need a Desk user account. Wallet access uses a dedicated SIWE session with a 24-hour lifetime and cookies isolated from Desk authentication.
- Purchase records and vesting positions are keyed by wallet and remain discoverable after that wallet is linked to a Desk account.
- The landing page shows only round-specific tokenomics and lifecycle data. It does not publish the complete token allocation table.

## Legal and access boundary

- Purchase preparation requires an approved Presale Terms version and SHA-256 text hash, plus a wallet-specific acknowledgement stored by wallet, chain, version, and hash.
- Until approved terms are configured, preview reads remain available and every purchase action stays disabled.
- No KYC, jurisdiction, allowlist, or contract-level attestation gate is implemented in this scope.
- Because the contracts remain directly callable, Legal must explicitly approve that access model before production purchase activation. A UI-only terms gate is evidence and UX control, not an onchain security boundary.
- Direct onchain purchases without matching acknowledgement evidence are retained as `DIRECT_ONCHAIN_UNVERIFIED` for operational review; they are not hidden from the canonical indexer.

## Runtime and safety controls

- `ULIQ_PUBLIC_PRESALE_ENABLED` controls public reads and wallet sessions.
- `NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_ENABLED` controls the public web routes, robots allow-list, sitemap entries, and shared Desk components. Without the API read flag it renders only the static preparation preview; live onchain data requires both flags and complete contract configuration.
- `NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_LIVE_DATA_ENABLED` prevents the static preview from making public Presale API or wallet-session requests. It remains disabled until the API read flag and reviewed contract configuration are ready.
- `ULIQ_PUBLIC_PRESALE_ADMIN_ENABLED` exposes only the Superadmin preparation endpoint and audited backend schedule. It does not enable legacy ULIQ Testnet services or public onchain reads.
- `NEXT_PUBLIC_ULIQ_ADMIN_VISIBLE` exposes the ULIQ Presale entry in the Superadmin navigation. It does not expose the legacy authenticated ULIQ product navigation.
- `ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED` separately controls quote and purchase preparation.
- Every Arbitrum One purchase runtime additionally requires `ULIQ_PUBLIC_PRESALE_MAINNET_APPROVED=true`, regardless of `NODE_ENV`.
- Contract addresses, two distinct RPC endpoints, deployment start block, chain, terms version, and terms hash are explicit configuration.
- The API cross-checks immutable round parameters, round ordering, token and USDC addresses, vesting bindings, and the shared listing controller at a finalized block before purchases are enabled.
- Backend schedule dates are display-only drafts while contract dates are unset. They never authorize a purchase or mutate a contract.

## Transaction lifecycle

- USDC approval and purchase remain separate wallet transactions.
- A submitted purchase is persisted before finality and reconciled through `SUBMITTED`, `SOFT_CONFIRMED`, `SAFE`, and `FINALIZED`.
- Receipt validation checks contract, event, round, buyer, purchase amount, allocation floor, block identity, replacement, cancellation, and reorg status.
- A dedicated finalized-block indexer projects both round contracts and both vesting contracts into wallet-based purchase and vesting records.
- Withdrawal remains buyer-only. Finalization remains permissionless and immutable-beneficiary. Vesting claims remain beneficiary-initiated wallet transactions.

## Required release gates

1. ADR-001 legal sign-off, including the direct-call access model and approved Presale Terms.
2. Production custody and treasury-release decision.
3. Independent contract audit and remediation closure.
4. Reviewed Arbitrum One addresses, deployment block, role matrix, Safe thresholds, and verified source code.
5. Migration review, backup, deployment rehearsal, and rollback plan.
6. Staging browser E2E covering wallet verification, terms, both round parameters, quote, approval, purchase, replacement, withdrawal, permissionless finalization, vesting, claim, reload, and second-device recovery.
7. Dual-RPC/indexer lag, reorg, reconciliation, alert, and manual-review runbook evidence.
8. Explicit production activation approval. Static UI visibility and schedule-only administration are deployed. Public onchain reads, purchases, and Mainnet approval remain separate changes and require separate approval.

## Explicitly not completed

- The production preparation migration and static UI preview are deployed; this is not evidence of onchain purchase readiness.
- No contract has been deployed or called.
- No Mainnet address, Safe, custody adapter, start block, terms version, or terms hash has been accepted.
- No purchase flag has been enabled.
- No public onchain read flag or legacy ULIQ Testnet runtime flag has been enabled.

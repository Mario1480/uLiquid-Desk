# ULIQ contract layout

The ULIQ Solidity sources are separated by lifecycle and review scope:

- `shared/`: network-neutral contracts and interfaces used by more than one ULIQ generation.
- `presale-v2/`: the current two-round presale review package. These are the candidate contracts for the next external audit.
- `legacy-testnet/`: the previous single-round Arbitrum Sepolia MVP, its provisional custody adapter, mock USDC, vesting, and locker. These contracts are excluded from the Presale V2 audit and must not be deployed to Mainnet.

Tests follow the same split under `test/uliq/presale-v2/` and `test/uliq/legacy-testnet/`. Legacy deployment scripts are isolated under `script/uliq/legacy-testnet/` and reject Mainnet chain IDs.

See [`ULIQ_PRESALE_V2_AUDIT_SCOPE.md`](../../ULIQ_PRESALE_V2_AUDIT_SCOPE.md) for the exact audit handoff, exclusions, trust assumptions, and unresolved production dependencies.

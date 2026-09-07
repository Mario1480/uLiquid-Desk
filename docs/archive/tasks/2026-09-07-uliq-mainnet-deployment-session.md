# ULIQ Mainnet deployment session — 2026-09-07

## Scope and authorization

Mario explicitly authorized deploying the existing Presale V2 package through Remix in Chrome on Arbitrum One. This session does not fund inventory, configure sale dates, activate purchases, schedule listing, deploy a new token, or deploy a locker. Repository source revision: `a3dfbd7648887ae027a628988d256644a3bb4097`.

## Evidence and resumability

All seven deployments are confirmed. The receipt-backed address inventory is in [mainnet-deployment.json](../../../packages/contracts/remix/presale-v2-2026-09-07/mainnet-deployment.json). All 71 initial-state and immutable-parameter getter checks passed. The [Remix packet](../../../packages/contracts/remix/presale-v2-2026-09-07/README.md) records compiler settings and local rehearsal evidence. Its separate deployment plan contains historical predictions and must not be treated as proof of deployment. Total deployment gas cost was `0.000198136793052 ETH`.

Each confirmed deployment was reconciled against its successful Mainnet receipt, sender, zero ETH value, constructor arguments, creation bytecode excluding metadata, runtime bytecode excluding metadata and immutable slots, and Admin Safe ownership. Separate read-only getter checks record the actual immutable values and initial state in the manifest. Receipt inclusion is not a claim of Ethereum finality.

The listing deployment succeeded despite Remix reporting `_context7.t3.error.indexOf is not a function`. Independent RPC checks found its creation receipt and contract code. Do not repeat that deployment. Later deployments returned normal Remix receipts. Mario confirms the MetaMask transaction prompts while Codex prepares and verifies the sequence.

## Remaining completion work

- All seven deployment receipts are preserved and all seven contracts have successful Sourcify verification reported by Remix. Etherscan requires an API key, and Blockscout returned rate limits or indexing timeouts.
- Completed: all five bindings executed through Admin Safe nonce 0 with 2/2 signatures. Transaction `0xac47da2610a7bf28b09f695863e7eeae20aaa91f43f0508d370b85418ebfd0eb` succeeded at block `502735846`; its receipt and Safe `ExecutionSuccess` event were verified independently.
- Completed: all 71 graph and parameter checks passed after binding at block `502736316`. Both rounds remain DRAFT, with zero sale dates and zero listing timestamp. Application addresses are prepared in `application-addresses.env.example` inside the Remix packet, with enable/purchase flags false. Applying application configuration and runtime validation remain pending; no application activation has been performed by this session.
- Funding, sale dates and activation remain separate subsequent operations.

## Live-read enablement attempt

### Authenticated Alchemy setup follow-up

Created `ULIQ Presale Mainnet` in Mario's Alchemy team with Arbitrum and Node API. The private Mainnet endpoint was stored only in protected server configuration. A complete overview snapshot compared Alchemy with the official Arbitrum RPC at finalized block `502738411`; both rounds returned `configurationStatus: VALID`, purchases disabled, and inventory unfunded. This verifies that snapshot only, not sustained availability.

The 500-block historical-log probe failed on Alchemy Free with its explicit 10-block request limit; the official RPC returned the event. The existing indexer compares logs from both providers, so the pair is not yet usable for complete indexing. Public live-read flags were restored to false and the API recreated; preview and purchase-disabled status remain. No web replacement or paid upgrade was performed. The Alchemy PAYG dialog was opened for owner review: $0.45 per million CUs for the first 300M/month, $0.40 thereafter, no monthly platform fee, and a temporary $5 card hold. A tariff decision or a separately validated indexer adaptation remains necessary before enablement.

Mario requested removing preview mode. A production read-only enablement attempt failed validation: PublicNode rejected archive reads; dRPC returned upstream usage-limit errors during the complete snapshot; pairing 1RPC with the official Arbitrum endpoint produced a missing-trie-node error at the common finalized block. The public overview returned HTTP 503. Finality and independent-provider comparison were not weakened.

Both public-presale enablement flags were restored to false and the API was recreated. The web build was not deployed; the existing preview frontend remains running. Purchases remain disabled and automatic finalization remains OFF. Removing preview mode is pending two reliable RPC endpoints supporting the complete finalized-state snapshot and historical log ranges. Confirmed contract addresses remain configured.

## Production address adoption

Build housekeeping after the live-read attempt: the successful but un-deployed web build is retained only as `uliquid-desk-web:presale-live-read-candidate-20260907`. Its `latest` tag was removed to avoid deploying the unvalidated candidate accidentally. The existing web container is unchanged and returned HTTP 200; API health returned `{"ok":true}` after rollback. Rebuild the web image with the intended flags before any subsequent recreation.

Mario subsequently requested adopting the confirmed addresses. Thirteen public address, chain and start-block values were applied to `/opt/uliquid-desk/.env.prod` and the existing API image was recreated with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api`. The previous environment file was retained in a root-only backup directory on the host. No application code, database migration, web build or runner deployment was performed.

All thirteen values were compared against the running API container and matched. API health returned `{"ok":true}` and Docker reported healthy. Five existing public-presale configuration tests passed locally; `git diff --check` passed. Local `.env`, `.env.example` and `.env.prod.example` were aligned with the confirmed addresses. The public backend and purchases remain disabled, automatic finalization remains OFF, and the web frontend remains in preview mode. RPC configuration and enabling live contract reads remain subsequent work. No source commit or push was performed during this configuration-only change.

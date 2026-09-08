# ULIQ Mainnet locking application rollout

Date: 2026-09-08. Scope: Mario authorized continuing RPC configuration and the API/web rollout. Application activation and onchain user transactions remain separate.

## Released

- Release commit `e7fafe73f8c11048f15300f9c8117a4fe36d508f` was assembled in an isolated checkout based on current production `main` (`7873a03f5`). Only the scoped locking changes were transferred from the older local integration branch, preserving production authentication and role changes. A documentation index conflict was resolved by retaining both entries.
- Local HTTPS push lacked credentials. A Git bundle transferred the exact commit to the production checkout, which fast-forwarded and successfully pushed `main` to GitHub. The original development checkout was preserved.
- Both API and web production images built successfully. Only API and web were recreated using `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api web`. No migration or other service restart was performed.
- API image: `sha256:10e62e2a0ca46caed54941ee07218c44129ef98eb3e7de558a9ab6854e5810d6`.
- Web image: `sha256:1f60f22f6ec996123ec8524619f36dc120b990971e335af25fbb1723907bb38f`.
- Prior API and web images retain local `before-mainnet-locking` tags for rollback. Environment backups are stored in the existing root-only backup directory.

## Configuration and checks

- Twelve Mainnet locking environment values match between the production file and running API: five deployment identity fields, two RPC URLs and five disabled activation flags. RPC credentials were not logged or committed.
- The final RPC pair reuses the existing public-presale primary provider and the official Arbitrum secondary endpoint. Presale RPC settings were not changed.
- The compiled preflight passed inside the newly running API with production configuration: `deployment_reconciled`, common finalized block `503077741`, hash `0x9b741c4c7dd5ebdca5de3ee3dbf4222cd1b7c911064d64645bf2e2f21fdcd749`. Runtime hash matches the independently verified deployment package. Locked principal and contract token balance are zero.
- All 128 ULIQ API tests passed on the current-main release checkout, including 20 focused Mainnet locking tests. Both web transaction-validation tests passed. API and web typechecks, i18n integrity and production builds passed.
- API and web Docker health are healthy. Public API `/health` returns `{"ok":true}`, web `/en/login` returns HTTP 200, and `/uliq/mainnet-locking` returns the expected HTTP 404 while the master gate is disabled.
- Runner, PostgreSQL, Redis and Python-service container IDs were compared with the pre-rollout baseline and are unchanged and healthy.

## Indexer activation blocker

The configured primary RPC's free tier rejects `eth_getLogs` ranges above 10 blocks. The new indexer currently queries up to 2000 blocks. The official secondary RPC passed the 2000-block query. Blast passed deployment preflight but also rejected the 2000-block query; dRPC returned a provider usage-limit error, and PublicNode required authenticated archive access. A temporary duplicate-RPC configuration was rejected by preflight and corrected before any container recreation.

The final pair supports deployment and contract-state reconciliation but is not ready for the current indexer range. Before activation, choose a provider supporting that range or implement and validate bounded small-range fetching with an adequate catch-up rate and request budget. Mario was asked whether an existing suitable provider is available; no credentials should be sent in chat.

All five activation flags remain false: master API, indexer, deposits, extensions and web visibility. There is no live Mainnet locking page or indexed-position acceptance yet. No token approval, lock, extension or withdrawal was submitted.

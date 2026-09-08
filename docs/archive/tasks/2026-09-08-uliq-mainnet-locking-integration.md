# ULIQ Mainnet locking — local application integration

Date: 2026-09-08. Scope: step 2 of the [active rollout](../../../packages/contracts/ULIQ_MAINNET_LOCKING_ROLLOUT.md). Step 1 files were already present and are preserved.

## Result

Added an independent Mainnet locking service, authenticated read/preparation routes, a finalized two-RPC indexer, polling-job/bootstrap registration and a gated `/uliq/locking` UI. Added separate deposit/extension/indexing switches, a mandatory verified runtime code hash for service readiness, English/German messages, correct Mainnet navigation and Docker/public build-variable wiring. Legacy Sepolia presale, locking and billing/entitlement behavior are retained. No Prisma migration or runner change was needed.

Transaction preparation binds the linked account wallet and configured locker. The browser validates the full requested action and checks the connected account/network before submission. Exact approvals, amount/uint64 checks, maturity/ownership/single-withdrawal checks and indexer transaction/lease checks are covered locally. Pending receipt state persists per wallet; confirmations remain distinct from finalized/indexed completion. Clearing local tracking does not cancel a transaction.

## Verification

| Layer | Result |
| --- | --- |
| Focused Mainnet config/preflight/service/indexer/routes and web calldata tests | 22 passed, 0 failed, using `node node_modules/tsx/dist/cli.mjs --test apps/api/src/uliq/mainnetLocking*.test.ts apps/web/src/uliq/mainnetLocking.test.ts` |
| Existing ULIQ API regression command, `npm -w apps/api run test:uliq` | 139 passed, 0 failed reported by the existing command |
| API typecheck | Passed |
| Web TypeScript check | Passed using `node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json` |
| Web i18n integrity | Passed |
| Local Playwright Chrome render | Desktop 1440px, mobile 390px and 360px; no horizontal overflow; English and German checked |
| Browser gate/error fixtures | Closed deposits and extensions retain withdrawal controls. RPC/API unavailable state hides transaction controls and displays an error. Without the linked wallet, signing controls are disabled. |

Browser QA used an isolated local mock API on port 4311 and a development web process on port 3310. Example wallet/locker addresses and positions were fixtures. A local-only test cookie exercised the page shell; no production authentication/session was used. Browser wallet switching, transaction submission and receipt replacement were not exercised with a real wallet. Screenshots are local artifacts under `output/playwright/mainnet-locking/` and must not be treated as live evidence.

During incremental compilation, newly added navigation messages briefly produced HMR missing-message errors; a clean reload after the files were applied had no console or page errors. Deliberately injected HTTP 503 responses produced expected browser request errors. Visual inspection found and corrected the inherited Testnet navigation label and removed an unnecessary outer card around the position cards.

The post-edit hook reported missing `/hooks/validate-schema.py`; applied files were independently inspected and checked with compilation, tests and diff validation.

## Remaining release work

Deploy the reviewed locker, verify source/runtime bytecode, record its real address/creation transaction/start block/code hash, reconcile through two RPCs, and configure the released API/web. Verify actual database/indexer operation and the connected wallet's network/approval/lock/extension/withdrawal flow in the approved smoke scope. Independent external audit remains separate. New deposits, extensions and indexing remain disabled in templates; no actual environment values, deployment, commit, push, wallet signature or fund movement occurred in this step.

# uLiquid Desk Agent Project Guide

Last updated: 2026-08-29

This file is the canonical repository guide for Codex and other engineering agents working in uLiquid Desk.

## Core rules

- Address the user as `Mario`.
- Communication with Mario may be in German. Repository documentation, READMEs, plans, ADRs, runbooks, task evidence, and new code comments must be written in English.
- Preserve technical identifiers and quoted user-facing copy when translation would change behavior or historical evidence.
- `AGENDA.md` contains release and gate history; it is not an agent instruction file.
- Before changing files, run `git status --short --branch` and preserve unrelated worktree changes.
- Do not revert, reformat, move, or include unrelated user changes.
- Do not use destructive Git commands unless Mario explicitly requests them.
- Never place real secrets, private keys, tokens, seed phrases, credentials, or production data in code, documentation, logs, or commits.
- Prefer local documentation and code evidence over assumptions about security, trading, billing, or capital flows.

## Documentation policy

- English is the only language for new or materially updated repository documentation.
- Keep active documents close to the feature they govern. Move completed implementation plans and historical task evidence to `docs/archive` only after verifying their status.
- Do not archive a document merely because some checklist items are complete. Plans with open rollout, migration, deployment, legal, security, or production gates remain active.
- Update inbound links and documentation indexes whenever a file moves.
- Do not silently rewrite historical facts. Archived evidence may retain exact commands, identifiers, output, and quoted UI text.
- Keep evidence layers explicit: code/tests, deployment/runtime, browser behavior, transaction receipt/finality, indexer state, and reconciliation are separate forms of evidence.
- Put completed dated task evidence under `docs/archive/tasks/YYYY-MM-DD-*.md`. Keep active plans in the relevant feature area until completion.
- Keep `docs/README.md` as the documentation index and maintenance policy. Keep `docs/SUMMARY.md` aligned with user-facing GitBook documentation.

## Project overview

uLiquid Desk is a multi-tenant futures trading and automation platform with a Next.js web app, Express API, execution runner, exchange integrations, AI predictions, grid bots, BotVault/FundingVault onchain flows, billing and licensing, ULIQ testnet/staging functionality, and admin/go-live operations.

Primary flow:

1. The user works in the Next.js web app.
2. The web app calls the Express API.
3. The API uses Prisma/PostgreSQL, Redis, exchange APIs, HyperEVM/Hyperliquid, and internal services.
4. The runner handles bot execution, grid loops, recovery, and reconciliation.
5. Contracts support BotVault/FundingVault funding, claims, close, and recovery.

## Monorepo map

- `apps/web`: Next.js routes, dashboard, trading desk, bots, predictions, wallet/funding, admin UI, i18n, and shared UI components.
- `apps/api`: Express API for auth, admin, billing, AI, predictions, trading, exchange accounts, vaults, grid, jobs, Telegram, calendar, news, system health, and ULIQ.
- `apps/runner`: bot runtime, grid execution, prediction copying, reconciliation, recovery, and monitoring.
- `apps/py-strategy-service`: Python strategy execution and registry.
- `apps/quant-research`: quantitative research and analysis.
- `packages/contracts`: Foundry contracts, tests, and deploy scripts.
- `packages/futures-exchange`: exchange adapters and futures interfaces.
- `packages/futures-core`, `packages/futures-engine`: shared futures types and execution components.
- `packages/core`, `packages/db`, `packages/exchange`: shared core, database, and exchange utilities.
- `packages/strategies`, `packages/risk`, `packages/orchestrator`, `packages/plugin-sdk`: strategy, risk, orchestration, and plugin modules.
- `prisma`: canonical schema and migrations.
- `docs`: product, engineering, user, operations, go-live, and archived evidence documentation.
- `scripts`, `infra`: development, validation, deployment, and infrastructure helpers.

## Feature map

### Web

- Dashboard: `apps/web/app/page.tsx`
- Trading desk: `apps/web/app/trade`
- Bots and grid: `apps/web/app/bots`, `apps/web/app/bots/grid`, `apps/web/app/bots/catalog`
- Predictions: `apps/web/app/predictions`
- Settings and accounts: `apps/web/app/settings`
- Administration: `apps/web/app/admin`
- Shared UI: `apps/web/app/components`, `apps/web/app/styles`, `apps/web/app/ui-system.css`
- Translations: `apps/web/messages`

### API and runner

- API bootstrap: `apps/api/src/bootstrap.ts`, `apps/api/src/index.ts`
- Auth and permissions: `apps/api/src/auth`
- Billing: `apps/api/src/billing`
- Exchange accounts: `apps/api/src/exchange-accounts`
- Grid and vaults: `apps/api/src/grid`, `apps/api/src/vaults`
- AI and predictions: `apps/api/src/ai`, `apps/api/src/predictions`
- Admin and system: `apps/api/src/admin`, `apps/api/src/system`
- ULIQ: `apps/api/src/uliq`
- Runner: `apps/runner/src/execution`, `apps/runner/src/grid`, `apps/runner/src/runtime`, `apps/runner/src/signal`

### Contracts and persistence

- Contracts: `packages/contracts/src`
- Contract scripts: `packages/contracts/script`
- Contract tests: `packages/contracts/test`
- Prisma schema and migrations: `prisma`

BotVault, FundingVault, grid, billing, and ULIQ changes can affect contracts, Prisma, API, runner, web, and operations documentation. Inspect every relevant layer before deciding a change is isolated.

## UI rules

- For uLiquid web UI work, read and apply `apply-uliquid-ui-design` before changing layouts, components, colors, cards, forms, navigation, admin, dashboard, wallet, or BotVault surfaces.
- For native uLiquid iOS/SwiftUI work, use `apply-uliquid-ios-ui-design`.
- Read nearby components and styles before editing; the existing design language has priority.
- Use `AppIcon` from `apps/web/app/components/AppIcon.tsx`; do not add inline SVGs for normal UI icons.
- Important action buttons should include icons.
- Prefer existing primitives such as `uiPage`, `uiSection`, `card`, `btn`, `btnPrimary`, `AdminPageHeader`, `AdminTable`, and `AdminNotice`.
- Follow existing i18n patterns for visible text.
- Validate web/UI changes locally when possible, including mobile layouts and capital-related flows.
- Slow detail, analytics, AI, or dashboard requests must not block capital-status lists.
- Do not change routes, API response shapes, or permission logic without a concrete reason.

## Development rules

- Use npm only; do not use pnpm or Yarn.
- Supported Node.js version: `>=20.9.0 <21`.
- Generate Prisma Client before root builds/typechecks when required.
- Use `apply_patch` for scoped file edits.
- Search references with `rg` before deleting or moving files.
- Preserve backward compatibility and idempotency in exchange and money flows.

## Capital-flow and production safety

Wallet/funding, FundingVault, BotVault, grid bots, manual trading, exchange accounts, billing/profit share, ULIQ, and contracts are capital- or onchain-sensitive.

- Never perform production transactions, deployments, contract calls, operator rotations, close/recover actions, migrations, or activations without explicit authorization.
- Review idempotency, destination-balance reconciliation, pending state, retry/backoff, recovery guidance, and audit trails for money flows.
- A source balance or submitted receipt is not final confirmation; verify destination state and documented reconciliation.
- Check API, runner, web, Prisma, contracts, and docs for cross-layer impact.
- For FundingVault launches, verify onchain `operator()` against the database/agent wallet or add an explicit preflight.
- Do not classify RPC rate limits, indexer lag, or reconciliation backoff as funding failure without evidence.
- Consider close/recover/claim only with fresh trading reconciliation and a consistent contract/HyperCore balance picture.

## Go-live starting point

For go-live, BotVault, funding, trading, contract, ULIQ, or production questions, inspect:

- `docs/go-live-master-plan.md`
- `docs/go-live-readiness-followups.md`
- `docs/botvault-go-live-followups.md`
- `docs/wallet-funding-go-live-status.md`
- `docs/gridbot-go-live-status.md`
- `docs/trading-desk-go-live-status.md`
- `docs/contract-readiness-checklist.md`
- `docs/botvault-e2e-integration-test-matrix.md`
- `docs/release-evidence-matrix.md`
- current evidence under `docs/archive/tasks`

Record live smokes, canaries, and operator observations as dated evidence under `docs/archive/tasks`, then summarize current conclusions in the applicable status document.

## Current BotVault baseline

As of 2026-05-25:

- BotVault V4 is the current production path.
- Low-value wallet-funded V4 start through `running` has live evidence.
- Low-value wallet-funded V4 close/settlement through `execution_status=closed`, `funding_status=settled`, `hypercore_funding_status=withdrawn`, and reconciliation `ok` has live evidence.
- FundingVault-backed V4 launch through `running` has live evidence.
- The first FundingVault failures on 2026-05-25 were caused by an onchain/database operator mismatch (`only_operator`), not a known V4 code blocker.
- Broad public go-live still requires generic wallet transfer smokes, profit claim, FundingVault-backed close/settlement, observed pending/recovery paths, alert delivery/runbook probes, grid long-run/restart/cancel recovery, contract readiness, and a 24–48 hour operating review.

## Common checks

```bash
npm run typecheck
npm run build
npm run quality:any-budget
npm run quality:vendor-charting

npm -w apps/web run typecheck
npm -w apps/web run i18n:check

npm -w apps/api run typecheck
npm -w apps/api run test:auth
npm -w apps/api run test:ai
npm -w apps/api run test:vaults
npm -w apps/api run test:grid-corewriter

npm -w apps/runner run typecheck
npm -w apps/runner run test
npm -w apps/runner run test:vault-grid-corewriter

npm run contracts:build
npm run contracts:test
```

Python strategy service:

```bash
PY_STRATEGY_AUTH_TOKEN=test-token PY_GRID_AUTH_TOKEN=test-token \
PYTHONPATH=apps/py-strategy-service \
pytest -q apps/py-strategy-service
```

Repository hygiene:

```bash
git diff --check
git status --short
rg "window\\.confirm|confirm\\(" apps/web/app/admin -g '*.tsx'
```

## Local and production orientation

```bash
npm run docker:dev:up
npm run docker:dev:logs
npm run dev:local
npm run dev:local:runner
curl -i http://localhost:${API_PORT:-4000}/health
```

Production entry points:

- Compose: `docker-compose.prod.yml`
- Install: `scripts/install_vps.sh`
- Deploy: `scripts/deploy_prod.sh`
- Environment sync: `scripts/sync_env_files.sh`
- Contract deploy helper: `scripts/deploy_contracts_vps.sh`
- Operations docs: `docs/PRODUCTION_DEPLOY.md`, `docs/contracts-vps-deploy.md`, `docs/ops`
- Web: `https://desk.uliquid.vip`
- API: `https://api.desk.uliquid.vip`

## Commit, push, and deploy rules

- After an authorized terminal deployment, inspect the Git state and preserve deploy-relevant changes promptly.
- The default target is `main` / `origin/main`, but never push blindly when branch state, divergence, tests, or unrelated changes make that unsafe.
- Before committing or pushing, inspect `git status --short --branch` and the relevant diff.
- Include only changes from the authorized task. Never commit secrets, environment values, private keys, tokens, dumps, or local artifacts.
- Report the commit ID, push result, and relevant deploy/smoke evidence after a successful deploy workflow.

## Agent restart checklist

1. Run `git status --short --branch`.
2. Search relevant files and references with `rg`.
3. Read nearby components, styles, tests, and active documentation.
4. Make a small, scoped change.
5. Run proportionate checks.
6. Report the result and remaining risks clearly.

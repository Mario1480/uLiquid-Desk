# uLiquid Desk

uLiquid Desk is a multi-tenant futures trading and automation platform. This monorepo contains the Next.js web application, Express API, execution runner, exchange adapters, quantitative and Python strategy services, Prisma data model, and EVM contracts used by BotVault and FundingVault flows.

The platform covers manual trading, exchange account management, AI-assisted predictions, prediction copying, standard and grid bots, wallet funding, BotVault V4, billing and licensing, ULIQ testnet/staging flows, administration, monitoring, and operational go-live evidence.

> uLiquid Desk can initiate trading and capital-moving workflows. Use paper mode and low-value canaries first. A submitted transaction, exchange receipt, or wallet confirmation is not final evidence until the destination state and reconciliation status are verified.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js dashboard, trading, bots, predictions, wallet, billing, and admin UI |
| `apps/api` | Express API for authentication, billing, exchanges, AI, grid, vault, ULIQ, and admin services |
| `apps/runner` | Bot and grid execution, recovery, reconciliation, and prediction-copying workers |
| `apps/py-strategy-service` | Python strategy registry and execution service |
| `apps/quant-research` | Quantitative research and analysis tools |
| `packages/contracts` | Foundry contracts, tests, and deployment scripts |
| `packages/futures-*` | Futures domain types, exchange adapters, and execution engine components |
| `packages/core`, `packages/db` | Shared utilities and database-facing helpers |
| `packages/strategies`, `packages/risk`, `packages/orchestrator` | Strategy, risk, and orchestration modules |
| `prisma` | Canonical Prisma schema and migrations |
| `docs` | Product, engineering, operations, go-live, and user documentation |
| `scripts` | Development, validation, regression, environment, and deployment helpers |

## Requirements

- Node.js `>=20.9.0 <21`
- npm `10.8.2` (the only supported package manager)
- Docker with Docker Compose for the containerized development stack
- PostgreSQL and Redis when running services directly
- Foundry for contract builds and tests
- Python and pytest for the Python strategy service

## Install

```bash
npm install
cp .env.example .env
npm run db:generate
```

Keep real credentials out of the repository. Use the environment templates as references and provide secrets through the approved local or deployment environment.

## Local development

Start the Docker development stack:

```bash
npm run docker:dev:up
npm run docker:dev:logs
```

Or run services directly:

```bash
npm run dev:local
npm run dev:local:runner
```

Individual entry points:

```bash
npm run dev:web
npm run dev:api
npm run dev:runner
```

API health check:

```bash
curl -i http://localhost:${API_PORT:-4000}/health
```

## Database

```bash
npm run db:up
npm run db:migrate
npm run db:generate
```

Prisma migrations can affect persisted capital and lifecycle state. Review migrations and rollout instructions before applying them outside local development.

## Validation

Repository-wide checks:

```bash
npm run typecheck
npm run build
npm run quality:any-budget
npm run quality:vendor-charting
```

Focused checks:

```bash
npm -w apps/web run typecheck
npm -w apps/web run i18n:check

npm -w apps/api run typecheck
npm -w apps/api run test:auth
npm -w apps/api run test:ai
npm -w apps/api run test:vaults

npm -w apps/runner run typecheck
npm -w apps/runner run test

npm run contracts:build
npm run contracts:test
```

Python strategy service:

```bash
PY_STRATEGY_AUTH_TOKEN=test-token \
PY_GRID_AUTH_TOKEN=test-token \
PYTHONPATH=apps/py-strategy-service \
pytest -q apps/py-strategy-service
```

## Production and go-live

Production operations are separate from normal development work. Code approval does not authorize deployments, migrations, contract calls, wallet transactions, bot launches, or other capital-moving actions.

Start with:

- [`docs/go-live-master-plan.md`](docs/go-live-master-plan.md)
- [`docs/go-live-readiness-followups.md`](docs/go-live-readiness-followups.md)
- [`docs/release-evidence-matrix.md`](docs/release-evidence-matrix.md)
- [`docs/ops/go-live-and-smoke-tests.md`](docs/ops/go-live-and-smoke-tests.md)
- [`docs/contract-readiness-checklist.md`](docs/contract-readiness-checklist.md)

Production entry points:

- `docker-compose.prod.yml`
- `scripts/install_vps.sh`
- `scripts/deploy_prod.sh`
- `scripts/sync_env_files.sh`
- `scripts/deploy_contracts_vps.sh`

Canonical services:

- Web: `https://desk.uliquid.vip`
- API: `https://api.desk.uliquid.vip`

## Documentation

The documentation index and maintenance policy live in [`docs/README.md`](docs/README.md). Repository documentation and READMEs are written in English. Historical implementation evidence is kept under `docs/archive`; active plans and operational status documents remain in their feature locations.

See [`AGENTS.md`](AGENTS.md) for repository-specific agent rules. Release and gate history is maintained separately in [`AGENDA.md`](AGENDA.md).

## License and access

This is a private project. Do not redistribute source code, credentials, operational data, or deployment material without explicit authorization.

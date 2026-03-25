# Configuration

This repository uses env templates as the source of truth and expects real env files to remain local and untracked.

## Files

- `.env.example`
  - full local/dev template
- `.env.prod.example`
  - curated production template
- `.env`
  - local/dev runtime file created from `.env.example`
- `.env.prod`
  - production runtime file created from `.env.prod.example`

The root `.env` file is ignored and should not be committed. Populate local or production env files by copying from the example templates and filling in real values outside git.

## Startup validation

The following services now validate critical env vars at startup and fail fast with readable errors:

- `apps/api`
- `apps/runner`
- `apps/web`
- `apps/py-strategy-service`

Validation is intentionally narrow. It blocks startup only for critical misconfiguration and leaves non-critical feature flags on their existing defaults.

## Local vs production

### Local / dev

- create `.env` from `.env.example`
- docker compose dev uses `.env`
- direct local scripts such as `scripts/dev_local.sh` load `.env` and fall back to `.env.local` if present
- defaults remain development-friendly where the app already provides safe fallbacks

### Production

- create `.env.prod` from `.env.prod.example`
- production compose and deployment scripts use `.env.prod`
- production validation is stricter for public origin/domain settings and API endpoint wiring
- `redis` and `postgres` should stay internal to the Docker network in production and must not be published on public host ports by default

## Required vars by service

### `apps/api`

Required:

- `DATABASE_URL`
- `SECRET_MASTER_KEY`

Conditionally required:

- `REDIS_URL` when `ORCHESTRATION_MODE=queue`
- `CORS_ORIGINS` in production
- `SIWE_ALLOWED_DOMAINS` in production
- `PY_STRATEGY_AUTH_TOKEN` or `PY_GRID_AUTH_TOKEN` when Python strategy or grid runtime is enabled

Optional but commonly used:

- `API_PORT`
- `API_HOST`
- `COOKIE_DOMAIN`
- `COOKIE_SECURE`
- `API_RATE_LIMIT_REDIS_URL`
- `PY_STRATEGY_URL`
- `PY_GRID_URL`

### `apps/runner`

Required:

- `DATABASE_URL`

Conditionally required:

- `REDIS_URL` when `ORCHESTRATION_MODE=queue`
- `AGENT_SECRET_ENCRYPTION_KEY` or `SECRET_MASTER_KEY` when `RUNNER_AGENT_SECRET_PROVIDER=encrypted_env`
- `PY_GRID_AUTH_TOKEN` or `PY_STRATEGY_AUTH_TOKEN` when grid runtime is enabled

Optional but commonly used:

- `RUNNER_PORT`
- `RUNNER_SCAN_MS`
- `RUNNER_TICK_MS`
- `RUNNER_AGENT_SECRET_PROVIDER`
- `HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON`

### `apps/web`

Required in production:

- `NEXT_PUBLIC_API_URL`

Optional:

- `API_URL`
- `API_BASE_URL`
- `NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID`
- `NEXT_PUBLIC_HYPEREVM_RPC_URL`
- `NEXT_PUBLIC_HYPEREVM_EXPLORER_URL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_WEB3_ENABLE_ARBITRUM`

Notes:

- browser-side code needs `NEXT_PUBLIC_*` variables
- server-side middleware can use `API_URL` or `API_BASE_URL`, but production should still set `NEXT_PUBLIC_API_URL`

### `apps/py-strategy-service`

Required:

- `PY_STRATEGY_AUTH_TOKEN`

Optional:

- `PY_TA_BACKEND`

Accepted `PY_TA_BACKEND` values:

- `auto`
- `talib`
- `pandas_ta`

## Shared secrets

These secrets are especially sensitive and should be unique per environment:

- `SECRET_MASTER_KEY`
- `AGENT_SECRET_ENCRYPTION_KEY`
- `PY_STRATEGY_AUTH_TOKEN`
- `PY_GRID_AUTH_TOKEN`
- `AI_API_KEY`
- `SMTP_PASS`
- `TELEGRAM_BOT_TOKEN`

Do not store real values in example files, docs, or committed env files.

## Operational guidance

- Prefer filling secrets through local env files, deployment secrets, or host/container env injection.
- Keep variable names backward compatible unless there is a planned migration.
- When adding new critical vars, update:
  - startup validation
  - `.env.example` or `.env.prod.example`
  - this document

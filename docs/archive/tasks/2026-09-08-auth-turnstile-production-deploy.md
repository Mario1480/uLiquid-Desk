# Authentication Turnstile Production Deployment Evidence

Date: 2026-09-08  
Deployment completed: 2026-09-08T13:32:09Z  
Application commit: `49a8323d4b527440977ebcce8f11ae395ad19bbe`

## Scope

This release deployed the shared Cloudflare Turnstile protection for password reset requests, public signup and verification resend, plus risk-triggered email login challenges. Wallet authentication remained unchanged. The release also retained the three commits that were already present on the production checkout but had not yet been pushed to `origin/main`.

No contract, transaction, trading, billing, or public-presale activation was performed.

## Pre-deployment verification

- Auth test suite: 69 passed, 0 failed.
- API typecheck: passed.
- Web typecheck: passed.
- Web i18n integrity check: passed.
- API production build: passed.
- Web production build: passed with `NEXT_PUBLIC_API_URL=https://api.desk.uliquid.vip`.
- Git diff check: passed.
- Required production Turnstile and beta-access variables were checked for presence without printing their values.

## Git and deployment

- The release commit was rebased without conflicts onto production commit `c56df5a7daa01ebf69b9866aa68fe7b4694fbc1f`.
- The resulting history was pushed to `origin/main` as a strict fast-forward; no force push was used.
- Deployment command: `./scripts/deploy_prod.sh --no-pull api web` from `/opt/uliquid-desk`.
- Environment synchronization added the missing documented `AUTH_LOGIN_TURNSTILE_THRESHOLD` default and did not overwrite existing configured values.
- Docker Compose rebuilt the API and web images. Due to the Compose dependency graph, it also recreated PostgreSQL and the Python strategy service and restarted the runner.
- The runner logged the expected transient PostgreSQL connection termination during that controlled database restart, then reconnected. No new runner error lines appeared in the post-start observation window.

## Production verification

- All seven Compose services were running and healthy after deployment.
- API, web, PostgreSQL, Redis, Python strategy service, and runner health checks passed.
- API, web, PostgreSQL, Redis, and Python strategy service reported zero container restart count. The runner retained its cumulative restart count of three and was healthy after this deployment.
- Prisma reported 116 migrations and no pending migrations.
- `https://api.desk.uliquid.vip/health`: HTTP 200 with a healthy payload.
- `https://api.desk.uliquid.vip/auth/turnstile`: HTTP 200, protection enabled, public site key present.
- German login, registration, and password-reset pages: HTTP 200.
- English login page: HTTP 200.
- Browser verification showed the production Turnstile challenge completing on the German password-reset page and enabling the request step only after verification.
- Browser verification showed the German closed-registration page rendering the beta application form with the privacy disclosure and protected submission flow.

No real email, beta application, account, password reset, or failed production login was created during smoke testing.

## Observations

- The Docker dependency install reported three pre-existing moderate npm audit findings. They did not fail the locked production build and were not changed as part of this scoped release.
- The API does not expose `/ready`; that URL returned 404. The supported public `/health` endpoint returned 200 and Docker health checks passed.

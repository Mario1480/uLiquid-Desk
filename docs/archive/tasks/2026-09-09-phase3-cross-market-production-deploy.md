# Phase 3 Cross-Market Production Deployment

Date: 2026-09-09

## Scope

- Production host: `uliquid-desk`
- Server checkout: `/opt/uliquid-desk`
- Application release commit: `ca4f912e461527f4d44422c8fec8afe8c702e66a`
- Rebuilt services: `api`, `web`
- Deployment command: `./scripts/deploy_prod.sh --no-pull api web`

The server checkout was fast-forwarded from `d637371e819ebc21f2254bcc8b171dce3d181f25` to the published Phase 3 release. The existing untracked `backups/` directory was preserved. The deployment wrapper added one missing key from the production environment template without replacing existing values. No secret or environment value was printed or committed.

## Runtime evidence

- The API and web production images built successfully.
- Docker Compose recreated `postgres`, `py-strategy-service`, `api`, and `web`; the persistent PostgreSQL volume remained attached.
- `api`, `web`, `postgres`, `redis`, `runner`, `py-strategy-service`, and `salad-proxy` reported healthy after the deployment.
- Prisma found 116 migrations and reported no pending migrations.
- The public API health endpoint returned HTTP 200 with `{"ok":true}`.
- Caddy reported `active`.
- An unauthenticated `POST /cross-market/scan` request returned HTTP 401 with the expected authentication requirement, confirming that the new route is registered and protected.
- An unauthenticated request to `/en/cross-market` redirected to `/en/login`, confirming the authenticated page boundary.

## Observations

The API remained healthy while startup calibration logged Bitget candle-window warnings for requests exceeding the venue's 90-day interval limit. These warnings did not block startup or the deployment health checks, but they remain operational follow-up evidence for the market-data calibration path.

This deployment did not enable trading, place orders, change write gates, deploy contracts, or perform onchain transactions.

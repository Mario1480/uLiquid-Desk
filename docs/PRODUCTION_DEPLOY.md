# Production Deploy (Docker Compose)

## Prereqs
- Docker + Docker Compose installed
- `.env.prod` configured on the server
- Caddy installed from the official apt repo (no Snap dependency)

## Env Setup

```sh
cp .env.prod.example .env.prod
bash ./scripts/sync_env_files.sh --target .env.prod
```

For `.env.prod`, the sync script now only adds missing keys from `.env.prod.example`.
This keeps fresh VPS installs on the current production surface and avoids pulling legacy/dev-only env keys back in.

Required for WalletConnect/Web3 in production:
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID` (default `999`)
- `NEXT_PUBLIC_HYPEREVM_RPC_URL`
- `NEXT_PUBLIC_HYPEREVM_EXPLORER_URL`
- `NEXT_PUBLIC_WEB3_ENABLE_ARBITRUM` (optional `0|1`)

Important: all `NEXT_PUBLIC_*` values are build-time inputs for `web`.
If changed, rebuild `web`:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml build --no-cache web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d web
```

## Build + Start

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Alternative (recommended) deploy wrapper with auto `git pull` + `.env.prod` sync:
```sh
./scripts/deploy_prod.sh
```

When run as `root`, `deploy_prod.sh` also:
- auto-migrates Snap-Caddy to apt/systemd if still present
- re-installs the self-heal timer if needed
- validates and reloads `/etc/caddy/Caddyfile`

## Caddy (apt + systemd)

Install from the official apt repo:

```sh
sudo bash ./scripts/install_caddy_apt.sh
```

Config path:

```sh
/etc/caddy/Caddyfile
```

Validate + reload:

```sh
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Logs:

```sh
sudo journalctl -u caddy -n 120 --no-pager
sudo systemctl status caddy --no-pager
```

Existing VPS migration from Snap-Caddy:

```sh
sudo bash ./scripts/migrate_snap_caddy.sh
```

Dedicated migration guide:
- `docs/CADDY_MIGRATION.md`

That migration script:
- backs up `/var/snap/caddy`
- copies an existing Snap `Caddyfile` to `/etc/caddy/Caddyfile`
- does a best-effort copy of certificate/state data
- removes Snap-Caddy
- enables the new `systemd`-managed Caddy service
- installs the self-heal timer

Self-healing:

```sh
sudo systemctl status caddy-self-heal.timer --no-pager
sudo journalctl -u caddy-self-heal.service -n 50 --no-pager
```

## Verify

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200 api
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200 runner
curl -I http://127.0.0.1
curl -I https://panel.example.com
sudo systemctl is-active caddy
sudo ss -ltn | grep -E '(:80|:443)'
```

Typical production domains:

```text
Web: panel.example.com
API: api.panel.example.com
```

AI proxy (Salad/Ollama via OpenAI-compatible endpoint):
```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml ps salad-proxy
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api wget -qO- http://salad-proxy:8088/health
```
Admin settings for Salad/Ollama:
- Provider: `ollama`
- Base URL: `http://salad-proxy:8088/v1`
- Model: `qwen3:8b`
- API key: `salad_cloud_user_...`

Optional cost-saving control (manual):
- In `/admin/api-keys` configure `Salad Runtime Control` target:
  - `Organization`, `Project`, `Container`
- Then use `Start container` / `Stop container` directly in Admin during test windows.

Health checks:
```sh
curl -i http://localhost:8080/health
curl -i http://localhost:8080/ready
curl -i http://localhost:8091/health
curl -i http://localhost:8091/ready
```

## Restart / Rebuild

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## Notes
- Postgres uses a named volume (`pgdata`), so data persists across restarts.
- API runs `prisma migrate deploy` on startup.
- `docker-compose.prod.yml` uses `.env.prod` (no dev mounts).
- Contracts deploy (Foundry) is handled separately via:
  - `./scripts/deploy_contracts_vps.sh --mode devnet --env-file .env.prod`
  - Details: `docs/contracts-vps-deploy.md`

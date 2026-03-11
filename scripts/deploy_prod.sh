#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SKIP_PULL="0"

for arg in "$@"; do
  case "${arg}" in
    --no-pull)
      SKIP_PULL="1"
      ;;
    *)
      echo "Unknown argument: ${arg}"
      echo "Usage: $0 [--no-pull]"
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing compose file: ${COMPOSE_FILE}"
  exit 1
fi

echo "==> Repo: ${ROOT_DIR}"
echo "==> Env: ${ENV_FILE}"
echo "==> Compose: ${COMPOSE_FILE}"

if [[ "${EUID}" -eq 0 ]]; then
  echo "==> Ensuring Caddy runtime (auto-migrate Snap if present)"
  "${ROOT_DIR}/scripts/ensure_caddy_systemd.sh"
else
  echo "==> Skipping automatic Caddy ensure (run as root to auto-migrate/repair Caddy)"
fi

if [[ "${SKIP_PULL}" != "1" ]]; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "==> Skipping git pull (--no-pull)"
fi

echo "==> Syncing env file with templates"
"${ROOT_DIR}/scripts/sync_env_files.sh" --target "${ENV_FILE}" --root "${ROOT_DIR}"

echo "==> Deploying containers"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

if command -v caddy >/dev/null 2>&1 && [[ -f /etc/caddy/Caddyfile ]]; then
  echo "==> Validating and reloading Caddy"
  caddy fmt --overwrite /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload caddy
fi

echo "==> Service status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Done"

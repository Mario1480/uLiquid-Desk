#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SKIP_PULL="0"
ENSURE_CADDY="0"
RELOAD_CADDY="0"

for arg in "$@"; do
  case "${arg}" in
    --no-pull)
      SKIP_PULL="1"
      ;;
    --ensure-caddy)
      ENSURE_CADDY="1"
      ;;
    --reload-caddy)
      RELOAD_CADDY="1"
      ;;
    *)
      echo "Unknown argument: ${arg}"
      echo "Usage: $0 [--no-pull] [--ensure-caddy] [--reload-caddy]"
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

if [[ "${SKIP_PULL}" != "1" ]]; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "==> Skipping git pull (--no-pull)"
fi

if [[ "${ENSURE_CADDY}" == "1" ]]; then
  if [[ "${EUID}" -eq 0 ]]; then
    echo "==> Ensuring Caddy runtime (auto-migrate Snap if present)"
    if ! "${ROOT_DIR}/scripts/ensure_caddy_systemd.sh"; then
      echo "WARN: Caddy ensure failed. Continuing deploy so git/docker update is not blocked."
    fi
  else
    echo "==> Skipping Caddy ensure (run as root to use --ensure-caddy)"
  fi
else
  echo "==> Skipping automatic Caddy ensure (use --ensure-caddy when Caddy changed)"
fi

echo "==> Syncing env file with templates"
"${ROOT_DIR}/scripts/sync_env_files.sh" --target "${ENV_FILE}" --root "${ROOT_DIR}"

echo "==> Deploying containers"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

if [[ "${RELOAD_CADDY}" == "1" ]] && [[ "${EUID}" -ne 0 ]]; then
  echo "==> Skipping Caddy reload (run as root to use --reload-caddy)"
elif [[ "${RELOAD_CADDY}" == "1" ]] && command -v caddy >/dev/null 2>&1 && [[ -f /etc/caddy/Caddyfile ]]; then
  echo "==> Validating and reloading Caddy"
  caddy fmt --overwrite /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy
  else
    echo "==> Caddy inactive, starting with restart"
    systemctl restart caddy
  fi
elif [[ "${RELOAD_CADDY}" == "1" ]]; then
  echo "==> Skipping Caddy reload (binary or /etc/caddy/Caddyfile missing)"
fi

echo "==> Service status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Done"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SKIP_PULL="0"
ENSURE_CADDY="0"
RELOAD_CADDY="0"
TARGET_SERVICES=()

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
    -*)
      echo "Unknown argument: ${arg}"
      echo "Usage: $0 [--no-pull] [--ensure-caddy] [--reload-caddy] [service ...]"
      exit 1
      ;;
    *)
      TARGET_SERVICES+=("${arg}")
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

if [[ "${#TARGET_SERVICES[@]}" -gt 0 ]]; then
  echo "==> Target services: ${TARGET_SERVICES[*]}"
fi

if [[ "${SKIP_PULL}" != "1" ]]; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "==> Skipping git pull (--no-pull)"
fi

if [[ -z "${NEXT_PUBLIC_APP_RELEASE_TAG:-}" ]]; then
  APP_RELEASE_TAG="$(git describe --tags --exact-match 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || true)"
  if [[ -n "${APP_RELEASE_TAG}" ]]; then
    export NEXT_PUBLIC_APP_RELEASE_TAG="${APP_RELEASE_TAG}"
    echo "==> Web release tag: ${NEXT_PUBLIC_APP_RELEASE_TAG}"
  else
    echo "==> Web release tag: not set (using app fallback)"
  fi
else
  echo "==> Web release tag: ${NEXT_PUBLIC_APP_RELEASE_TAG} (from environment)"
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

# Position Copilot account reads are part of the current read-only release.
# The explicit shell value wins over an older persisted .env.prod value. An
# operator can still close the gate for a rollback by exporting false.
export AI_AGENT_ACCOUNT_READS_ENABLED="${AI_AGENT_ACCOUNT_READS_ENABLED:-true}"
echo "==> Agent account reads: ${AI_AGENT_ACCOUNT_READS_ENABLED}"
export AI_POSITION_COPILOT_ENABLED="${AI_POSITION_COPILOT_ENABLED:-true}"
export AI_POSITION_MONITORING_ENABLED="${AI_POSITION_MONITORING_ENABLED:-true}"
echo "==> Position Copilot: ${AI_POSITION_COPILOT_ENABLED}"
echo "==> Position monitoring: ${AI_POSITION_MONITORING_ENABLED}"

if [[ "${#TARGET_SERVICES[@]}" -gt 0 ]]; then
  mapfile -t AVAILABLE_SERVICES < <(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --services)
  for service in "${TARGET_SERVICES[@]}"; do
    found="0"
    for available in "${AVAILABLE_SERVICES[@]}"; do
      if [[ "${available}" == "${service}" ]]; then
        found="1"
        break
      fi
    done
    if [[ "${found}" != "1" ]]; then
      echo "Unknown compose service: ${service}"
      echo "Available services: ${AVAILABLE_SERVICES[*]}"
      exit 1
    fi
  done
fi

echo "==> Deploying containers"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans "${TARGET_SERVICES[@]}"

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

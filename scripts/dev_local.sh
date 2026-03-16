#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
WITH_RUNNER=0

for arg in "$@"; do
  case "$arg" in
    --with-runner)
      WITH_RUNNER=1
      ;;
    *)
      echo "[dev_local] unknown argument: $arg" >&2
      echo "[dev_local] supported arguments: --with-runner" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

cleanup() {
  local exit_code=$?
  if [[ -n "${RUNNER_PID:-}" ]] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    kill "$RUNNER_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  wait ${RUNNER_PID:-} ${WEB_PID:-} ${API_PID:-} 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

ensure_port_free() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[dev_local] port $port is still in use." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    echo "[dev_local] please stop the conflicting local process and run the script again." >&2
    exit 1
  fi
}

echo "[dev_local] stopping docker app containers (api/web/runner) to free local ports"
docker compose -f "$COMPOSE_FILE" stop api web runner >/dev/null 2>&1 || true

echo "[dev_local] ensuring local infra is up (postgres, redis, py-strategy-service)"
docker compose -f "$COMPOSE_FILE" up -d postgres redis py-strategy-service >/dev/null

echo "[dev_local] waiting for postgres"
for _ in $(seq 1 30); do
  if docker exec -i uliquid-desk-postgres-1 pg_isready -U mm -d mm >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[dev_local] waiting for redis"
for _ in $(seq 1 30); do
  if docker exec -i uliquid-desk-redis-1 redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[dev_local] waiting for py-strategy-service"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

ensure_port_free 3000
ensure_port_free 4000
if [[ "$WITH_RUNNER" = "1" ]]; then
  ensure_port_free 8091
fi

echo "[dev_local] generating prisma client"
node node_modules/prisma/build/index.js generate >/dev/null

echo "[dev_local] applying migrations to local dev db"
ENV_FILE=""
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
elif [[ -f "$ROOT_DIR/.env.local" ]]; then
  ENV_FILE="$ROOT_DIR/.env.local"
else
  echo "[dev_local] missing local env file. Create .env from .env.example before running this script." >&2
  exit 1
fi
set -a
source "$ENV_FILE"
set +a
node node_modules/prisma/build/index.js migrate deploy >/dev/null

echo "[dev_local] starting local api on http://localhost:4000"
npm -w apps/api run dev &
API_PID=$!

echo "[dev_local] starting local web on http://localhost:3000"
npm -w apps/web run dev &
WEB_PID=$!

if [[ "$WITH_RUNNER" = "1" ]]; then
  echo "[dev_local] starting local runner"
  npm -w apps/runner run dev &
  RUNNER_PID=$!
fi

echo "[dev_local] waiting for api health"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[dev_local] waiting for web"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null -I http://127.0.0.1:3000/; then
    break
  fi
  sleep 1
done

echo "[dev_local] local stack is ready"
echo "[dev_local] web:  http://localhost:3000"
echo "[dev_local] api:  http://localhost:4000/health"
if [[ "$WITH_RUNNER" = "1" ]]; then
  echo "[dev_local] runner health: http://localhost:8091/health"
fi
echo "[dev_local] press Ctrl+C to stop local processes"

wait ${RUNNER_PID:-} "$WEB_PID" "$API_PID"

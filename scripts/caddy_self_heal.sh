#!/usr/bin/env bash
set -euo pipefail

LOG_TAG="utrade-caddy-self-heal"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

log() {
  logger -t "${LOG_TAG}" -- "$*"
  echo "${LOG_TAG}: $*"
}

ports_healthy() {
  ss -ltn | awk '{print $4}' | grep -Eq '(:80|:443)$'
}

service_healthy() {
  systemctl is-active --quiet caddy
}

restart_caddy() {
  if [[ -f "${CADDYFILE}" ]]; then
    if ! caddy validate --config "${CADDYFILE}" --adapter caddyfile >/dev/null 2>&1; then
      log "caddy config validation failed; skipping restart"
      return 1
    fi
  fi
  log "restarting caddy"
  systemctl restart caddy
  sleep 2
  return 0
}

main() {
  local needs_restart="0"

  if ! service_healthy; then
    log "caddy service is inactive"
    needs_restart="1"
  fi

  if ! ports_healthy; then
    log "caddy ports 80/443 are not listening"
    needs_restart="1"
  fi

  if [[ "${needs_restart}" != "1" ]]; then
    log "caddy healthy"
    exit 0
  fi

  if ! restart_caddy; then
    exit 1
  fi

  if service_healthy && ports_healthy; then
    log "caddy recovered successfully"
    exit 0
  fi

  log "caddy still unhealthy after restart"
  exit 1
}

main "$@"

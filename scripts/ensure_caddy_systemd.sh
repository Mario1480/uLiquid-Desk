#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_PRESENT="0"

if command -v snap >/dev/null 2>&1 && snap list caddy >/dev/null 2>&1; then
  SNAP_PRESENT="1"
fi

if [[ "${SNAP_PRESENT}" == "1" ]]; then
  echo "==> Snap-Caddy detected; migrating to apt + systemd"
  COPY_STATE="${COPY_STATE:-1}" REMOVE_SNAP="${REMOVE_SNAP:-1}" \
    "${ROOT_DIR}/scripts/migrate_snap_caddy.sh"
  exit 0
fi

if [[ ! -f /etc/caddy/Caddyfile ]] && ! command -v caddy >/dev/null 2>&1; then
  echo "==> No existing Caddy install/config detected; skipping"
  exit 0
fi

echo "==> Ensuring official apt-managed Caddy"
"${ROOT_DIR}/scripts/install_caddy_apt.sh"

echo "==> Installing self-heal assets"
install -m 0755 "${ROOT_DIR}/scripts/caddy_self_heal.sh" /usr/local/bin/caddy-self-heal.sh
install -m 0644 "${ROOT_DIR}/infra/systemd/caddy-self-heal.service" /etc/systemd/system/caddy-self-heal.service
install -m 0644 "${ROOT_DIR}/infra/systemd/caddy-self-heal.timer" /etc/systemd/system/caddy-self-heal.timer
systemctl daemon-reload
systemctl enable --now caddy-self-heal.timer

if [[ -f /etc/caddy/Caddyfile ]]; then
  echo "==> Formatting, validating and reloading Caddy"
  caddy fmt --overwrite /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl enable --now caddy
  systemctl reload caddy || systemctl restart caddy
fi

echo "==> Caddy ensure complete"

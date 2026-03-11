#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_CADDY_DIR="/var/snap/caddy/common"
BACKUP_DIR="/root/caddy-snap-backup-$(date +%Y%m%d-%H%M%S)"
COPY_STATE="${COPY_STATE:-1}"
REMOVE_SNAP="${REMOVE_SNAP:-1}"

echo "==> Backing up existing Snap-Caddy data to ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"
if [[ -d "${SNAP_CADDY_DIR}" ]]; then
  cp -a "${SNAP_CADDY_DIR}" "${BACKUP_DIR}/common"
fi
if [[ -d /var/snap/caddy/current ]]; then
  cp -a /var/snap/caddy/current "${BACKUP_DIR}/current"
fi

if [[ -x /snap/bin/caddy && -f "${SNAP_CADDY_DIR}/Caddyfile" ]]; then
  echo "==> Validating existing Snap Caddyfile before migration"
  /snap/bin/caddy validate --config "${SNAP_CADDY_DIR}/Caddyfile" --adapter caddyfile || true
fi

"${ROOT_DIR}/scripts/install_caddy_apt.sh"

mkdir -p /etc/caddy

if [[ -f "${SNAP_CADDY_DIR}/Caddyfile" ]]; then
  echo "==> Migrating Caddyfile to /etc/caddy/Caddyfile"
  cp "${SNAP_CADDY_DIR}/Caddyfile" /etc/caddy/Caddyfile
elif [[ ! -f /etc/caddy/Caddyfile ]]; then
  cat >/etc/caddy/Caddyfile <<'EOF'
:80 {
	respond "Caddy installed. Configure /etc/caddy/Caddyfile." 200
}
EOF
fi

echo "==> Formatting and validating /etc/caddy/Caddyfile"
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

if [[ "${COPY_STATE}" == "1" && -d "${SNAP_CADDY_DIR}" ]]; then
  echo "==> Attempting best-effort certificate/state migration"
  install -d -m 0750 -o caddy -g caddy /var/lib/caddy/.local/share/caddy
  for dir in certificates ocsp pki; do
    if [[ -d "${SNAP_CADDY_DIR}/${dir}" ]]; then
      mkdir -p "/var/lib/caddy/.local/share/caddy/${dir}"
      cp -a "${SNAP_CADDY_DIR}/${dir}/." "/var/lib/caddy/.local/share/caddy/${dir}/"
    fi
  done
  chown -R caddy:caddy /var/lib/caddy
fi

echo "==> Enabling and starting systemd-managed Caddy"
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Installing self-heal script and timer"
install -m 0755 "${ROOT_DIR}/scripts/caddy_self_heal.sh" /usr/local/bin/caddy-self-heal.sh
install -m 0644 "${ROOT_DIR}/infra/systemd/caddy-self-heal.service" /etc/systemd/system/caddy-self-heal.service
install -m 0644 "${ROOT_DIR}/infra/systemd/caddy-self-heal.timer" /etc/systemd/system/caddy-self-heal.timer
systemctl daemon-reload
systemctl enable --now caddy-self-heal.timer

if snap list caddy >/dev/null 2>&1; then
  echo "==> Stopping Snap-Caddy"
  snap stop caddy.server || true
  snap disable caddy.server || true
  if [[ "${REMOVE_SNAP}" == "1" ]]; then
    echo "==> Removing Snap-Caddy"
    snap remove caddy || true
  fi
fi

echo "==> Final status"
systemctl --no-pager --full status caddy || true
systemctl --no-pager --full status caddy-self-heal.timer || true
ss -ltn | grep -E '(:80|:443)' || true

echo "==> Done"
echo "Backup: ${BACKUP_DIR}"
echo "Logs: journalctl -u caddy -n 120 --no-pager"

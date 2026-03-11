#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

echo "==> Installing official Caddy apt repository"
apt-get update -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
chmod 0644 /etc/apt/keyrings/caddy-stable.gpg

cat >/etc/apt/sources.list.d/caddy-stable.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main
EOF

echo "==> Installing Caddy"
apt-get update -y
apt-get install -y caddy

systemctl enable --now caddy
systemctl status caddy --no-pager || true

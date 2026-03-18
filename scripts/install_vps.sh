#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

REPO_URL_DEFAULT="https://github.com/Mario1480/uLiquid-Desk.git"
APP_DIR_DEFAULT="/opt/uliquid-desk"
WEB_DOMAIN_DEFAULT="desk.uliquid.vip"
API_DOMAIN_DEFAULT="api.desk.uliquid.vip"
INVITE_BASE_URL_DEFAULT="https://desk.uliquid.vip"
SMTP_HOST_DEFAULT="smtp.hostinger.com"
SMTP_PORT_DEFAULT="465"
SMTP_USER_DEFAULT="no-reply@uliquid.vip"
SMTP_FROM_DEFAULT='"uLiquid <no-reply@uliquid.vip>"'

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN {
      done = 0
      prefix = key "="
    }
    index($0, prefix) == 1 {
      print prefix value
      done = 1
      next
    }
    {
      print
    }
    END {
      if (!done) {
        print prefix value
      }
    }
  ' "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

read -r -p "Repo URL [${REPO_URL_DEFAULT}]: " REPO_URL
REPO_URL="${REPO_URL:-${REPO_URL_DEFAULT}}"
read -r -p "Install dir [${APP_DIR_DEFAULT}]: " APP_DIR
APP_DIR="${APP_DIR:-${APP_DIR_DEFAULT}}"

read -r -p "Web domain [${WEB_DOMAIN_DEFAULT}]: " WEB_DOMAIN
WEB_DOMAIN="${WEB_DOMAIN:-${WEB_DOMAIN_DEFAULT}}"
read -r -p "API domain [${API_DOMAIN_DEFAULT}]: " API_DOMAIN
API_DOMAIN="${API_DOMAIN:-${API_DOMAIN_DEFAULT}}"
read -r -p "Invite base URL [${INVITE_BASE_URL_DEFAULT}]: " INVITE_BASE_URL
INVITE_BASE_URL="${INVITE_BASE_URL:-${INVITE_BASE_URL_DEFAULT}}"
read -r -s -p "SMTP password for ${SMTP_USER_DEFAULT} (blank = set later): " SMTP_PASS
echo

read -r -p "AI provider (disabled/openai/ollama) [disabled]: " AI_PROVIDER
AI_PROVIDER="${AI_PROVIDER:-disabled}"
read -r -s -p "AI API key (blank = set later): " AI_API_KEY
echo
AI_MODEL_DEFAULT="gpt-4o-mini"
if [[ "${AI_PROVIDER}" == "ollama" ]]; then
  AI_MODEL_DEFAULT="qwen3:8b"
fi
read -r -p "AI model [${AI_MODEL_DEFAULT}]: " AI_MODEL
AI_MODEL="${AI_MODEL:-${AI_MODEL_DEFAULT}}"
SALAD_OPENAI_UPSTREAM_HOST_DEFAULT="beet-ambrosia-una2kb4n1u45see3.salad.cloud"
SALAD_OPENAI_UPSTREAM_HOST=""
if [[ "${AI_PROVIDER}" == "ollama" ]]; then
  read -r -p "Salad upstream host [${SALAD_OPENAI_UPSTREAM_HOST_DEFAULT}]: " SALAD_OPENAI_UPSTREAM_HOST
  SALAD_OPENAI_UPSTREAM_HOST="${SALAD_OPENAI_UPSTREAM_HOST:-${SALAD_OPENAI_UPSTREAM_HOST_DEFAULT}}"
fi
read -r -p "AI timeout ms [8000]: " AI_TIMEOUT_MS
AI_TIMEOUT_MS="${AI_TIMEOUT_MS:-8000}"
read -r -p "AI explainer max tokens [1400]: " AI_EXPLAINER_MAX_TOKENS
AI_EXPLAINER_MAX_TOKENS="${AI_EXPLAINER_MAX_TOKENS:-1400}"
read -r -p "AI explainer retry max tokens [2200]: " AI_EXPLAINER_RETRY_MAX_TOKENS
AI_EXPLAINER_RETRY_MAX_TOKENS="${AI_EXPLAINER_RETRY_MAX_TOKENS:-2200}"
read -r -p "AI cache TTL seconds [300]: " AI_CACHE_TTL_SEC
AI_CACHE_TTL_SEC="${AI_CACHE_TTL_SEC:-300}"
read -r -p "AI rate limit per min [60]: " AI_RATE_LIMIT_PER_MIN
AI_RATE_LIMIT_PER_MIN="${AI_RATE_LIMIT_PER_MIN:-60}"

read -r -s -p "Telegram bot token (blank = set in UI later): " TELEGRAM_BOT_TOKEN
echo
read -r -p "Telegram chat id (blank = set in UI later): " TELEGRAM_CHAT_ID

read -r -p "License enforcement (on/off) [off]: " LICENSE_ENFORCEMENT
LICENSE_ENFORCEMENT="${LICENSE_ENFORCEMENT:-off}"
read -r -p "License stub enabled (on/off) [on]: " LICENSE_STUB_ENABLED
LICENSE_STUB_ENABLED="${LICENSE_STUB_ENABLED:-on}"
read -r -p "License server URL [https://license-server.uliquid.vip]: " LICENSE_SERVER_URL
LICENSE_SERVER_URL="${LICENSE_SERVER_URL:-https://license-server.uliquid.vip}"

read -r -p "Bitget product type [USDT-FUTURES]: " BITGET_PRODUCT_TYPE
BITGET_PRODUCT_TYPE="${BITGET_PRODUCT_TYPE:-USDT-FUTURES}"
read -r -p "Bitget margin coin [USDT]: " BITGET_MARGIN_COIN
BITGET_MARGIN_COIN="${BITGET_MARGIN_COIN:-USDT}"

read -r -p "WalletConnect Project ID (optional, for Web3Modal): " NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

read -r -p "SECRET_MASTER_KEY (blank = auto-generate 64 hex chars): " SECRET_MASTER_KEY
if [[ -z "${SECRET_MASTER_KEY}" ]]; then
  SECRET_MASTER_KEY="$(openssl rand -hex 32)"
fi

if [[ "${AI_PROVIDER}" != "disabled" && "${AI_PROVIDER}" != "openai" && "${AI_PROVIDER}" != "ollama" ]]; then
  echo "AI provider must be 'disabled', 'openai' or 'ollama'."
  exit 1
fi

PY_STRATEGY_AUTH_TOKEN="$(openssl rand -hex 24)"

if [[ -n "${WEB_DOMAIN}" && -z "${API_DOMAIN}" ]]; then
  echo "If WEB_DOMAIN is set, API_DOMAIN must also be set (to avoid mixed-content auth issues)."
  exit 1
fi
if [[ -z "${WEB_DOMAIN}" && -n "${API_DOMAIN}" ]]; then
  echo "If API_DOMAIN is set, WEB_DOMAIN must also be set."
  exit 1
fi

PRIMARY_IP="$(hostname -I | awk '{print $1}')"
if [[ -z "${PRIMARY_IP}" ]]; then
  PRIMARY_IP="$(ip route get 1.1.1.1 | awk '{print $7; exit}')"
fi

WEB_ORIGIN="${WEB_DOMAIN:+https://${WEB_DOMAIN}}"
API_PUBLIC_URL="${API_DOMAIN:+https://${API_DOMAIN}}"
if [[ -z "${WEB_ORIGIN}" ]]; then
  WEB_ORIGIN="http://${PRIMARY_IP}:3000"
fi
if [[ -z "${API_PUBLIC_URL}" ]]; then
  API_PUBLIC_URL="http://${PRIMARY_IP}:8080"
fi
if [[ -z "${INVITE_BASE_URL}" ]]; then
  INVITE_BASE_URL="${WEB_ORIGIN}"
fi

COOKIE_SECURE_VALUE="true"
SIWE_ALLOWED_DOMAINS_VALUE="${WEB_DOMAIN}"
if [[ -z "${WEB_DOMAIN}" ]]; then
  COOKIE_SECURE_VALUE="false"
  SIWE_ALLOWED_DOMAINS_VALUE=""
fi

COOKIE_DOMAIN_VALUE=""
if [[ -n "${WEB_DOMAIN}" ]]; then
  WEB_DOMAIN_CLEAN="${WEB_DOMAIN#.}"
  BASE_COOKIE_DOMAIN="$(echo "${WEB_DOMAIN_CLEAN}" | awk -F. '{ if (NF >= 2) print $(NF-1)"."$NF; else print "" }')"
  if [[ -n "${BASE_COOKIE_DOMAIN}" ]]; then
    COOKIE_DOMAIN_VALUE=".${BASE_COOKIE_DOMAIN}"
  fi
fi

echo "==> Installing system dependencies"
apt update -y
apt install -y curl ca-certificates gnupg unzip git ufw openssl debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> Cloning repo to ${APP_DIR}"
if [[ "${APP_DIR}" == "/" || "${APP_DIR}" == "/opt" || "${APP_DIR}" == "/root" ]]; then
  echo "Refusing unsafe APP_DIR: ${APP_DIR}"
  exit 1
fi
rm -rf "${APP_DIR}"
mkdir -p "$(dirname "${APP_DIR}")"
git clone --depth 1 "${REPO_URL}" "${APP_DIR}"

if [[ ! -f "${APP_DIR}/.env.prod.example" ]]; then
  echo "Missing template: ${APP_DIR}/.env.prod.example"
  exit 1
fi

echo "==> Preparing .env.prod from template"
cp "${APP_DIR}/.env.prod.example" "${APP_DIR}/.env.prod"

set_env_value "${APP_DIR}/.env.prod" "DATABASE_URL" "postgresql://mm:mm@postgres:5432/marketmaker?schema=public"
set_env_value "${APP_DIR}/.env.prod" "NEXT_PUBLIC_API_URL" "${API_PUBLIC_URL}"
set_env_value "${APP_DIR}/.env.prod" "API_BASE_URL" "http://api:8080"
set_env_value "${APP_DIR}/.env.prod" "API_URL" "http://api:8080"
set_env_value "${APP_DIR}/.env.prod" "COOKIE_DOMAIN" "${COOKIE_DOMAIN_VALUE}"
set_env_value "${APP_DIR}/.env.prod" "COOKIE_SECURE" "${COOKIE_SECURE_VALUE}"
set_env_value "${APP_DIR}/.env.prod" "CORS_ORIGINS" "${WEB_ORIGIN}"
set_env_value "${APP_DIR}/.env.prod" "SIWE_ALLOWED_DOMAINS" "${SIWE_ALLOWED_DOMAINS_VALUE}"
set_env_value "${APP_DIR}/.env.prod" "PANEL_BASE_URL" "${WEB_ORIGIN}"
set_env_value "${APP_DIR}/.env.prod" "INVITE_BASE_URL" "${INVITE_BASE_URL}"
set_env_value "${APP_DIR}/.env.prod" "BITGET_PRODUCT_TYPE" "${BITGET_PRODUCT_TYPE}"
set_env_value "${APP_DIR}/.env.prod" "BITGET_MARGIN_COIN" "${BITGET_MARGIN_COIN}"
set_env_value "${APP_DIR}/.env.prod" "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}"
set_env_value "${APP_DIR}/.env.prod" "AI_PROVIDER" "${AI_PROVIDER}"
set_env_value "${APP_DIR}/.env.prod" "AI_API_KEY" "${AI_API_KEY}"
set_env_value "${APP_DIR}/.env.prod" "AI_MODEL" "${AI_MODEL}"
set_env_value "${APP_DIR}/.env.prod" "SALAD_OPENAI_UPSTREAM_HOST" "${SALAD_OPENAI_UPSTREAM_HOST}"
set_env_value "${APP_DIR}/.env.prod" "AI_TIMEOUT_MS" "${AI_TIMEOUT_MS}"
set_env_value "${APP_DIR}/.env.prod" "AI_EXPLAINER_MAX_TOKENS" "${AI_EXPLAINER_MAX_TOKENS}"
set_env_value "${APP_DIR}/.env.prod" "AI_EXPLAINER_RETRY_MAX_TOKENS" "${AI_EXPLAINER_RETRY_MAX_TOKENS}"
set_env_value "${APP_DIR}/.env.prod" "AI_CACHE_TTL_SEC" "${AI_CACHE_TTL_SEC}"
set_env_value "${APP_DIR}/.env.prod" "AI_RATE_LIMIT_PER_MIN" "${AI_RATE_LIMIT_PER_MIN}"
set_env_value "${APP_DIR}/.env.prod" "PY_STRATEGY_AUTH_TOKEN" "${PY_STRATEGY_AUTH_TOKEN}"
set_env_value "${APP_DIR}/.env.prod" "LICENSE_ENFORCEMENT" "${LICENSE_ENFORCEMENT}"
set_env_value "${APP_DIR}/.env.prod" "LICENSE_STUB_ENABLED" "${LICENSE_STUB_ENABLED}"
set_env_value "${APP_DIR}/.env.prod" "LICENSE_SERVER_URL" "${LICENSE_SERVER_URL}"
set_env_value "${APP_DIR}/.env.prod" "SMTP_HOST" "${SMTP_HOST_DEFAULT}"
set_env_value "${APP_DIR}/.env.prod" "SMTP_PORT" "${SMTP_PORT_DEFAULT}"
set_env_value "${APP_DIR}/.env.prod" "SMTP_USER" "${SMTP_USER_DEFAULT}"
set_env_value "${APP_DIR}/.env.prod" "SMTP_PASS" "${SMTP_PASS}"
set_env_value "${APP_DIR}/.env.prod" "SMTP_FROM" "${SMTP_FROM_DEFAULT}"
set_env_value "${APP_DIR}/.env.prod" "TELEGRAM_BOT_TOKEN" "${TELEGRAM_BOT_TOKEN}"
set_env_value "${APP_DIR}/.env.prod" "TELEGRAM_CHAT_ID" "${TELEGRAM_CHAT_ID}"
set_env_value "${APP_DIR}/.env.prod" "SECRET_MASTER_KEY" "${SECRET_MASTER_KEY}"
set_env_value "${APP_DIR}/.env.prod" "MEXC_SPOT_ENABLED" "0"
set_env_value "${APP_DIR}/.env.prod" "MEXC_PERP_ENABLED" "0"
set_env_value "${APP_DIR}/.env.prod" "BINANCE_SPOT_ENABLED" "0"
set_env_value "${APP_DIR}/.env.prod" "BINANCE_PERP_ENABLED" "0"

echo "==> Syncing .env.prod with latest prod template keys"
"${APP_DIR}/scripts/sync_env_files.sh" --target "${APP_DIR}/.env.prod" --root "${APP_DIR}"

# Optional: keep .env in sync for troubleshooting/dev tooling
cp "${APP_DIR}/.env.prod" "${APP_DIR}/.env"

echo "==> Installing Caddy (optional HTTPS)"
if [[ -n "${WEB_DOMAIN}" && -n "${API_DOMAIN}" ]]; then
  "${APP_DIR}/scripts/install_caddy_apt.sh"

  cat > /etc/caddy/Caddyfile <<EOF
${WEB_DOMAIN} {
  reverse_proxy 127.0.0.1:3000
}

${API_DOMAIN} {
  reverse_proxy 127.0.0.1:8080
}
EOF

  caddy fmt --overwrite /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl enable --now caddy
  systemctl reload caddy

  echo "==> Installing Caddy self-heal timer"
  install -m 0755 "${APP_DIR}/scripts/caddy_self_heal.sh" /usr/local/bin/caddy-self-heal.sh
  install -m 0644 "${APP_DIR}/infra/systemd/caddy-self-heal.service" /etc/systemd/system/caddy-self-heal.service
  install -m 0644 "${APP_DIR}/infra/systemd/caddy-self-heal.timer" /etc/systemd/system/caddy-self-heal.timer
  systemctl daemon-reload
  systemctl enable --now caddy-self-heal.timer
else
  echo "Skipping Caddy setup (domains not provided)."
fi

echo "==> Starting services"
cd "${APP_DIR}"
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build --remove-orphans

echo "==> Done"
echo "App dir: ${APP_DIR}"
echo "Web: ${WEB_ORIGIN}"
echo "API health: ${API_PUBLIC_URL}/health"
echo "Telegram settings can also be changed in UI: /settings/notifications"

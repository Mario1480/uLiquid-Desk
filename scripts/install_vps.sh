#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

REPO_URL_DEFAULT="https://github.com/Mario1480/uTrade-Bots.git"
APP_DIR_DEFAULT="/opt/utrade-bots"

read -r -p "Repo URL [${REPO_URL_DEFAULT}]: " REPO_URL
REPO_URL="${REPO_URL:-${REPO_URL_DEFAULT}}"
read -r -p "Install dir [${APP_DIR_DEFAULT}]: " APP_DIR
APP_DIR="${APP_DIR:-${APP_DIR_DEFAULT}}"

read -r -p "Web domain (e.g. app.example.com, blank = HTTP only): " WEB_DOMAIN
read -r -p "API domain (e.g. api.example.com, blank = HTTP only): " API_DOMAIN
read -r -p "Invite base URL (blank = auto from web domain/ip): " INVITE_BASE_URL
read -r -s -p "SMTP password for no-reply@uliquid.vip (blank = set later): " SMTP_PASS
echo

read -r -p "AI provider (none/openai) [none]: " AI_PROVIDER
AI_PROVIDER="${AI_PROVIDER:-none}"
read -r -s -p "AI API key (blank = set later): " AI_API_KEY
echo
read -r -p "AI model [gpt-4o-mini]: " AI_MODEL
AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
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
if [[ -z "${WEB_DOMAIN}" ]]; then
  COOKIE_SECURE_VALUE="false"
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

echo "==> Writing .env.prod"
cat > "${APP_DIR}/.env.prod" <<EOF
NODE_ENV=production

DATABASE_URL=postgresql://mm:mm@postgres:5432/marketmaker

NEXT_PUBLIC_API_URL=${API_PUBLIC_URL}
API_BASE_URL=http://api:8080
API_URL=http://api:8080
NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID=999
NEXT_PUBLIC_HYPEREVM_RPC_URL=https://rpc.hyperliquid.xyz/evm
NEXT_PUBLIC_HYPEREVM_EXPLORER_URL=https://app.hyperliquid.xyz/explorer
NEXT_PUBLIC_USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f
USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f
NEXT_PUBLIC_ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
NEXT_PUBLIC_ARBITRUM_EXPLORER_URL=https://arbiscan.io
NEXT_PUBLIC_ARBITRUM_USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
ARBITRUM_USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
NEXT_PUBLIC_HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid.xyz
HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid.xyz
NEXT_PUBLIC_HYPERLIQUID_SYSTEM_ADDRESS=0x2222222222222222222222222222222222222222
HYPERLIQUID_SYSTEM_ADDRESS=0x2222222222222222222222222222222222222222
NEXT_PUBLIC_HYPERLIQUID_DEPOSIT_URL=https://app.hyperliquid.xyz/trade
HYPERLIQUID_DEPOSIT_URL=https://app.hyperliquid.xyz/trade
NEXT_PUBLIC_HYPERLIQUID_CORE_EVM_TRANSFER_URL=https://app.hyperliquid.xyz/portfolio
HYPERLIQUID_CORE_EVM_TRANSFER_URL=https://app.hyperliquid.xyz/portfolio
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
NEXT_PUBLIC_WEB3_ENABLE_ARBITRUM=1
CONTRACTS_RPC_URL=https://rpc.hyperliquid.xyz/evm
CONTRACTS_CHAIN_ID=999
CONTRACTS_FORGE_BROADCAST_ARGS=--legacy
CONTRACTS_DEPLOY_OWNER=
CONTRACTS_USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f
CONTRACTS_PRIVATE_KEY=
VAULT_EXECUTION_MODE=offchain_shadow
VAULT_ONCHAIN_CHAIN_ID=999
VAULT_ONCHAIN_RPC_URL=https://rpc.hyperliquid.xyz/evm
VAULT_ONCHAIN_FACTORY_ADDRESS=
VAULT_ONCHAIN_USDC_ADDRESS=0xb88339CB7199b77E23DB6E890353E22632Ba630f
VAULT_ONCHAIN_CONFIRMATIONS=2
VAULT_ONCHAIN_START_BLOCK=0
VAULT_ONCHAIN_INDEXER_MIN_BLOCK_SPAN=25
VAULT_ONCHAIN_INDEXER_RATE_LIMIT_BACKOFF_SECONDS=45
VAULT_ONCHAIN_INDEXER_RATE_LIMIT_MAX_SECONDS=300

COOKIE_DOMAIN=${COOKIE_DOMAIN_VALUE}
COOKIE_SECURE=${COOKIE_SECURE_VALUE}

CORS_ORIGINS=${WEB_ORIGIN},http://localhost:3000

BITGET_REST_BASE_URL=https://api.bitget.com
BITGET_PRODUCT_TYPE=${BITGET_PRODUCT_TYPE}
BITGET_MARGIN_COIN=${BITGET_MARGIN_COIN}

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@uliquid.vip
SMTP_PASS=${SMTP_PASS}
SMTP_FROM="uLiquid <no-reply@uliquid.vip>"
SMTP_SECURE=true
INVITE_BASE_URL=${INVITE_BASE_URL}

# AI
AI_PROVIDER=${AI_PROVIDER}
AI_API_KEY=${AI_API_KEY}
AI_MODEL=${AI_MODEL}
AI_TIMEOUT_MS=${AI_TIMEOUT_MS}
AI_EXPLAINER_MAX_TOKENS=${AI_EXPLAINER_MAX_TOKENS}
AI_EXPLAINER_RETRY_MAX_TOKENS=${AI_EXPLAINER_RETRY_MAX_TOKENS}
AI_GPT5_EXPLAINER_MAX_TOKENS=3200
AI_GPT5_EXPLAINER_RETRY_MAX_TOKENS=5200
AI_GPT5_EXPLAINER_MAX_ATTEMPTS=3
AI_GPT5_EXPLAINER_FINAL_MAX_TOKENS=8320
AI_CACHE_TTL_SEC=${AI_CACHE_TTL_SEC}
AI_RATE_LIMIT_PER_MIN=${AI_RATE_LIMIT_PER_MIN}
PREDICTION_AUTO_ENABLED=1
PREDICTION_AUTO_POLL_SECONDS=60
PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT=300
PREDICTION_AUTO_MAX_RUNS_PER_CYCLE=25
PREDICTION_OUTCOME_HORIZON_BARS=12
PREDICTION_OUTCOME_EVAL_ENABLED=1
PREDICTION_OUTCOME_EVAL_POLL_SECONDS=60
PREDICTION_OUTCOME_EVAL_BATCH_SIZE=50
PY_STRATEGY_AUTH_TOKEN=${PY_STRATEGY_AUTH_TOKEN}

ORCHESTRATION_MODE=queue
REDIS_URL=redis://redis:6379
QUEUE_PREFIX=utradevip
BOT_QUEUE_NAME=bots
WORKER_CONCURRENCY=10
WORKER_LOCK_DURATION_MS=60000
WORKER_STALLED_INTERVAL_MS=30000
WORKER_MAX_STALLED_COUNT=2
BOT_RATE_LIMIT_MAX=50
BOT_RATE_LIMIT_DURATION_MS=1000
BOT_JOB_ATTEMPTS=5
BOT_JOB_BACKOFF_MS=1000

GLOBAL_TRADING_ENABLED=true
BOT_CB_MAX_ERRORS=5
BOT_CB_WINDOW_SECONDS=300
BOT_CB_COOLDOWN_SECONDS=900
BOT_CB_ACTION=stop

LICENSE_ENFORCEMENT=${LICENSE_ENFORCEMENT}
LICENSE_STUB_ENABLED=${LICENSE_STUB_ENABLED}
LICENSE_SERVER_URL=${LICENSE_SERVER_URL}
LICENSE_CACHE_TTL_SECONDS=600
LICENSE_STUB_MAX_RUNNING_BOTS=3
LICENSE_STUB_MAX_BOTS_TOTAL=10
LICENSE_STUB_ALLOWED_EXCHANGES=bitget

SECRET_MASTER_KEY=${SECRET_MASTER_KEY}

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
EOF

echo "==> Syncing .env.prod with latest template keys"
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

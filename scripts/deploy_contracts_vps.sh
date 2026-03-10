#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODE="devnet"
ENV_FILE="${REPO_ROOT}/.env.prod"
APP_DIR="${REPO_ROOT}"
INSTALL_FOUNDRY="0"
INSTALL_NPM_DEPS="0"
DRY_RUN="0"

usage() {
  cat <<'EOF'
Deploy contracts from VPS with Foundry (npm workspace wrapper).

Usage:
  scripts/deploy_contracts_vps.sh [options]

Options:
  --mode <devnet|local>       Deploy mode (default: devnet)
  --env-file <path>           Env file to source (default: .env.prod in repo root)
  --app-dir <path>            Repo root path (default: script-relative root)
  --install-foundry           Install Foundry if forge is missing
  --install-npm-deps          Run npm workspace install before deploy
  --dry-run                   Print resolved command/env and exit
  -h, --help                  Show this help

Env resolution order:
  RPC_URL      <- CONTRACTS_RPC_URL      <- RPC_URL
  PRIVATE_KEY  <- CONTRACTS_PRIVATE_KEY  <- PRIVATE_KEY
  USDC_ADDRESS <- CONTRACTS_USDC_ADDRESS <- USDC_ADDRESS
  DEPLOY_OWNER <- CONTRACTS_DEPLOY_OWNER <- DEPLOY_OWNER (optional)
  CHAIN_ID     <- CONTRACTS_CHAIN_ID     <- CHAIN_ID (default: 999 for devnet, 31337 for local)
  FORGE_BROADCAST_ARGS <- CONTRACTS_FORGE_BROADCAST_ARGS <- FORGE_BROADCAST_ARGS

Examples:
  scripts/deploy_contracts_vps.sh --mode devnet --env-file .env.prod
  scripts/deploy_contracts_vps.sh --mode local --install-foundry
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --install-foundry)
      INSTALL_FOUNDRY="1"
      shift
      ;;
    --install-npm-deps)
      INSTALL_NPM_DEPS="1"
      shift
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "${MODE}" != "devnet" && "${MODE}" != "local" ]]; then
  echo "Invalid --mode '${MODE}'. Use 'devnet' or 'local'."
  exit 1
fi

APP_DIR="$(cd "${APP_DIR}" && pwd)"
CONTRACTS_DIR="${APP_DIR}/packages/contracts"

if [[ ! -d "${CONTRACTS_DIR}" ]]; then
  echo "Contracts workspace not found at: ${CONTRACTS_DIR}"
  exit 1
fi

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed."
  exit 1
fi

export PATH="${HOME}/.foundry/bin:${PATH}"
if ! command -v forge >/dev/null 2>&1; then
  if [[ "${INSTALL_FOUNDRY}" == "1" ]]; then
    echo "forge not found. Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash
    "${HOME}/.foundry/bin/foundryup"
  else
    echo "forge not found. Re-run with --install-foundry or install manually via foundryup."
    exit 1
  fi
fi

if [[ "${INSTALL_NPM_DEPS}" == "1" ]]; then
  (cd "${APP_DIR}" && npm install --workspaces --include-workspace-root --legacy-peer-deps)
fi

RPC_URL="${CONTRACTS_RPC_URL:-${RPC_URL:-}}"
PRIVATE_KEY="${CONTRACTS_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
USDC_ADDRESS="${CONTRACTS_USDC_ADDRESS:-${USDC_ADDRESS:-}}"
DEPLOY_OWNER="${CONTRACTS_DEPLOY_OWNER:-${DEPLOY_OWNER:-}}"
FORGE_BROADCAST_ARGS="${CONTRACTS_FORGE_BROADCAST_ARGS:-${FORGE_BROADCAST_ARGS:-}}"

if [[ "${MODE}" == "local" ]]; then
  export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
  export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
  export DEPLOY_OWNER="${DEPLOY_OWNER:-0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266}"
  export CHAIN_ID="${CONTRACTS_CHAIN_ID:-${CHAIN_ID:-31337}}"
  CMD=(npm -w packages/contracts run deploy:local)
else
  export RPC_URL="${RPC_URL}"
  export PRIVATE_KEY="${PRIVATE_KEY}"
  export USDC_ADDRESS="${USDC_ADDRESS}"
  export DEPLOY_OWNER="${DEPLOY_OWNER}"
  export CHAIN_ID="${CONTRACTS_CHAIN_ID:-${CHAIN_ID:-999}}"
  if [[ -z "${FORGE_BROADCAST_ARGS}" && "${CHAIN_ID}" == "999" ]]; then
    # HyperEVM RPC currently behaves more reliably with legacy fees for forge broadcasts.
    FORGE_BROADCAST_ARGS="--legacy"
  fi
  export FORGE_BROADCAST_ARGS="${FORGE_BROADCAST_ARGS}"

  if [[ -z "${RPC_URL}" ]]; then
    echo "Missing RPC_URL (or CONTRACTS_RPC_URL) for devnet deploy."
    exit 1
  fi
  if [[ -z "${PRIVATE_KEY}" ]]; then
    echo "Missing PRIVATE_KEY (or CONTRACTS_PRIVATE_KEY) for devnet deploy."
    exit 1
  fi
  if [[ -z "${USDC_ADDRESS}" ]]; then
    echo "Missing USDC_ADDRESS (or CONTRACTS_USDC_ADDRESS) for devnet deploy."
    exit 1
  fi
  CMD=(npm -w packages/contracts run deploy:devnet)
fi

echo "Contracts deploy summary:"
echo "  app_dir:      ${APP_DIR}"
echo "  contracts:    ${CONTRACTS_DIR}"
echo "  mode:         ${MODE}"
echo "  env_file:     ${ENV_FILE}"
echo "  rpc_url:      ${RPC_URL}"
echo "  chain_id:     ${CHAIN_ID}"
if [[ -n "${DEPLOY_OWNER}" ]]; then
  echo "  deploy_owner: ${DEPLOY_OWNER}"
fi
if [[ "${MODE}" == "devnet" ]]; then
  echo "  usdc_address: ${USDC_ADDRESS}"
fi
if [[ -n "${FORGE_BROADCAST_ARGS:-}" ]]; then
  echo "  forge_args:   ${FORGE_BROADCAST_ARGS}"
fi
echo "  command:      ${CMD[*]}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "Dry-run enabled. Exiting without deployment."
  exit 0
fi

(cd "${APP_DIR}" && "${CMD[@]}")

echo "Contracts deploy finished successfully."

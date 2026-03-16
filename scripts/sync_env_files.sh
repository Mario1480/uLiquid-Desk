#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_PATH=".env.prod"
TEMPLATE_PROD_PATH=".env.prod.example"
TEMPLATE_ALL_PATH=".env.example"

usage() {
  cat <<'EOF'
Sync missing env keys into target env file without overwriting existing values.

Usage:
  scripts/sync_env_files.sh [options]

Options:
  --target <path>          Target env file (default: .env.prod)
  --template-prod <path>   Prod template (default: .env.prod.example)
  --template-all <path>    Full template (default: .env.example)
  --root <path>            Repo root for resolving relative paths
  -h, --help               Show this help

Behavior:
  - Existing keys in target are kept as-is.
  - Missing keys are appended from templates.
  - For production targets like .env.prod, only the prod template is used by default.
  - For non-production targets, precedence is: --template-prod first, then --template-all.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_PATH="${2:-}"
      shift 2
      ;;
    --template-prod)
      TEMPLATE_PROD_PATH="${2:-}"
      shift 2
      ;;
    --template-all)
      TEMPLATE_ALL_PATH="${2:-}"
      shift 2
      ;;
    --root)
      ROOT_DIR="${2:-}"
      shift 2
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

ROOT_DIR="$(cd "${ROOT_DIR}" && pwd)"
cd "${ROOT_DIR}"

to_abs_path() {
  local path="$1"
  if [[ "${path}" = /* ]]; then
    echo "${path}"
  else
    echo "${ROOT_DIR}/${path}"
  fi
}

TARGET_FILE="$(to_abs_path "${TARGET_PATH}")"
TEMPLATE_PROD_FILE="$(to_abs_path "${TEMPLATE_PROD_PATH}")"
TEMPLATE_ALL_FILE="$(to_abs_path "${TEMPLATE_ALL_PATH}")"

mkdir -p "$(dirname "${TARGET_FILE}")"
if [[ ! -f "${TARGET_FILE}" ]]; then
  if [[ -f "${TEMPLATE_PROD_FILE}" ]]; then
    cp "${TEMPLATE_PROD_FILE}" "${TARGET_FILE}"
  else
    touch "${TARGET_FILE}"
  fi
fi

TEMPLATE_FILES=()
if [[ -f "${TEMPLATE_PROD_FILE}" ]]; then
  TEMPLATE_FILES+=("${TEMPLATE_PROD_FILE}")
fi

TARGET_BASENAME="$(basename "${TARGET_FILE}")"
USE_TEMPLATE_ALL="1"
if [[ "${TARGET_BASENAME}" == ".env.prod" || "${TARGET_BASENAME}" == ".env.prod."* || "${TARGET_BASENAME}" == ".env.production" ]]; then
  USE_TEMPLATE_ALL="0"
fi

if [[ "${USE_TEMPLATE_ALL}" == "1" && -f "${TEMPLATE_ALL_FILE}" ]]; then
  TEMPLATE_FILES+=("${TEMPLATE_ALL_FILE}")
fi

if [[ ${#TEMPLATE_FILES[@]} -eq 0 ]]; then
  echo "No template files found. Expected one of:"
  echo "  ${TEMPLATE_PROD_FILE}"
  echo "  ${TEMPLATE_ALL_FILE}"
  exit 1
fi

TARGET_KEYS="$(mktemp)"
CANDIDATES="$(mktemp)"
ADDITIONS="$(mktemp)"
trap 'rm -f "${TARGET_KEYS}" "${CANDIDATES}" "${ADDITIONS}"' EXIT

awk '
{
  line=$0
  if (line ~ /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/) {
    sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
    key=line
    sub(/=.*/, "", key)
    print key
  }
}
' "${TARGET_FILE}" | sort -u > "${TARGET_KEYS}"

awk '
function ltrim(s) { sub(/^[[:space:]]+/, "", s); return s }
{
  line=$0
  if (line ~ /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/) {
    line=ltrim(line)
    sub(/^(export[[:space:]]+)?/, "", line)
    key=line
    sub(/=.*/, "", key)
    if (!(key in seen)) {
      seen[key]=1
      print key "\t" line
    }
  }
}
' "${TEMPLATE_FILES[@]}" > "${CANDIDATES}"

added_count=0
while IFS=$'\t' read -r key line; do
  [[ -z "${key}" ]] && continue
  if grep -qx "${key}" "${TARGET_KEYS}"; then
    continue
  fi
  printf '%s\n' "${line}" >> "${ADDITIONS}"
  printf '%s\n' "${key}" >> "${TARGET_KEYS}"
  added_count=$((added_count + 1))
done < "${CANDIDATES}"

if [[ "${added_count}" -eq 0 ]]; then
  echo "env sync: ${TARGET_FILE} already up to date (no missing keys)."
  exit 0
fi

if [[ -s "${TARGET_FILE}" ]]; then
  printf '\n' >> "${TARGET_FILE}"
fi
{
  echo "# --- auto-added by scripts/sync_env_files.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
  cat "${ADDITIONS}"
} >> "${TARGET_FILE}"

echo "env sync: added ${added_count} missing keys to ${TARGET_FILE}."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ULIMIT="${BUILD_ROOT_ULIMIT:-8192}"

cd "$ROOT_DIR"

CURRENT_LIMIT="$(ulimit -n)"
if [ "$CURRENT_LIMIT" = "unlimited" ]; then
  CURRENT_LIMIT="$TARGET_ULIMIT"
fi

if [ "$CURRENT_LIMIT" -lt "$TARGET_ULIMIT" ] 2>/dev/null; then
  ulimit -n "$TARGET_ULIMIT" || true
fi

echo "[build_root] file descriptor limit: $(ulimit -n)"
echo "[build_root] running npm run build"
npm run build

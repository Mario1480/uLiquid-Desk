#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Build futures-exchange for workspace consumers"
npm -w packages/futures-exchange run build

echo "==> Futures exchange Vault/Grid/CoreWriter regressions"
npm -w packages/futures-exchange run test:vault-grid-corewriter

echo "==> Runner Vault/Grid/CoreWriter regressions"
npm -w apps/runner run test:vault-grid-corewriter

echo "==> API Vault/Grid/CoreWriter regressions"
npm -w apps/api run test:vault-grid-corewriter

echo "==> Vault/Grid/CoreWriter regression path complete"

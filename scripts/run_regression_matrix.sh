#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Exchange foundation"
node ./node_modules/tsx/dist/cli.mjs --test \
  packages/futures-exchange/src/factory/create-futures-adapter.test.ts \
  packages/futures-exchange/src/core/cross-exchange.contract.test.ts \
  packages/futures-exchange/src/core/retry-policy.test.ts \
  packages/futures-exchange/src/bitget/bitget-error.mapper.test.ts \
  packages/futures-exchange/src/mexc/mexc-error.mapper.test.ts

echo "==> API execution and paper"
node ./node_modules/tsx/dist/cli.mjs --test \
  apps/api/src/trading.test.ts \
  apps/api/src/paper/policy.test.ts \
  apps/api/src/exchange-sync.errors.test.ts \
  apps/api/src/manual-trading-error.test.ts \
  apps/api/src/local-strategies/pythonClient.test.ts \
  apps/api/src/local-strategies/pythonRunner.test.ts

echo "==> API grid and vaults"
node ./node_modules/tsx/dist/cli.mjs --test \
  apps/api/src/grid/pythonGridClient.test.ts \
  apps/api/src/grid/autoMargin.test.ts \
  apps/api/src/grid/autoReserveDynamic.test.ts \
  apps/api/src/vaults/executionProvider.registry.test.ts \
  apps/api/src/vaults/executionProvider.hyperliquidDemo.test.ts \
  apps/api/src/vaults/executionLifecycle.service.test.ts

echo "==> Runner shared execution paths"
node ./node_modules/tsx/dist/cli.mjs --test \
  apps/runner/src/grid/pythonGridClient.test.ts \
  apps/runner/src/prediction-copier.test.ts \
  apps/runner/src/execution/registry.test.ts \
  apps/runner/src/runtime/executionEvents.test.ts \
  apps/runner/src/runtime/predictionTradeReconciliation.test.ts \
  apps/runner/src/runtime/paperExecution.test.ts

echo "==> Regression matrix complete"

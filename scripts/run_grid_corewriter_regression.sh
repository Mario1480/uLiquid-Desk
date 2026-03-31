#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Build futures-exchange for workspace consumers"
npm -w packages/futures-exchange run build

echo "==> Futures exchange Grid/CoreWriter regressions"
npm -w packages/futures-exchange run test:grid-corewriter

echo "==> Runner Grid/CoreWriter regressions"
(
  cd apps/runner
  node ../../node_modules/tsx/dist/cli.mjs --test --test-name-pattern \
    "applyGridProtectionIntent|summarizeGridDelegatedResults|extractHyperliquidLiveOrderRefs|liveOrderMatchesLocalOpenOrder|submitted order becomes open only after HyperCore later exposes it|partial fill is processed without double counting repeated fills|cancel arriving late is modeled as delayed first and canceled once the order disappears|detects drift when a local open order is missing on HyperCore|detects drift when HyperCore shows an open order that is missing locally|monitor fallback getLiveOpenOrders does not truncate larger pending-order sets|buildVaultSnapshot returns balances, positions, and exposure|reconcile remains idempotent for repeated identical snapshots|reconcileVaultState returns snapshot and drift information together|recoverGridPendingExecutions prevents duplicate submission by adopting an existing venue order|recoverGridPendingExecutions adopts an existing venue order outside a small first page|reconcileGridOpenOrdersAgainstVenue waits one cycle before canceling orphaned grid order state|reconcileGridOpenOrdersAgainstVenue resets missed counter when delayed venue order reappears|reconcileGridOpenOrdersAgainstVenue keeps hypercore ladder orders when venue only exposes order fingerprint|reconcileGridOpenOrdersAgainstVenue matches corewriter cloid decimal against venue hex cloid|reconcileGridOpenOrdersAgainstVenue keeps corewriter orders when local and venue refs mix decimal and hex cloid variants|reconcileGridOpenOrdersAgainstVenue keeps legacy corewriter refs compatible with canonical cloid refs|reconcileGridOpenOrdersAgainstVenue exposes truly unknown venue orders for rehydration|recordGridFillSyncRecoveryState tracks failure and later recovery" \
    src/execution/futuresGridExecutionMode.test.ts \
    src/execution/hyperliquidExecutionMonitor.test.ts \
    src/execution/recovery.test.ts
)

echo "==> API Grid/CoreWriter regressions"
(
  cd apps/api
  node ../../node_modules/tsx/dist/cli.mjs --test src/grid/routes-instances.test.ts
)

echo "==> Grid/CoreWriter regression path complete"

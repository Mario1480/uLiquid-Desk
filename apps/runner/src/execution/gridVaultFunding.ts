import {
  buildHyperliquidReadKey,
  executeHyperliquidRead,
  type FundsTransferResult,
  type SupportedFuturesAdapter
} from "@mm/futures-exchange";
import type { GridPlanRequest } from "../grid/pythonGridClient.js";

const INITIAL_FUNDING_EPSILON_USD = 0.000001;

export type InitialCoreSpotDepositStatus =
  | "deposit_confirmed"
  | "deposit_pending_reconciliation"
  | "deposit_pending_timeout"
  | "deposit_submitted"
  | "deposit_failed";

type VaultBalanceReadMeta = {
  fromCache: boolean;
  stale: boolean;
  degraded: boolean;
  cacheAgeMs: number | null;
  reason: string | null;
};

export type VaultBalanceSnapshot = {
  capturedAt: string;
  equityUsd: number | null;
  availableMarginUsd: number | null;
  coreSpotBalanceUsd: number | null;
  issues: string[];
  usableForSizing: boolean;
  usableForTransfers: boolean;
  reads: {
    account: VaultBalanceReadMeta | null;
    spot: VaultBalanceReadMeta | null;
  };
};

function toNullableIso(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toPositiveNumberOrNullLoose(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function hasOpenPlannerPosition(plannerPosition: {
  side?: "long" | "short" | null;
  qty?: number | null;
} | null): boolean {
  const qty = Number(plannerPosition?.qty ?? 0);
  return Number.isFinite(qty) && qty > 0 && Boolean(plannerPosition?.side);
}

export function buildVaultBalanceExpectation(params: {
  currentStateJson: Record<string, unknown>;
  openOrdersCount: number;
  plannerPosition: {
    side?: "long" | "short" | null;
    qty?: number | null;
  } | null;
  pendingExecutions: Array<unknown>;
}) {
  const isIdleRuntime =
    params.openOrdersCount === 0
    && !hasOpenPlannerPosition(params.plannerPosition)
    && params.pendingExecutions.length === 0;
  if (!isIdleRuntime) return null;

  const closeOnlySpotToEvmDoneAt = toNullableIso(params.currentStateJson.closeOnlySpotToEvmDoneAt);
  if (closeOnlySpotToEvmDoneAt) {
    return {
      phase: "close_only_spot_to_evm_pending" as const,
      startedAt: closeOnlySpotToEvmDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.closeOnlySpotToEvmAmountUsd)
    };
  }

  const closeOnlySpotToEvmPendingAt = toNullableIso(params.currentStateJson.closeOnlySpotToEvmPendingAt);
  if (closeOnlySpotToEvmPendingAt) {
    return {
      phase: "close_only_spot_to_evm_pending" as const,
      startedAt: closeOnlySpotToEvmPendingAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.closeOnlySpotToEvmAmountUsd)
    };
  }

  const closeOnlyPerpToSpotDoneAt = toNullableIso(params.currentStateJson.closeOnlyPerpToSpotDoneAt);
  if (closeOnlyPerpToSpotDoneAt) {
    return {
      phase: "close_only_perp_to_spot_pending" as const,
      startedAt: closeOnlyPerpToSpotDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.closeOnlyPerpToSpotAmountUsd)
    };
  }

  const initialPerpTransferDoneAt = toNullableIso(params.currentStateJson.initialPerpTransferDoneAt);
  if (initialPerpTransferDoneAt) {
    return {
      phase: "initial_perp_funding_pending" as const,
      startedAt: initialPerpTransferDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(
        params.currentStateJson.initialPerpTransferAmountUsd
        ?? params.currentStateJson.initialPerpTransferRequestedAmountUsd
      )
    };
  }

  const initialCoreSpotTransferDoneAt = toNullableIso(params.currentStateJson.initialCoreSpotTransferDoneAt);
  if (initialCoreSpotTransferDoneAt) {
    return {
      phase: "initial_core_spot_funding_pending" as const,
      startedAt: initialCoreSpotTransferDoneAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.initialCoreSpotTransferAmountUsd)
    };
  }

  const initialCoreSpotDepositPendingAt = toNullableIso(params.currentStateJson.initialCoreSpotDepositPendingAt);
  if (initialCoreSpotDepositPendingAt) {
    return {
      phase: "initial_core_spot_funding_pending" as const,
      startedAt: initialCoreSpotDepositPendingAt,
      amountUsd: toPositiveNumberOrNullLoose(params.currentStateJson.initialCoreSpotDepositAmountUsd)
    };
  }

  return null;
}

export function normalizeTransferResultText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveInitialCoreSpotDepositStatus(
  result: Pick<FundsTransferResult, "status" | "errorCode" | "errorMessage"> | null | undefined
): InitialCoreSpotDepositStatus {
  const status = normalizeTransferResultText(result?.status);
  const errorCode = normalizeTransferResultText(result?.errorCode);
  const errorMessage = normalizeTransferResultText(result?.errorMessage);
  const combined = `${status}:${errorCode}:${errorMessage}`;

  if (status === "confirmed" || combined.includes("deposit_confirmed")) return "deposit_confirmed";
  if (status === "failed" || combined.includes("deposit_failed")) return "deposit_failed";
  if (combined.includes("deposit_pending_reconciliation")) return "deposit_pending_reconciliation";
  if (status === "pending_timeout" || combined.includes("pending_timeout") || combined.includes("timeout")) {
    return "deposit_pending_timeout";
  }
  return "deposit_submitted";
}

export function isInitialCoreSpotDepositConfirmed(
  result: Pick<FundsTransferResult, "status" | "errorCode" | "errorMessage"> | null | undefined
): boolean {
  return resolveInitialCoreSpotDepositStatus(result) === "deposit_confirmed";
}

export function hasAccountFundingAtLeast(accountState: {
  equity?: number | null;
  availableMargin?: number | null;
} | null | undefined, requestedAmountUsd: number): boolean {
  const requested = Number(requestedAmountUsd ?? NaN);
  if (!Number.isFinite(requested) || requested <= 0) return false;
  const equity = Number(accountState?.equity ?? NaN);
  const availableMargin = Number(accountState?.availableMargin ?? NaN);
  const observed = Math.max(
    Number.isFinite(equity) ? equity : 0,
    Number.isFinite(availableMargin) ? availableMargin : 0
  );
  return observed + INITIAL_FUNDING_EPSILON_USD >= requested;
}

export function shouldBlockInitialPerpTransferSubmit(params: {
  currentStateJson: Record<string, unknown>;
  requestedAmountUsd: number;
  accountState?: {
    equity?: number | null;
    availableMargin?: number | null;
  } | null;
}): boolean {
  if (String(params.currentStateJson.initialPerpTransferDoneAt ?? "").trim()) return false;
  if (hasAccountFundingAtLeast(params.accountState, params.requestedAmountUsd)) return false;

  const pendingAt = String(params.currentStateJson.initialPerpTransferPendingAt ?? "").trim();
  if (!pendingAt) return false;

  const status = normalizeTransferResultText(params.currentStateJson.initialPerpTransferLastStatus);
  if (status === "transfer_failed_final") {
    return false;
  }
  return true;
}

function normalizeVaultBalanceReadMeta(value: {
  fromCache?: boolean;
  stale?: boolean;
  degraded?: boolean;
  cacheAgeMs?: number | null;
  reason?: string | null;
} | null | undefined): VaultBalanceReadMeta | null {
  if (!value) return null;
  return {
    fromCache: value.fromCache === true,
    stale: value.stale === true,
    degraded: value.degraded === true,
    cacheAgeMs: Number.isFinite(Number(value.cacheAgeMs ?? NaN)) ? Number(value.cacheAgeMs) : null,
    reason: String(value.reason ?? "").trim() || null
  };
}

export function buildVaultBalanceSnapshot(params: {
  now: Date;
  accountState?: { equity?: number | null; availableMargin?: number | null } | null;
  coreSpotBalance?: { amountUsd?: number | null } | null;
  accountRead?: VaultBalanceReadMeta | null;
  spotRead?: VaultBalanceReadMeta | null;
  requireSpotBalance?: boolean;
}): VaultBalanceSnapshot {
  const equityUsd = Number.isFinite(Number(params.accountState?.equity ?? NaN))
    ? Number(params.accountState?.equity)
    : null;
  const availableMarginUsd = Number.isFinite(Number(params.accountState?.availableMargin ?? NaN))
    ? Number(params.accountState?.availableMargin)
    : null;
  const coreSpotBalanceUsd = Number.isFinite(Number(params.coreSpotBalance?.amountUsd ?? NaN))
    ? Number(params.coreSpotBalance?.amountUsd)
    : null;
  const accountRead = normalizeVaultBalanceReadMeta(params.accountRead);
  const spotRead = normalizeVaultBalanceReadMeta(params.spotRead);
  const requireSpotBalance = params.requireSpotBalance === true;
  const issues = new Set<string>();

  if (equityUsd !== null && equityUsd < -1e-9) issues.add("negative_equity");
  if (availableMarginUsd !== null && availableMarginUsd < -1e-9) issues.add("negative_available_margin");
  if (coreSpotBalanceUsd !== null && coreSpotBalanceUsd < -1e-9) issues.add("negative_core_spot_balance");
  if (
    equityUsd !== null
    && availableMarginUsd !== null
    && availableMarginUsd > equityUsd + Math.max(0.01, Math.abs(equityUsd) * 0.02)
  ) {
    issues.add("available_margin_exceeds_equity");
  }
  if (accountRead?.stale || accountRead?.degraded) issues.add("account_state_not_fresh");
  if (requireSpotBalance && (spotRead?.stale || spotRead?.degraded)) issues.add("spot_balance_not_fresh");
  if (equityUsd === null && availableMarginUsd === null) issues.add("account_state_unavailable");
  if (requireSpotBalance && coreSpotBalanceUsd === null) issues.add("spot_balance_unavailable");

  return {
    capturedAt: params.now.toISOString(),
    equityUsd,
    availableMarginUsd,
    coreSpotBalanceUsd,
    issues: [...issues],
    usableForSizing: issues.size === 0,
    usableForTransfers:
      !issues.has("negative_equity")
      && !issues.has("negative_available_margin")
      && !issues.has("negative_core_spot_balance")
      && !issues.has("available_margin_exceeds_equity")
      && !issues.has("account_state_not_fresh")
      && !issues.has("spot_balance_not_fresh")
      && !issues.has("account_state_unavailable")
      && (!requireSpotBalance || !issues.has("spot_balance_unavailable")),
    reads: {
      account: accountRead,
      spot: spotRead
    }
  };
}

export function buildGridPlanLiveAccountState(
  snapshot: VaultBalanceSnapshot
): NonNullable<GridPlanRequest["liveAccountState"]> {
  const accountRead = snapshot.reads.account;
  let source = "fresh";
  if (!snapshot.usableForSizing) {
    if (accountRead?.stale) source = "stale";
    else if (accountRead?.degraded) source = "degraded";
    else if (snapshot.equityUsd === null && snapshot.availableMarginUsd === null) source = "unavailable";
    else source = "invalid";
  }
  return {
    equityUsd: snapshot.equityUsd,
    availableMarginUsd: snapshot.availableMarginUsd,
    capturedAt: snapshot.capturedAt,
    source
  };
}

export async function readVaultBalanceSnapshot(params: {
  adapter: SupportedFuturesAdapter;
  cacheIdentity: string;
  symbol: string;
  now: Date;
  requireSpotBalance?: boolean;
}): Promise<VaultBalanceSnapshot> {
  const adapterAny = params.adapter as any;
  const accountStateReader =
    typeof adapterAny.getConfiguredAccountState === "function"
      ? () => adapterAny.getConfiguredAccountState()
      : () => params.adapter.getAccountState();
  const accountRead = await executeHyperliquidRead({
    key: buildHyperliquidReadKey({
      scope: "runner-vault-balance",
      identity: params.cacheIdentity,
      endpoint: "configured-account",
      symbol: params.symbol
    }),
    ttlMs: 2_500,
    staleMs: 15_000,
    cooldownMs: 10_000,
    retryAttempts: 2,
    retryBaseDelayMs: 150,
    read: accountStateReader
  }).catch((error) => ({
    value: null,
    fromCache: false,
    stale: false,
    degraded: true,
    rateLimited: false,
    cacheAgeMs: null,
    category: null,
    reason: String(error),
    retryCount: 0
  }));
  const shouldReadSpotBalance =
    params.requireSpotBalance === true
    || typeof adapterAny.getCoreUsdcSpotBalance === "function";
  const spotRead = shouldReadSpotBalance && typeof adapterAny.getCoreUsdcSpotBalance === "function"
    ? await executeHyperliquidRead({
        key: buildHyperliquidReadKey({
          scope: "runner-vault-balance",
          identity: params.cacheIdentity,
          endpoint: "core-spot-usdc",
          symbol: "USDC"
        }),
        ttlMs: 2_500,
        staleMs: 15_000,
        cooldownMs: 10_000,
        retryAttempts: 2,
        retryBaseDelayMs: 150,
        read: () => adapterAny.getCoreUsdcSpotBalance()
      }).catch((error) => ({
        value: null,
        fromCache: false,
        stale: false,
        degraded: true,
        rateLimited: false,
        cacheAgeMs: null,
        category: null,
        reason: String(error),
        retryCount: 0
      }))
    : null;

  return buildVaultBalanceSnapshot({
    now: params.now,
    accountState: accountRead.value as { equity?: number | null; availableMargin?: number | null } | null,
    coreSpotBalance: spotRead?.value as { amountUsd?: number | null } | null,
    accountRead,
    spotRead,
    requireSpotBalance: params.requireSpotBalance === true
  });
}

export function resolveInitialPerpFundingAmountUsd(params: {
  requestedAmountUsd: number;
  coreSpotBalanceUsd?: number | null;
}): number {
  const requestedAmountUsd = Number(params.requestedAmountUsd ?? NaN);
  if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) return 0;
  const coreSpotBalanceUsd = Number(params.coreSpotBalanceUsd ?? NaN);
  if (!Number.isFinite(coreSpotBalanceUsd) || coreSpotBalanceUsd <= 0) return requestedAmountUsd;
  if (coreSpotBalanceUsd + INITIAL_FUNDING_EPSILON_USD < requestedAmountUsd) return 0;
  return Number(requestedAmountUsd.toFixed(6));
}

export function resolveInitialCoreSpotDepositAmountUsd(params: {
  requestedAmountUsd: number;
  coreSpotBalanceUsd?: number | null;
}): number {
  const requestedAmountUsd = Number(params.requestedAmountUsd ?? NaN);
  if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) return 0;
  const coreSpotBalanceUsd = Number(params.coreSpotBalanceUsd ?? NaN);
  if (!Number.isFinite(coreSpotBalanceUsd) || coreSpotBalanceUsd <= 0) return Number(requestedAmountUsd.toFixed(6));
  const remainingUsd = requestedAmountUsd - coreSpotBalanceUsd;
  if (remainingUsd <= INITIAL_FUNDING_EPSILON_USD) return 0;
  return Number(remainingUsd.toFixed(6));
}

export function shouldRetryCloseOnlySettlementTransfer(params: {
  recordedAt?: unknown;
  sourceBalanceUsd: number;
  now: Date;
}): boolean {
  const sourceBalanceUsd = Number(params.sourceBalanceUsd ?? NaN);
  if (!Number.isFinite(sourceBalanceUsd) || sourceBalanceUsd <= 0.000001) return false;

  const recordedAtRaw = String(params.recordedAt ?? "").trim();
  if (!recordedAtRaw) return true;

  const recordedAtMs = Date.parse(recordedAtRaw);
  if (!Number.isFinite(recordedAtMs)) return true;
  // A successful settlement transfer must not be auto-resubmitted just because
  // HyperCore/EVM balance views lag behind the confirmed transaction.
  return false;
}

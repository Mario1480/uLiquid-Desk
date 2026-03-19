export type VaultReconciliationStatus = "clean" | "warning" | "drift_detected" | "blocked";

export type VaultReconciliationDriftKind =
  | "balances"
  | "realized_pnl"
  | "open_position_exposure"
  | "fee_accrual";

export type VaultReconciliationItem = {
  kind: VaultReconciliationDriftKind;
  status: VaultReconciliationStatus;
  message: string;
  expected?: number | string | boolean | null;
  actual?: number | string | boolean | null;
  delta?: number | null;
  threshold?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type VaultReconciliationResult = {
  scope: "trading" | "accounting" | "onchain";
  entityType: "bot_vault" | "master_vault" | "job";
  entityId: string;
  status: VaultReconciliationStatus;
  observedAt: string;
  items: VaultReconciliationItem[];
  blockedReasons: string[];
  driftCount: number;
  warningCount: number;
  metadata?: Record<string, unknown> | null;
};

const STATUS_PRIORITY: Record<VaultReconciliationStatus, number> = {
  clean: 0,
  warning: 1,
  drift_detected: 2,
  blocked: 3
};

export function mergeVaultReconciliationStatus(
  left: VaultReconciliationStatus,
  right: VaultReconciliationStatus
): VaultReconciliationStatus {
  return STATUS_PRIORITY[left] >= STATUS_PRIORITY[right] ? left : right;
}

export function resolveVaultReconciliationStatus(params: {
  items?: VaultReconciliationItem[];
  blockedReasons?: string[];
}): VaultReconciliationStatus {
  const blockedReasons = Array.isArray(params.blockedReasons) ? params.blockedReasons.filter(Boolean) : [];
  if (blockedReasons.length > 0) return "blocked";

  let status: VaultReconciliationStatus = "clean";
  for (const item of params.items ?? []) {
    status = mergeVaultReconciliationStatus(status, item.status);
  }
  return status;
}

export function buildVaultReconciliationResult(params: {
  scope: VaultReconciliationResult["scope"];
  entityType: VaultReconciliationResult["entityType"];
  entityId: string;
  observedAt?: string | Date | null;
  items?: VaultReconciliationItem[];
  blockedReasons?: string[];
  metadata?: Record<string, unknown> | null;
}): VaultReconciliationResult {
  const items = Array.isArray(params.items) ? params.items : [];
  const blockedReasons = Array.isArray(params.blockedReasons)
    ? params.blockedReasons.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  const observedAt = params.observedAt instanceof Date
    ? params.observedAt.toISOString()
    : String(params.observedAt ?? "").trim() || new Date().toISOString();
  return {
    scope: params.scope,
    entityType: params.entityType,
    entityId: params.entityId,
    status: resolveVaultReconciliationStatus({ items, blockedReasons }),
    observedAt,
    items,
    blockedReasons,
    driftCount: items.filter((entry) => entry.status === "drift_detected").length,
    warningCount: items.filter((entry) => entry.status === "warning").length,
    metadata: params.metadata ?? null
  };
}

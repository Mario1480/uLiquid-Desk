export type GridProvisioningAction = "reserve" | "fund_hypercore";

const GRID_PROVISIONING_ACTION_PHASES: Record<GridProvisioningAction, ReadonlySet<string>> = {
  reserve: new Set(["pending_reserve_signature"]),
  fund_hypercore: new Set(["pending_hypercore_funding_signature"])
};

const GRID_PROVISIONING_ONCHAIN_ACTION_TYPES = new Set([
  "create_bot_vault",
  "create_bot_vault_v3",
  "create_bot_vault_v4",
  "reserve_for_bot_vault",
  "fund_bot_vault_v3",
  "fund_bot_vault_v4",
  "fund_bot_vault_hypercore"
]);

export function isGridProvisioningActionAllowed(params: {
  action: GridProvisioningAction;
  phase: unknown;
}): boolean {
  const phase = String(params.phase ?? "").trim().toLowerCase();
  return GRID_PROVISIONING_ACTION_PHASES[params.action].has(phase);
}

export function isGridProvisioningOnchainActionType(value: unknown): boolean {
  return GRID_PROVISIONING_ONCHAIN_ACTION_TYPES.has(
    String(value ?? "").trim().toLowerCase()
  );
}

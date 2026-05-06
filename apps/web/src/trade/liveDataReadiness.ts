export type LiveTableReadiness = {
  positions: boolean;
  summary: boolean;
  openOrders: boolean;
};

export type LiveTableName = keyof LiveTableReadiness;

export function createLiveTableReadiness(): LiveTableReadiness {
  return {
    positions: false,
    summary: false,
    openOrders: false
  };
}

export function isLiveTableFailureBlocking(
  table: LiveTableName,
  readiness: LiveTableReadiness
): boolean {
  return table === "openOrders" && !readiness.openOrders;
}

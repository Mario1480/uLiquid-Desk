import { resolveRequiredQtyForVenueMinimums } from "@mm/futures-engine";
import type { GridBotInstanceRuntime } from "../db.js";
import type { GridPlanRequest, GridPlannerIntent } from "../grid/pythonGridClient.js";

export function computeInitialSeedSide(params: {
  mode: "long" | "short" | "neutral" | "cross";
  markPrice: number;
  lowerPrice: number;
  upperPrice: number;
  crossSideConfig?: GridBotInstanceRuntime["crossSideConfig"] | null;
}): "buy" | "sell" {
  if (params.mode === "long") return "buy";
  if (params.mode === "short") return "sell";
  if (params.mode === "cross" && params.crossSideConfig) {
    const longMidpoint = (Number(params.crossSideConfig.long.lowerPrice) + Number(params.crossSideConfig.long.upperPrice)) / 2;
    const shortMidpoint = (Number(params.crossSideConfig.short.lowerPrice) + Number(params.crossSideConfig.short.upperPrice)) / 2;
    if (Number(params.markPrice) <= longMidpoint) return "buy";
    if (Number(params.markPrice) >= shortMidpoint) return "sell";
    return Math.abs(Number(params.markPrice) - longMidpoint) <= Math.abs(shortMidpoint - Number(params.markPrice))
      ? "buy"
      : "sell";
  }
  const midpoint = (Number(params.lowerPrice) + Number(params.upperPrice)) / 2;
  return Number(params.markPrice) <= midpoint ? "buy" : "sell";
}

export function buildGridPlanRequest(params: {
  instance: Pick<
    GridBotInstanceRuntime,
    | "id"
    | "mode"
    | "gridMode"
    | "allocationMode"
    | "budgetSplitPolicy"
    | "longBudgetPct"
    | "shortBudgetPct"
    | "lowerPrice"
    | "upperPrice"
    | "gridCount"
    | "crossSideConfig"
    | "activeOrderWindowSize"
    | "recenterDriftLevels"
    | "investUsd"
    | "leverage"
    | "slippagePct"
    | "triggerPrice"
    | "tpPct"
    | "slPrice"
    | "extraMarginUsd"
    | "initialSeedEnabled"
    | "initialSeedPct"
  >;
  markPrice: number;
  openOrders: GridPlanRequest["openOrders"];
  position: GridPlanRequest["position"];
  stateJson: Record<string, unknown>;
  fillEvents: Array<Record<string, unknown>>;
  venueConstraints: NonNullable<GridPlanRequest["venueConstraints"]>;
  feeBufferPct: number;
  mmrPct: number | undefined;
  liqDistanceMinPct: number | undefined;
  liveAccountState?: GridPlanRequest["liveAccountState"] | null;
}): GridPlanRequest {
  return {
    instanceId: params.instance.id,
    mode: params.instance.mode,
    gridMode: params.instance.gridMode,
    allocationMode: params.instance.allocationMode,
    budgetSplitPolicy: params.instance.budgetSplitPolicy,
    longBudgetPct: params.instance.longBudgetPct,
    shortBudgetPct: params.instance.shortBudgetPct,
    lowerPrice: params.instance.lowerPrice,
    upperPrice: params.instance.upperPrice,
    gridCount: params.instance.gridCount,
    crossSideConfig: params.instance.crossSideConfig ?? undefined,
    activeOrderWindowSize: params.instance.activeOrderWindowSize,
    recenterDriftLevels: params.instance.recenterDriftLevels,
    investUsd: params.instance.investUsd,
    leverage: params.instance.leverage,
    slippagePct: params.instance.slippagePct,
    triggerPrice: params.instance.triggerPrice,
    tpPct: null,
    slPrice: params.instance.slPrice,
    trailingEnabled: false,
    markPrice: params.markPrice,
    openOrders: params.openOrders,
    position: params.position,
    liveAccountState: params.liveAccountState ?? undefined,
    stateJson: params.stateJson,
    fillEvents: params.fillEvents,
    venueConstraints: params.venueConstraints,
    feeBufferPct: params.feeBufferPct,
    mmrPct: params.mmrPct,
    extraMarginUsd: params.instance.extraMarginUsd,
    liqDistanceMinPct: params.liqDistanceMinPct,
    initialSeedEnabled: params.instance.initialSeedEnabled,
    initialSeedPct: params.instance.initialSeedPct
  };
}

export function normalizeGridOrderIntentForVenueConstraints(params: {
  plannerIntent: GridPlannerIntent;
  minQty: number | null;
  qtyStep: number | null;
  minNotional: number | null;
}): GridPlannerIntent | null {
  if (params.plannerIntent.type !== "place_order" && params.plannerIntent.type !== "replace_order") {
    return params.plannerIntent;
  }
  const qty = Number(params.plannerIntent.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const price = Number(params.plannerIntent.price ?? NaN);
  const minNotional = Number(params.minNotional ?? NaN);
  const nextQty = resolveRequiredQtyForVenueMinimums({
    qty,
    price,
    minQty: params.minQty,
    qtyStep: params.qtyStep,
    minNotional: params.plannerIntent.reduceOnly === true ? null : params.minNotional
  });
  if (!Number.isFinite(nextQty) || nextQty <= 0) return null;

  if (
    params.plannerIntent.reduceOnly !== true
    && Number.isFinite(price)
    && price > 0
    && Number.isFinite(minNotional)
    && minNotional > 0
    && nextQty * price + 1e-9 < minNotional
  ) {
    return null;
  }

  return {
    ...params.plannerIntent,
    qty: nextQty
  };
}

export function stabilizeHyperliquidVaultGridIntents(params: {
  intents: GridPlannerIntent[];
  isHyperliquidVault: boolean;
  botVaultState: string;
  hasFreshGridFills: boolean;
  openOrders: Array<{
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
}): GridPlannerIntent[] {
  if (!params.isHyperliquidVault || params.botVaultState !== "active" || params.hasFreshGridFills) {
    return params.intents;
  }

  const stableOpenClientOrderIds = new Set(
    params.openOrders
      .map((row) => String(row.clientOrderId ?? "").trim())
      .filter(Boolean)
  );
  const stableOpenExchangeOrderIds = new Set(
    params.openOrders
      .map((row) => String(row.exchangeOrderId ?? "").trim())
      .filter(Boolean)
  );

  return params.intents.filter((intent) => {
    if (intent.type === "set_protection") return true;
    if (intent.type === "cancel_order" || intent.type === "replace_order") return false;
    if (intent.type !== "place_order") return true;
    if (stableOpenClientOrderIds.size === 0 && stableOpenExchangeOrderIds.size === 0) return true;

    const clientOrderId = String(intent.clientOrderId ?? "").trim();
    const exchangeOrderId = String(intent.exchangeOrderId ?? "").trim();
    if (clientOrderId && stableOpenClientOrderIds.has(clientOrderId)) return false;
    if (exchangeOrderId && stableOpenExchangeOrderIds.has(exchangeOrderId)) return false;
    return true;
  });
}

export function findBlockingPendingGridCancel(params: {
  plannerIntent: GridPlannerIntent;
  pendingExecutions: Array<{
    actionType?: string | null;
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
}): {
  clientOrderId: string | null;
  exchangeOrderId: string | null;
} | null {
  const targetClientOrderId = String(params.plannerIntent.clientOrderId ?? "").trim();
  const targetExchangeOrderId = String(params.plannerIntent.exchangeOrderId ?? "").trim();
  for (const pending of params.pendingExecutions) {
    if (String(pending.actionType ?? "").trim().toLowerCase() !== "cancel_order") continue;
    const pendingClientOrderId = String(pending.clientOrderId ?? "").trim();
    const pendingExchangeOrderId = String(pending.exchangeOrderId ?? "").trim();
    if (
      (targetClientOrderId && pendingClientOrderId === targetClientOrderId)
      || (targetExchangeOrderId && pendingExchangeOrderId === targetExchangeOrderId)
    ) {
      return {
        clientOrderId: pendingClientOrderId || null,
        exchangeOrderId: pendingExchangeOrderId || null
      };
    }
  }
  return null;
}

export function parseGridClientOrderIdForRecovery(instanceId: string, clientOrderId: string): {
  gridLeg: "long" | "short";
  gridIndex: number;
} | null {
  const match = new RegExp(`^grid-${instanceId}-(long|short)-(\\d+)$`).exec(String(clientOrderId ?? "").trim());
  if (!match) return null;
  const gridIndex = Number(match[2]);
  if (!Number.isFinite(gridIndex) || gridIndex < 0) return null;
  return {
    gridLeg: match[1] === "short" ? "short" : "long",
    gridIndex: Math.trunc(gridIndex)
  };
}

function shouldAllowGridMaintenanceEntriesUnderMinInvestmentGate(params: {
  currentStateJson: Record<string, unknown>;
  hasOpenPosition: boolean;
  openOrdersCount: number;
}): boolean {
  if (!params.hasOpenPosition) return false;
  if (params.openOrdersCount > 0) return true;
  return params.currentStateJson.initialSeedExecuted === true;
}

export function filterGridIntentsForRiskGate(params: {
  intents: GridPlannerIntent[];
  currentStateJson: Record<string, unknown>;
  openOrdersCount: number;
  hasOpenPosition: boolean;
  entryBlockedByLiq: boolean;
  entryBlockedByMinInvestment: boolean;
  autoMarginRiskBlocked: boolean;
}): GridPlannerIntent[] {
  const riskBlockingActive =
    params.entryBlockedByLiq
    || params.entryBlockedByMinInvestment
    || params.autoMarginRiskBlocked;
  if (!riskBlockingActive) return params.intents;

  const allowMaintenanceEntries =
    !params.entryBlockedByLiq
    && !params.autoMarginRiskBlocked
    && params.entryBlockedByMinInvestment
    && shouldAllowGridMaintenanceEntriesUnderMinInvestmentGate({
      currentStateJson: params.currentStateJson,
      hasOpenPosition: params.hasOpenPosition,
      openOrdersCount: params.openOrdersCount
    });

  return params.intents.filter((intent) => {
    if (intent.type === "cancel_order" || intent.type === "set_protection") return true;
    if (intent.reduceOnly === true && params.hasOpenPosition) return true;
    if (!allowMaintenanceEntries) return false;
    return intent.type === "place_order" || intent.type === "replace_order";
  });
}

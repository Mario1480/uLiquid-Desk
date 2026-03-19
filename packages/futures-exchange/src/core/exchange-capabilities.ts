import type { MarginMode, OrderType } from "@mm/futures-core";
import type { ExchangeId } from "./exchange-error.types.js";

export type FuturesConnectorKind =
  | "live_adapter"
  | "paper_linked_market_data"
  | "market_data_only"
  | "unsupported";

export type FuturesPositionMode = "one-way" | "hedge";

export type FuturesVenueCapabilities = {
  venue: ExchangeId | "unknown";
  connectorKind: FuturesConnectorKind;
  adapterFactoryAvailable: boolean;
  supportsPerpMarketData: boolean;
  supportsPerpExecution: boolean;
  requiresLinkedMarketData: boolean;
  supportedOrderTypes: readonly OrderType[];
  supportsReduceOnly: boolean;
  supportedPositionModes: readonly FuturesPositionMode[];
  supportedMarginModes: readonly MarginMode[];
  supportsLeverage: boolean;
  supportsMarginModeControl: boolean;
  supportsOrderEditing: boolean;
  supportsPositionTpSl: boolean;
  supportsPositionClose: boolean;
  supportsPositionReads: boolean;
  supportsBalanceReads: boolean;
  supportsTransfers: boolean;
  supportsFundingSync: boolean;
  supportsGridExecution: boolean;
  supportsVaultExecution: boolean;
};

export type FuturesVenueCapabilityRequirement =
  | { feature: "perp_market_data" }
  | { feature: "perp_execution" }
  | { feature: "order_type"; orderType: OrderType }
  | { feature: "reduce_only" }
  | { feature: "position_mode"; positionMode: FuturesPositionMode }
  | { feature: "leverage_control" }
  | { feature: "margin_mode"; marginMode: MarginMode }
  | { feature: "position_read" }
  | { feature: "balance_read" }
  | { feature: "transfer" }
  | { feature: "grid_execution" }
  | { feature: "vault_execution" }
  | { feature: "order_editing" }
  | { feature: "position_tpsl" }
  | { feature: "position_close" };

export type UnsupportedVenueFeatureReason =
  | "execution_venue_market_data_only"
  | "execution_venue_unsupported"
  | "venue_market_data_unsupported"
  | "venue_order_type_unsupported"
  | "venue_reduce_only_unsupported"
  | "venue_position_mode_unsupported"
  | "venue_leverage_control_unsupported"
  | "venue_margin_mode_unsupported"
  | "venue_position_read_unsupported"
  | "venue_balance_read_unsupported"
  | "venue_transfer_unsupported"
  | "venue_grid_execution_unsupported"
  | "venue_vault_execution_unsupported"
  | "venue_order_editing_unsupported"
  | "venue_position_tpsl_unsupported"
  | "venue_position_close_unsupported";

export type FuturesVenueCapabilityValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: UnsupportedVenueFeatureReason;
      message: string;
      feature: FuturesVenueCapabilityRequirement["feature"];
      requirement: FuturesVenueCapabilityRequirement;
      metadata: Record<string, unknown>;
    };

const CROSS_AND_ISOLATED: readonly MarginMode[] = ["cross", "isolated"];
const NO_MARGIN_MODES: readonly MarginMode[] = [];
const ORDER_TYPES_MARKET_AND_LIMIT: readonly OrderType[] = ["market", "limit"];
const POSITION_MODE_ONE_WAY: readonly FuturesPositionMode[] = ["one-way"];
const POSITION_MODE_ONE_WAY_AND_HEDGE: readonly FuturesPositionMode[] = ["one-way", "hedge"];

export const BITGET_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "bitget",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedOrderTypes: ORDER_TYPES_MARKET_AND_LIMIT,
  supportsReduceOnly: true,
  supportedPositionModes: POSITION_MODE_ONE_WAY_AND_HEDGE,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsMarginModeControl: true,
  supportsOrderEditing: true,
  supportsPositionTpSl: true,
  supportsPositionClose: true,
  supportsPositionReads: true,
  supportsBalanceReads: true,
  supportsTransfers: false,
  supportsFundingSync: true,
  supportsGridExecution: true,
  supportsVaultExecution: false
};

export const HYPERLIQUID_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "hyperliquid",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedOrderTypes: ORDER_TYPES_MARKET_AND_LIMIT,
  supportsReduceOnly: true,
  supportedPositionModes: POSITION_MODE_ONE_WAY,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsMarginModeControl: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsPositionReads: true,
  supportsBalanceReads: true,
  supportsTransfers: false,
  supportsFundingSync: true,
  supportsGridExecution: true,
  supportsVaultExecution: true
};

export const MEXC_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "mexc",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedOrderTypes: ORDER_TYPES_MARKET_AND_LIMIT,
  supportsReduceOnly: true,
  supportedPositionModes: POSITION_MODE_ONE_WAY_AND_HEDGE,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsMarginModeControl: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsPositionReads: true,
  supportsBalanceReads: true,
  supportsTransfers: false,
  supportsFundingSync: true,
  supportsGridExecution: true,
  supportsVaultExecution: false
};

export const PAPER_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "paper",
  connectorKind: "paper_linked_market_data",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: false,
  supportsPerpExecution: true,
  requiresLinkedMarketData: true,
  supportedOrderTypes: ORDER_TYPES_MARKET_AND_LIMIT,
  supportsReduceOnly: true,
  supportedPositionModes: POSITION_MODE_ONE_WAY,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsMarginModeControl: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: true,
  supportsPositionClose: true,
  supportsPositionReads: true,
  supportsBalanceReads: true,
  supportsTransfers: false,
  supportsFundingSync: true,
  supportsGridExecution: true,
  supportsVaultExecution: false
};

export const BINANCE_MARKET_DATA_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "binance",
  connectorKind: "market_data_only",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: true,
  supportsPerpExecution: false,
  requiresLinkedMarketData: false,
  supportedOrderTypes: [],
  supportsReduceOnly: false,
  supportedPositionModes: [],
  supportedMarginModes: NO_MARGIN_MODES,
  supportsLeverage: false,
  supportsMarginModeControl: false,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsPositionReads: false,
  supportsBalanceReads: false,
  supportsTransfers: false,
  supportsFundingSync: false,
  supportsGridExecution: false,
  supportsVaultExecution: false
};

export const UNKNOWN_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "unknown",
  connectorKind: "unsupported",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: false,
  supportsPerpExecution: false,
  requiresLinkedMarketData: false,
  supportedOrderTypes: [],
  supportsReduceOnly: false,
  supportedPositionModes: [],
  supportedMarginModes: NO_MARGIN_MODES,
  supportsLeverage: false,
  supportsMarginModeControl: false,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsPositionReads: false,
  supportsBalanceReads: false,
  supportsTransfers: false,
  supportsFundingSync: false,
  supportsGridExecution: false,
  supportsVaultExecution: false
};

export function getFuturesVenueCapabilities(exchange: string | null | undefined): FuturesVenueCapabilities {
  const normalized = String(exchange ?? "").trim().toLowerCase();
  if (normalized === "bitget") return BITGET_FUTURES_CAPABILITIES;
  if (normalized === "hyperliquid") return HYPERLIQUID_FUTURES_CAPABILITIES;
  if (normalized === "mexc") return MEXC_FUTURES_CAPABILITIES;
  if (normalized === "paper") return PAPER_FUTURES_CAPABILITIES;
  if (normalized === "binance") return BINANCE_MARKET_DATA_CAPABILITIES;
  return UNKNOWN_FUTURES_CAPABILITIES;
}

function unsupportedResult(
  capabilities: FuturesVenueCapabilities,
  requirement: FuturesVenueCapabilityRequirement,
  reason: UnsupportedVenueFeatureReason,
  message: string,
  metadata?: Record<string, unknown>
): FuturesVenueCapabilityValidationResult {
  return {
    ok: false,
    reason,
    message,
    feature: requirement.feature,
    requirement,
    metadata: {
      venue: capabilities.venue,
      connectorKind: capabilities.connectorKind,
      ...(metadata ?? {})
    }
  };
}

export function validateFuturesVenueCapability(
  capabilities: FuturesVenueCapabilities,
  requirement: FuturesVenueCapabilityRequirement
): FuturesVenueCapabilityValidationResult {
  switch (requirement.feature) {
    case "perp_market_data":
      return capabilities.supportsPerpMarketData
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_market_data_unsupported",
            `Venue '${capabilities.venue}' does not support perpetual market data.`
          );
    case "perp_execution":
      return capabilities.supportsPerpExecution
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            capabilities.connectorKind === "market_data_only"
              ? "execution_venue_market_data_only"
              : "execution_venue_unsupported",
            capabilities.connectorKind === "market_data_only"
              ? `Venue '${capabilities.venue}' is configured for market data only.`
              : `Venue '${capabilities.venue}' does not support perpetual execution.`
          );
    case "order_type":
      return capabilities.supportedOrderTypes.includes(requirement.orderType)
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_order_type_unsupported",
            `Venue '${capabilities.venue}' does not support ${requirement.orderType} orders.`,
            {
              orderType: requirement.orderType,
              supportedOrderTypes: [...capabilities.supportedOrderTypes]
            }
          );
    case "reduce_only":
      return capabilities.supportsReduceOnly
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_reduce_only_unsupported",
            `Venue '${capabilities.venue}' does not support reduce-only execution.`
          );
    case "position_mode":
      return capabilities.supportedPositionModes.includes(requirement.positionMode)
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_position_mode_unsupported",
            `Venue '${capabilities.venue}' does not support ${requirement.positionMode} position mode.`,
            {
              positionMode: requirement.positionMode,
              supportedPositionModes: [...capabilities.supportedPositionModes]
            }
          );
    case "leverage_control":
      return capabilities.supportsLeverage
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_leverage_control_unsupported",
            `Venue '${capabilities.venue}' does not support leverage controls.`
          );
    case "margin_mode":
      return capabilities.supportedMarginModes.includes(requirement.marginMode)
        && capabilities.supportsMarginModeControl
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_margin_mode_unsupported",
            `Venue '${capabilities.venue}' does not support ${requirement.marginMode} margin mode controls.`,
            {
              marginMode: requirement.marginMode,
              supportedMarginModes: [...capabilities.supportedMarginModes]
            }
          );
    case "position_read":
      return capabilities.supportsPositionReads
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_position_read_unsupported",
            `Venue '${capabilities.venue}' does not support position reads.`
          );
    case "balance_read":
      return capabilities.supportsBalanceReads
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_balance_read_unsupported",
            `Venue '${capabilities.venue}' does not support balance reads.`
          );
    case "transfer":
      return capabilities.supportsTransfers
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_transfer_unsupported",
            `Venue '${capabilities.venue}' does not support transfers in the normalized platform contract.`
          );
    case "grid_execution":
      return capabilities.supportsGridExecution
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_grid_execution_unsupported",
            `Venue '${capabilities.venue}' does not support grid execution.`
          );
    case "vault_execution":
      return capabilities.supportsVaultExecution
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_vault_execution_unsupported",
            `Venue '${capabilities.venue}' does not support vault execution.`
          );
    case "order_editing":
      return capabilities.supportsOrderEditing
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_order_editing_unsupported",
            `Venue '${capabilities.venue}' does not support order editing.`
          );
    case "position_tpsl":
      return capabilities.supportsPositionTpSl
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_position_tpsl_unsupported",
            `Venue '${capabilities.venue}' does not support position TP/SL controls.`
          );
    case "position_close":
      return capabilities.supportsPositionClose
        ? { ok: true }
        : unsupportedResult(
            capabilities,
            requirement,
            "venue_position_close_unsupported",
            `Venue '${capabilities.venue}' does not support normalized position-close execution.`
          );
    default:
      return { ok: true };
  }
}

export function validateFuturesVenueRequirements(
  capabilities: FuturesVenueCapabilities,
  requirements: readonly FuturesVenueCapabilityRequirement[]
): FuturesVenueCapabilityValidationResult {
  for (const requirement of requirements) {
    const result = validateFuturesVenueCapability(capabilities, requirement);
    if (!result.ok) return result;
  }
  return { ok: true };
}

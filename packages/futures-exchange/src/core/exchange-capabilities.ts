import type { MarginMode } from "@mm/futures-core";
import type { ExchangeId } from "./exchange-error.types.js";

export type FuturesConnectorKind =
  | "live_adapter"
  | "paper_linked_market_data"
  | "market_data_only"
  | "unsupported";

export type FuturesVenueCapabilities = {
  venue: ExchangeId | "unknown";
  connectorKind: FuturesConnectorKind;
  adapterFactoryAvailable: boolean;
  supportsPerpMarketData: boolean;
  supportsPerpExecution: boolean;
  requiresLinkedMarketData: boolean;
  supportedMarginModes: readonly MarginMode[];
  supportsLeverage: boolean;
  supportsOrderEditing: boolean;
  supportsPositionTpSl: boolean;
  supportsPositionClose: boolean;
  supportsFundingSync: boolean;
  supportsGridExecution: boolean;
};

const CROSS_ONLY: readonly MarginMode[] = ["cross"];
const CROSS_AND_ISOLATED: readonly MarginMode[] = ["cross", "isolated"];
const NO_MARGIN_MODES: readonly MarginMode[] = [];

export const BITGET_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "bitget",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsOrderEditing: true,
  supportsPositionTpSl: true,
  supportsPositionClose: true,
  supportsFundingSync: true,
  supportsGridExecution: true
};

export const HYPERLIQUID_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "hyperliquid",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsFundingSync: true,
  supportsGridExecution: true
};

export const MEXC_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "mexc",
  connectorKind: "live_adapter",
  adapterFactoryAvailable: true,
  supportsPerpMarketData: true,
  supportsPerpExecution: true,
  requiresLinkedMarketData: false,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsFundingSync: true,
  supportsGridExecution: true
};

export const PAPER_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "paper",
  connectorKind: "paper_linked_market_data",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: false,
  supportsPerpExecution: true,
  requiresLinkedMarketData: true,
  supportedMarginModes: CROSS_AND_ISOLATED,
  supportsLeverage: true,
  supportsOrderEditing: false,
  supportsPositionTpSl: true,
  supportsPositionClose: true,
  supportsFundingSync: true,
  supportsGridExecution: true
};

export const BINANCE_MARKET_DATA_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "binance",
  connectorKind: "market_data_only",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: true,
  supportsPerpExecution: false,
  requiresLinkedMarketData: false,
  supportedMarginModes: NO_MARGIN_MODES,
  supportsLeverage: false,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsFundingSync: false,
  supportsGridExecution: false
};

export const UNKNOWN_FUTURES_CAPABILITIES: FuturesVenueCapabilities = {
  venue: "unknown",
  connectorKind: "unsupported",
  adapterFactoryAvailable: false,
  supportsPerpMarketData: false,
  supportsPerpExecution: false,
  requiresLinkedMarketData: false,
  supportedMarginModes: NO_MARGIN_MODES,
  supportsLeverage: false,
  supportsOrderEditing: false,
  supportsPositionTpSl: false,
  supportsPositionClose: false,
  supportsFundingSync: false,
  supportsGridExecution: false
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

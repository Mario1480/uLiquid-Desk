import type { TradeDeskPrefillPayload } from "../../src/schemas/tradeDeskPrefill";

export type ChartEngine = "advanced" | "lightweight";

export type IndicatorToggleState = {
  ema5: boolean;
  ema13: boolean;
  ema50: boolean;
  ema200: boolean;
  ema800: boolean;
  emaCloud50: boolean;
  vwapSession: boolean;
  dailyOpen: boolean;
  smcStructure: boolean;
  volumeOverlay: boolean;
  pvsraVector: boolean;
  breakerBlocks: boolean;
  superOrderBlockFvgBos: boolean;
};

export type TradingChartPreferences = {
  indicatorToggles: IndicatorToggleState;
  showUpMarkers: boolean;
  showDownMarkers: boolean;
};

export type SelectedTradePosition = {
  side: "long" | "short";
  entryPrice: number | null;
  markPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

export type TradeChartProps = {
  exchangeAccountId: string;
  symbol: string;
  timeframe: string;
  marketType: "spot" | "perp";
  prefill: TradeDeskPrefillPayload | null;
  chartPreferences?: TradingChartPreferences | null;
  onChartPreferencesChange?: (next: TradingChartPreferences) => void;
  selectedPosition?: SelectedTradePosition | null;
};

export const DEFAULT_INDICATOR_TOGGLES: IndicatorToggleState = {
  ema5: false,
  ema13: false,
  ema50: true,
  ema200: true,
  ema800: false,
  emaCloud50: false,
  vwapSession: false,
  dailyOpen: false,
  smcStructure: false,
  volumeOverlay: false,
  pvsraVector: false,
  breakerBlocks: false,
  superOrderBlockFvgBos: false
};

export const DEFAULT_CHART_PREFERENCES: TradingChartPreferences = {
  indicatorToggles: DEFAULT_INDICATOR_TOGGLES,
  showUpMarkers: false,
  showDownMarkers: false
};

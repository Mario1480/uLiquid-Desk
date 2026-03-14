export type PaperMarketType = "spot" | "perp";

export type LinkedMarketDataContext = {
  exchangeAccountId: string | null;
  marketDataVenue: string | null;
  supported: boolean;
  supportCode:
    | null
    | "manual_spot_trading_disabled"
    | "paper_spot_requires_supported_market_data"
    | "paper_perp_requires_supported_market_data";
};

export type PaperSimulationPolicy = {
  feeBps: number;
  slippageBps: number;
  fundingMode: "disabled";
  startBalanceUsd: number;
};

export type PaperExecutionContext = {
  executionVenue: "paper";
  marketType: PaperMarketType;
  linkedMarketData: LinkedMarketDataContext;
  simulationPolicy: PaperSimulationPolicy;
};

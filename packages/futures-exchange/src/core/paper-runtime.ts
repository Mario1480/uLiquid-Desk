export type PaperMarketType = "spot" | "perp";

export type PaperRuntimeContract = {
  executionVenue: "paper";
  marketDataLinkMode: "linked_live_venue";
  requiresLinkedMarketData: true;
  supportedMarketTypes: PaperMarketType[];
};

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
  runtimeContract: PaperRuntimeContract;
  linkedMarketData: LinkedMarketDataContext;
  simulationPolicy: PaperSimulationPolicy;
};

export const PAPER_RUNTIME_CONTRACT: PaperRuntimeContract = {
  executionVenue: "paper",
  marketDataLinkMode: "linked_live_venue",
  requiresLinkedMarketData: true,
  supportedMarketTypes: ["spot", "perp"]
};

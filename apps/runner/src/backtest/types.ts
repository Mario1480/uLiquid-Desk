export type BacktestTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type BacktestRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BacktestCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type BacktestAssumptions = {
  fillModel: "next_bar_open";
  feeBps: number;
  slippageBps: number;
  timezone: "UTC";
};

export type BacktestKpi = {
  pnlUsd: number;
  pnlPct: number;
  maxDrawdownPct: number;
  winratePct: number;
  tradeCount: number;
  profitFactor: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
};

export type BacktestTrade = {
  id: string;
  side: "long" | "short";
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  feeUsd: number;
  slippageUsd: number;
  pnlUsd: number;
  reason?: string;
};

export type BacktestReportV1 = {
  runId: string;
  botId: string;
  userId: string;
  status: BacktestRunStatus;
  period: { from: string; to: string; timeframe: BacktestTimeframe };
  market: { exchange: string; symbol: string };
  fingerprints: {
    dataHash: string;
    paramsHash: string;
    engineHash: string;
    runFingerprint: string;
  };
  assumptions: BacktestAssumptions;
  kpi: BacktestKpi;
  equityCurve: Array<{ ts: number; equityUsd: number }>;
  trades: BacktestTrade[];
  diagnostics: {
    guardBlocks: Record<string, number>;
    executionDecisions: Record<string, number>;
    warnings: string[];
  };
  createdAt: string;
  finishedAt?: string;
};

export type BacktestRunRecordV1 = {
  runId: string;
  botId: string;
  userId: string;
  status: BacktestRunStatus;
  period: {
    from: string;
    to: string;
    timeframe: BacktestTimeframe;
  };
  market: {
    exchange: string;
    symbol: string;
  };
  assumptions: BacktestAssumptions;
  paramsOverride: Record<string, unknown> | null;
  fingerprints: {
    dataHash: string;
    paramsHash: string;
    engineHash: string;
    runFingerprint: string;
  };
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  reportChunkCount?: number;
  reportVersion?: 1;
  kpi?: BacktestKpi | null;
  experimentId?: string | null;
  groupId?: string | null;
  cancelRequested?: boolean;
};


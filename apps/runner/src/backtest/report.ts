import type { BacktestKpi, BacktestTrade } from "./types.js";

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function buildBacktestKpi(params: {
  initialEquityUsd: number;
  finalEquityUsd?: number;
  trades: BacktestTrade[];
  equityCurve: Array<{ ts: number; equityUsd: number }>;
}): BacktestKpi {
  const initial = Number.isFinite(params.initialEquityUsd) && params.initialEquityUsd > 0
    ? params.initialEquityUsd
    : 10_000;
  const trades = params.trades;
  const wins = trades.filter((row) => row.pnlUsd > 0);
  const losses = trades.filter((row) => row.pnlUsd < 0);
  const grossProfit = wins.reduce((sum, row) => sum + row.pnlUsd, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, row) => sum + row.pnlUsd, 0));
  const pnlFromTrades = trades.reduce((sum, row) => sum + row.pnlUsd, 0);
  const pnlUsd = Number.isFinite(params.finalEquityUsd)
    ? Number(params.finalEquityUsd) - initial
    : pnlFromTrades;
  const pnlPct = (pnlUsd / initial) * 100;

  let peak = initial;
  let maxDrawdownPct = 0;
  for (const row of params.equityCurve) {
    if (!Number.isFinite(row.equityUsd)) continue;
    peak = Math.max(peak, row.equityUsd);
    if (peak <= 0) continue;
    const ddPct = ((peak - row.equityUsd) / peak) * 100;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  return {
    pnlUsd: round(pnlUsd, 4),
    pnlPct: round(pnlPct, 4),
    maxDrawdownPct: round(maxDrawdownPct, 4),
    winratePct: trades.length > 0 ? round((wins.length / trades.length) * 100, 4) : 0,
    tradeCount: trades.length,
    profitFactor: grossLossAbs > 0 ? round(grossProfit / grossLossAbs, 4) : null,
    avgWinUsd: wins.length > 0 ? round(grossProfit / wins.length, 4) : null,
    avgLossUsd: losses.length > 0 ? round(losses.reduce((sum, row) => sum + row.pnlUsd, 0) / losses.length, 4) : null
  };
}

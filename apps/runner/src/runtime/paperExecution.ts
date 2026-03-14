import type { PaperSimulationPolicy } from "@mm/futures-exchange";

export type RunnerPaperSimulationPolicy = PaperSimulationPolicy;

function readBpsEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

function readUsdEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

export function resolveRunnerPaperSimulationPolicy(): RunnerPaperSimulationPolicy {
  return {
    feeBps: readBpsEnv("PAPER_TRADING_FEE_BPS", 0),
    slippageBps: readBpsEnv("PAPER_TRADING_SLIPPAGE_BPS", 0),
    fundingMode: "disabled",
    startBalanceUsd: readUsdEnv("PAPER_TRADING_START_BALANCE_USD", 10000)
  };
}

export function getRunnerDefaultPaperBalanceUsd(): number {
  return resolveRunnerPaperSimulationPolicy().startBalanceUsd;
}

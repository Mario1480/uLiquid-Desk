import type {
  PaperExecutionContext,
  PaperLinkedMarketDataSupport,
  PaperMarketType,
  PaperRuntimePolicyFlags,
  PaperSimulationPolicy
} from "@mm/futures-exchange";
import {
  createPaperExecutionContext,
  readPaperRuntimePolicyFlagsFromEnv,
  resolvePaperSimulationPolicyFromEnv,
  resolvePaperLinkedMarketDataSupport
} from "@mm/futures-exchange";

export type RunnerPaperSimulationPolicy = PaperSimulationPolicy;
export type RunnerPaperPolicyFlags = PaperRuntimePolicyFlags;
export type RunnerPaperExecutionContext = PaperExecutionContext;

export function resolveRunnerPaperSimulationPolicy(): RunnerPaperSimulationPolicy {
  return resolvePaperSimulationPolicyFromEnv();
}

export function readRunnerPaperPolicyFlagsFromEnv(): RunnerPaperPolicyFlags {
  return readPaperRuntimePolicyFlagsFromEnv();
}

export function resolveRunnerPaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: RunnerPaperPolicyFlags = readRunnerPaperPolicyFlagsFromEnv()
): PaperLinkedMarketDataSupport {
  return resolvePaperLinkedMarketDataSupport(params, flags);
}

export function buildRunnerPaperExecutionContext(params: {
  marketType: PaperMarketType;
  marketDataExchange?: string | null;
  marketDataExchangeAccountId?: string | null;
  flags?: RunnerPaperPolicyFlags;
  simulationPolicy?: RunnerPaperSimulationPolicy;
}): RunnerPaperExecutionContext {
  return createPaperExecutionContext({
    marketType: params.marketType,
    marketDataExchange: params.marketDataExchange ?? null,
    marketDataExchangeAccountId: params.marketDataExchangeAccountId ?? null,
    flags: params.flags ?? readRunnerPaperPolicyFlagsFromEnv(),
    simulationPolicy: params.simulationPolicy ?? resolveRunnerPaperSimulationPolicy()
  });
}

export function getRunnerDefaultPaperBalanceUsd(): number {
  return resolveRunnerPaperSimulationPolicy().startBalanceUsd;
}

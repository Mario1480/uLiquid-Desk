import type {
  LinkedMarketDataContext,
  PaperLinkedMarketDataSupport,
  PaperExecutionContext,
  PaperMarketType,
  PaperRuntimePolicyFlags,
  PaperRuntimeContract,
  PaperSimulationPolicy
} from "@mm/futures-exchange";
import {
  createPaperExecutionContext,
  isValidPaperLinkedMarketDataExchange,
  readPaperRuntimePolicyFlagsFromEnv,
  resolvePaperSimulationPolicyFromEnv,
  resolvePaperLinkedMarketDataSupport as resolveSharedPaperLinkedMarketDataSupport
} from "@mm/futures-exchange";
import { ManualTradingError } from "../trading.js";

export type {
  LinkedMarketDataContext,
  PaperLinkedMarketDataSupport,
  PaperExecutionContext,
  PaperMarketType,
  PaperRuntimePolicyFlags,
  PaperRuntimeContract,
  PaperSimulationPolicy
} from "@mm/futures-exchange";

export type PaperPolicyFlags = PaperRuntimePolicyFlags;
export { isValidPaperLinkedMarketDataExchange };

export function readPaperPolicyFlagsFromEnv(): PaperPolicyFlags {
  return readPaperRuntimePolicyFlagsFromEnv();
}

export function resolvePaperSimulationPolicy(): PaperSimulationPolicy {
  return resolvePaperSimulationPolicyFromEnv();
}

export function resolvePaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: PaperPolicyFlags = readPaperPolicyFlagsFromEnv()
): PaperLinkedMarketDataSupport {
  return resolveSharedPaperLinkedMarketDataSupport(params, flags);
}

export function buildPaperExecutionContext(params: {
  marketType: PaperMarketType;
  marketDataExchange?: string | null;
  marketDataExchangeAccountId?: string | null;
  flags?: PaperPolicyFlags;
  simulationPolicy?: PaperSimulationPolicy;
}): PaperExecutionContext {
  return createPaperExecutionContext({
    marketType: params.marketType,
    marketDataExchange: params.marketDataExchange ?? null,
    marketDataExchangeAccountId: params.marketDataExchangeAccountId ?? null,
    flags: params.flags ?? readPaperPolicyFlagsFromEnv(),
    simulationPolicy: params.simulationPolicy ?? resolvePaperSimulationPolicy()
  });
}

export function assertPaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: PaperPolicyFlags = readPaperPolicyFlagsFromEnv()
): void {
  const support = resolvePaperLinkedMarketDataSupport(params, flags);
  if (support.supported) return;

  if (support.code === "manual_spot_trading_disabled") {
    throw new ManualTradingError(
      support.code,
      400,
      support.code
    );
  }

  throw new ManualTradingError(
    support.code ?? "paper_market_data_unsupported",
    400,
    support.code ?? "paper_market_data_unsupported"
  );
}

import { createPerpMarketDataClient, type PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import {
  createPerpExecutionAdapter,
  type PerpExecutionAdapter,
  resolvePerpTradingContext,
  type ResolvedPerpTradingContext
} from "../trading.js";

export type PerpMarketStreamingMode = "adapter_stream" | "market_data_poll";

export function resolvePerpMarketStreamingMode(
  context: ResolvedPerpTradingContext
): PerpMarketStreamingMode {
  return context.marketDataVenue.kind === "market_data_only"
    ? "market_data_poll"
    : "adapter_stream";
}

export async function createStreamingPerpExecutionAdapter(
  context: ResolvedPerpTradingContext
): Promise<PerpExecutionAdapter> {
  const adapter = createPerpExecutionAdapter(context.marketDataAccount);
  await adapter.contractCache.warmup();
  return adapter;
}

export function createPollingPerpMarketDataClient(
  context: ResolvedPerpTradingContext,
  _source?: string
): PerpMarketDataClient {
  return createPerpMarketDataClient(context.marketDataAccount);
}

export async function createResolvedPollingPerpMarketDataRuntime(
  userId: string,
  exchangeAccountId?: string | null,
  source?: string
): Promise<{
  context: ResolvedPerpTradingContext;
  client: PerpMarketDataClient;
}> {
  const context = await resolvePerpTradingContext(userId, exchangeAccountId);
  return {
    context,
    client: createPollingPerpMarketDataClient(context, source)
  };
}

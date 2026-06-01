import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import {
  ManualTradingError,
  type NormalizedOrder,
  type NormalizedPosition,
  type PerpExecutionAdapter,
  type TradingAccount
} from "../trading.js";
import type { ResolvedPerpExecutionAccounts } from "./perp-execution-service.js";

type AccountState = {
  equity?: number | null;
  availableMargin?: number | null;
  marginMode?: string | null;
};

function rejectionReason(result: PromiseSettledResult<unknown>): unknown | null {
  return result.status === "rejected" ? result.reason : null;
}

type PerpReadServiceDeps = {
  isPaperTradingAccount(account: TradingAccount): boolean;
  createPerpExecutionAdapter(account: TradingAccount): PerpExecutionAdapter;
  createPerpMarketDataClient(account: TradingAccount, endpoint: string): PerpMarketDataClient;
  getPaperAccountState?(
    account: TradingAccount,
    reader: PerpMarketDataClient
  ): Promise<AccountState>;
  listPaperPositions?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<NormalizedPosition[]>;
  listPaperOpenOrders?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<NormalizedOrder[]>;
  listPositions?(
    adapter: PerpExecutionAdapter,
    symbol?: string
  ): Promise<NormalizedPosition[]>;
  listOpenOrders?(
    adapter: PerpExecutionAdapter,
    symbol?: string
  ): Promise<NormalizedOrder[]>;
};

type ReadContext =
  | {
      mode: "paper";
      selectedAccount: TradingAccount;
      marketDataAccount: TradingAccount;
      marketDataClient: PerpMarketDataClient;
    }
  | {
      mode: "live";
      selectedAccount: TradingAccount;
      marketDataAccount: TradingAccount;
      adapter: PerpExecutionAdapter;
    };

function requireDep<T>(value: T | undefined, name: string): T {
  if (value !== undefined) return value;
  throw new ManualTradingError(
    `perp_read_dependency_missing:${name}`,
    500,
    "perp_read_dependency_missing"
  );
}

export function createPerpReadService(deps: PerpReadServiceDeps) {
  async function withContext<T>(
    resolved: ResolvedPerpExecutionAccounts,
    endpoint: string,
    run: (ctx: ReadContext) => Promise<T>
  ): Promise<T> {
    if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
      const marketDataClient = deps.createPerpMarketDataClient(resolved.marketDataAccount, endpoint);
      try {
        return await run({
          mode: "paper",
          selectedAccount: resolved.selectedAccount,
          marketDataAccount: resolved.marketDataAccount,
          marketDataClient
        });
      } finally {
        await marketDataClient.close();
      }
    }

    const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
    try {
      return await run({
        mode: "live",
        selectedAccount: resolved.selectedAccount,
        marketDataAccount: resolved.marketDataAccount,
        adapter
      });
    } finally {
      await adapter.close();
    }
  }

  return {
    async listPositions(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol?: string;
      endpoint: string;
    }) {
      return withContext(input.resolved, input.endpoint, async (ctx) => {
        const items = ctx.mode === "paper"
          ? await requireDep(deps.listPaperPositions, "listPaperPositions")(ctx.selectedAccount, ctx.marketDataClient, input.symbol)
          : await requireDep(deps.listPositions, "listPositions")(ctx.adapter, input.symbol);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          marketDataExchange: ctx.marketDataAccount.exchange,
          items
        };
      });
    },

    async listOpenOrders(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol?: string;
      endpoint: string;
    }) {
      return withContext(input.resolved, input.endpoint, async (ctx) => {
        const items = ctx.mode === "paper"
          ? await requireDep(deps.listPaperOpenOrders, "listPaperOpenOrders")(ctx.selectedAccount, ctx.marketDataClient, input.symbol)
          : await requireDep(deps.listOpenOrders, "listOpenOrders")(ctx.adapter, input.symbol);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          marketDataExchange: ctx.marketDataAccount.exchange,
          items
        };
      });
    },

    async getAccountSnapshot(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol?: string;
      endpoint: string;
    }) {
      return withContext(input.resolved, input.endpoint, async (ctx) => {
        if (ctx.mode === "paper") {
          const [accountState, positions] = await Promise.all([
            requireDep(deps.getPaperAccountState, "getPaperAccountState")(ctx.selectedAccount, ctx.marketDataClient),
            requireDep(deps.listPaperPositions, "listPaperPositions")(ctx.selectedAccount, ctx.marketDataClient, input.symbol)
          ]);
          return {
            exchangeAccountId: ctx.selectedAccount.id,
            marketDataExchange: ctx.marketDataAccount.exchange,
            accountState,
            positions
          };
        }

        const [accountState, positions] = await Promise.all([
          ctx.adapter.getAccountState(),
          requireDep(deps.listPositions, "listPositions")(ctx.adapter, input.symbol)
        ]);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          marketDataExchange: ctx.marketDataAccount.exchange,
          accountState,
          positions
        };
      });
    },

    async getTradingState(input: {
      resolved: ResolvedPerpExecutionAccounts;
      positionSymbol?: string;
      openOrdersSymbol?: string;
      endpoint: string;
    }) {
      return withContext(input.resolved, input.endpoint, async (ctx) => {
        if (ctx.mode === "paper") {
          const [accountStateResult, positionsResult, openOrdersResult] = await Promise.allSettled([
            requireDep(deps.getPaperAccountState, "getPaperAccountState")(ctx.selectedAccount, ctx.marketDataClient),
            requireDep(deps.listPaperPositions, "listPaperPositions")(
              ctx.selectedAccount,
              ctx.marketDataClient,
              input.positionSymbol
            ),
            requireDep(deps.listPaperOpenOrders, "listPaperOpenOrders")(
              ctx.selectedAccount,
              ctx.marketDataClient,
              input.openOrdersSymbol
            )
          ]);

          return {
            exchangeAccountId: ctx.selectedAccount.id,
            marketDataExchange: ctx.marketDataAccount.exchange,
            accountState: accountStateResult.status === "fulfilled" ? accountStateResult.value : null,
            positions: positionsResult.status === "fulfilled" ? positionsResult.value : [],
            openOrders: openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [],
            errors: {
              accountState: rejectionReason(accountStateResult),
              positions: rejectionReason(positionsResult),
              openOrders: rejectionReason(openOrdersResult)
            }
          };
        }

        const [accountStateResult, positionsResult, openOrdersResult] = await Promise.allSettled([
          ctx.adapter.getAccountState(),
          requireDep(deps.listPositions, "listPositions")(ctx.adapter, input.positionSymbol),
          requireDep(deps.listOpenOrders, "listOpenOrders")(ctx.adapter, input.openOrdersSymbol)
        ]);

        return {
          exchangeAccountId: ctx.selectedAccount.id,
          marketDataExchange: ctx.marketDataAccount.exchange,
          accountState: accountStateResult.status === "fulfilled" ? accountStateResult.value : null,
          positions: positionsResult.status === "fulfilled" ? positionsResult.value : [],
          openOrders: openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [],
          errors: {
            accountState: rejectionReason(accountStateResult),
            positions: rejectionReason(positionsResult),
            openOrders: rejectionReason(openOrdersResult)
          }
        };
      });
    }
  };
}

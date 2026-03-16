import type { TradeIntent } from "@mm/futures-core";
import {
  buildSharedExecutionVenue,
  executeSharedExecutionPipeline
} from "@mm/futures-engine";
import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import { buildPaperExecutionContext } from "../paper/policy.js";
import {
  ManualTradingError,
  type PerpExecutionAdapter,
  type TradingAccount
} from "../trading.js";

export type ResolvedPerpExecutionAccounts = {
  selectedAccount: TradingAccount;
  marketDataAccount: TradingAccount;
};

type CancelAllResult = {
  requested: number;
  cancelled: number;
  failed: number;
};

type ClosePositionResult = {
  orderIds: string[];
};

type PerpExecutionServiceDeps = {
  isPaperTradingAccount(account: TradingAccount): boolean;
  createPerpExecutionAdapter(account: TradingAccount): PerpExecutionAdapter;
  createPerpMarketDataClient(account: TradingAccount, endpoint: string): PerpMarketDataClient;
  placePaperOrder?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      qty: number;
      price?: number;
      takeProfitPrice?: number;
      stopLossPrice?: number;
      reduceOnly?: boolean;
    }
  ): Promise<{ orderId: string }>;
  editPaperOrder?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      orderId: string;
      symbol: string;
      price?: number;
      qty?: number;
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ orderId: string }>;
  cancelPaperOrder?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    orderId: string,
    symbol?: string
  ): Promise<{ ok: boolean }>;
  cancelAllPaperOrders?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<CancelAllResult>;
  setPaperPositionTpSl?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      symbol: string;
      side?: "long" | "short";
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ updated: boolean }>;
  closePaperPosition?(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol: string,
    side?: "long" | "short"
  ): Promise<string[]>;
  editOpenOrder?(
    adapter: PerpExecutionAdapter,
    params: {
      symbol: string;
      orderId: string;
      price?: number;
      qty?: number;
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ orderId: string }>;
  cancelAllOrders?(
    adapter: PerpExecutionAdapter,
    symbol?: string
  ): Promise<CancelAllResult>;
  closePositionsMarket?(
    adapter: PerpExecutionAdapter,
    symbol: string,
    side?: "long" | "short"
  ): Promise<string[]>;
  setPositionTpSl?(
    adapter: PerpExecutionAdapter,
    input: {
      symbol: string;
      side?: "long" | "short";
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ ok: true }>;
};

type PerpResourceContext =
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

export function createPerpExecutionService(deps: PerpExecutionServiceDeps) {
  function requireDep<T>(value: T | undefined, name: string): T {
    if (value !== undefined) return value;
    throw new ManualTradingError(
      `perp_execution_dependency_missing:${name}`,
      500,
      "perp_execution_dependency_missing"
    );
  }

  async function withContext<T>(
    resolved: ResolvedPerpExecutionAccounts,
    endpoint: string,
    run: (ctx: PerpResourceContext) => Promise<T>
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

  function toManualTradeIntent(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    reduceOnly?: boolean;
    leverage?: number;
    marginMode?: "isolated" | "cross";
  }): Extract<TradeIntent, { type: "open" }> {
    return {
      type: "open",
      symbol: input.symbol,
      side: input.side === "sell" ? "short" : "long",
      order: {
        type: input.type,
        qty: input.qty,
        price: input.price,
        takeProfitPrice: input.takeProfitPrice,
        stopLossPrice: input.stopLossPrice,
        reduceOnly: input.reduceOnly,
        leverage: input.leverage,
        marginMode: input.marginMode
      }
    };
  }

  return {
    async setLeverage(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol: string;
      leverage: number;
      marginMode: "isolated" | "cross";
    }) {
      return withContext(input.resolved, "/api/account/leverage", async (ctx) => {
        if (ctx.mode === "paper") {
          return {
            exchangeAccountId: ctx.selectedAccount.id,
            symbol: input.symbol,
            leverage: input.leverage,
            marginMode: input.marginMode,
            ok: true
          };
        }

        await ctx.adapter.setLeverage(input.symbol, input.leverage, input.marginMode);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          symbol: input.symbol,
          leverage: input.leverage,
          marginMode: input.marginMode,
          ok: true
        };
      });
    },

    async placeOrder(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      qty: number;
      price?: number;
      takeProfitPrice?: number;
      stopLossPrice?: number;
      reduceOnly?: boolean;
      leverage?: number;
      marginMode?: "isolated" | "cross";
    }) {
      return withContext(input.resolved, "/api/orders", async (ctx) => {
        const requestIntent = toManualTradeIntent(input);
        const venue = buildSharedExecutionVenue({
          executionVenue: ctx.selectedAccount.exchange,
          marketDataVenue: ctx.marketDataAccount.exchange,
          paperContext: ctx.mode === "paper"
            ? buildPaperExecutionContext({
                marketType: "perp",
                marketDataExchange: ctx.marketDataAccount.exchange,
                marketDataExchangeAccountId: ctx.marketDataAccount.id
              })
            : null
        });

        const response = await executeSharedExecutionPipeline({
          request: {
            domain: "manual_trading",
            action: "place_order",
            symbol: input.symbol,
            intent: requestIntent,
            venue,
            metadata: {
              exchangeAccountId: ctx.selectedAccount.id,
              executionMode: ctx.mode
            }
          },
          rethrowExecutionError: true,
          execute: async () => {
            if (ctx.mode === "paper") {
              const placed = await requireDep(deps.placePaperOrder, "placePaperOrder")(ctx.selectedAccount, ctx.marketDataClient, {
                symbol: input.symbol,
                side: input.side,
                type: input.type,
                qty: input.qty,
                price: input.price,
                takeProfitPrice: input.takeProfitPrice,
                stopLossPrice: input.stopLossPrice,
                reduceOnly: input.reduceOnly
              });
              return {
                status: "executed" as const,
                reason: "accepted",
                orderIds: placed.orderId ? [placed.orderId] : []
              };
            }

            if (input.leverage !== undefined) {
              await ctx.adapter.setLeverage(
                input.symbol,
                input.leverage,
                input.marginMode ?? "cross"
              );
            }
            const placed = await ctx.adapter.placeOrder({
              symbol: input.symbol,
              side: input.side,
              type: input.type,
              qty: input.qty,
              price: input.price,
              takeProfitPrice: input.takeProfitPrice,
              stopLossPrice: input.stopLossPrice,
              reduceOnly: input.reduceOnly,
              marginMode: input.marginMode
            });
            return {
              status: "executed" as const,
              reason: "accepted",
              orderIds: placed.orderId ? [placed.orderId] : []
            };
          }
        });

        if (response.status !== "executed") {
          throw new ManualTradingError(
            response.reason,
            response.status === "blocked" ? 400 : 500,
            response.reason
          );
        }
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          orderId: response.orderIds[0] ?? "",
          status: "accepted" as const
        };
      });
    },

    async editOrder(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol: string;
      orderId: string;
      price?: number;
      qty?: number;
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }) {
      return withContext(input.resolved, "/api/orders/edit", async (ctx) => {
        if (ctx.mode === "paper") {
        const updated = await requireDep(deps.editPaperOrder, "editPaperOrder")(ctx.selectedAccount, ctx.marketDataClient, {
            orderId: input.orderId,
            symbol: input.symbol,
            price: input.price,
            qty: input.qty,
            takeProfitPrice: input.takeProfitPrice,
            stopLossPrice: input.stopLossPrice
          });
          return {
            exchangeAccountId: ctx.selectedAccount.id,
            orderId: updated.orderId,
            ok: true
          };
        }

        const updated = await requireDep(deps.editOpenOrder, "editOpenOrder")(ctx.adapter, {
          symbol: input.symbol,
          orderId: input.orderId,
          price: input.price,
          qty: input.qty,
          takeProfitPrice: input.takeProfitPrice,
          stopLossPrice: input.stopLossPrice
        });
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          orderId: updated.orderId,
          ok: true
        };
      });
    },

    async cancelOrder(input: {
      resolved: ResolvedPerpExecutionAccounts;
      orderId: string;
      symbol?: string;
    }) {
      return withContext(input.resolved, "/api/orders/cancel", async (ctx) => {
        if (ctx.mode === "paper") {
          await requireDep(deps.cancelPaperOrder, "cancelPaperOrder")(ctx.selectedAccount, ctx.marketDataClient, input.orderId, input.symbol);
          return { ok: true };
        }

        if (input.symbol) {
          if (ctx.adapter.cancelOrderByParams) {
            await ctx.adapter.cancelOrderByParams({
              symbol: input.symbol,
              orderId: input.orderId
            });
          } else {
            await ctx.adapter.cancelOrder(input.orderId);
          }
        } else {
          await ctx.adapter.cancelOrder(input.orderId);
        }
        return { ok: true };
      });
    },

    async cancelAllOrders(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol?: string;
    }) {
      return withContext(input.resolved, "/api/orders/cancel-all", async (ctx) => {
        const result = ctx.mode === "paper"
          ? await requireDep(deps.cancelAllPaperOrders, "cancelAllPaperOrders")(ctx.selectedAccount, ctx.marketDataClient, input.symbol)
          : await requireDep(deps.cancelAllOrders, "cancelAllOrders")(ctx.adapter, input.symbol);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          ...result
        };
      });
    },

    async setPositionTpSl(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol: string;
      side?: "long" | "short";
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }) {
      return withContext(input.resolved, "/api/positions/tpsl", async (ctx) => {
        if (ctx.mode === "paper") {
          await requireDep(deps.setPaperPositionTpSl, "setPaperPositionTpSl")(ctx.selectedAccount, ctx.marketDataClient, {
            symbol: input.symbol,
            side: input.side,
            takeProfitPrice: input.takeProfitPrice,
            stopLossPrice: input.stopLossPrice
          });
        } else {
          await requireDep(deps.setPositionTpSl, "setPositionTpSl")(ctx.adapter, {
            symbol: input.symbol,
            side: input.side,
            takeProfitPrice: input.takeProfitPrice,
            stopLossPrice: input.stopLossPrice
          });
        }
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          symbol: input.symbol,
          ok: true
        };
      });
    },

    async closePosition(input: {
      resolved: ResolvedPerpExecutionAccounts;
      symbol: string;
      side?: "long" | "short";
    }): Promise<ClosePositionResult & { exchangeAccountId: string }> {
      return withContext(input.resolved, "/api/positions/close", async (ctx) => {
        const orderIds = ctx.mode === "paper"
          ? await requireDep(deps.closePaperPosition, "closePaperPosition")(ctx.selectedAccount, ctx.marketDataClient, input.symbol, input.side)
          : await requireDep(deps.closePositionsMarket, "closePositionsMarket")(ctx.adapter, input.symbol, input.side);
        return {
          exchangeAccountId: ctx.selectedAccount.id,
          orderIds
        };
      });
    }
  };
}

export function requirePerpSymbol(symbol: string | null): string {
  if (!symbol) {
    throw new ManualTradingError("symbol_required", 400, "symbol_required");
  }
  return symbol;
}

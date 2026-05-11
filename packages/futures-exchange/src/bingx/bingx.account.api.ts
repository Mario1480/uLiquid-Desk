import { isAlreadySetMarginTypeError } from "./bingx.errors.js";
import type {
  BingxAccountInfo,
  BingxBalance,
  BingxPositionMode,
  BingxPositionRisk
} from "./bingx.types.js";
import type { BingxRestClient } from "./bingx.rest.js";

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["rows", "list", "positions", "balances", "data"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export class BingxAccountApi {
  constructor(private readonly rest: BingxRestClient) {}

  getAccount(): Promise<BingxAccountInfo> {
    return this.rest.requestPrivate<BingxAccountInfo>({
      method: "GET",
      endpoint: "/openApi/swap/v3/user/balance"
    });
  }

  async getBalance(): Promise<BingxBalance[]> {
    const data = await this.getAccount();
    if (Array.isArray(data)) return data as BingxBalance[];
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (Array.isArray(record.balance)) return record.balance as BingxBalance[];
    if (record.balance && typeof record.balance === "object") return [record.balance as BingxBalance];
    return rows<BingxBalance>(data);
  }

  async getPositionRisk(symbol?: string): Promise<BingxPositionRisk[]> {
    const data = await this.rest.requestPrivate<unknown>({
      method: "GET",
      endpoint: "/openApi/swap/v2/user/positions",
      query: symbol ? { symbol } : undefined
    });
    return rows<BingxPositionRisk>(data);
  }

  getPositionMode(): Promise<BingxPositionMode> {
    return this.rest.requestPrivate<BingxPositionMode>({
      method: "GET",
      endpoint: "/openApi/swap/v1/positionSide/dual"
    });
  }

  async setLeverage(symbol: string, leverage: number, side: "BOTH" | "LONG" | "SHORT" = "BOTH"): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/openApi/swap/v2/trade/leverage",
      query: {
        symbol,
        leverage,
        side
      }
    });
  }

  getLeverage(symbol: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/leverage",
      query: { symbol }
    });
  }

  async setMarginType(symbol: string, marginType: "CROSSED" | "ISOLATED"): Promise<unknown> {
    try {
      return await this.rest.requestPrivate({
        method: "POST",
        endpoint: "/openApi/swap/v2/trade/marginType",
        query: {
          symbol,
          marginType
        }
      });
    } catch (error) {
      if (isAlreadySetMarginTypeError(error)) return { ok: true, alreadySet: true };
      throw error;
    }
  }

  getMarginType(symbol: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/marginType",
      query: { symbol }
    });
  }
}

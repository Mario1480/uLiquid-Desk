import { isAlreadySetMarginTypeError } from "./binance.errors.js";
import type {
  BinanceAccountInfo,
  BinanceBalance,
  BinancePositionMode,
  BinancePositionRisk
} from "./binance.types.js";
import type { BinanceRestClient } from "./binance.rest.js";

export class BinanceAccountApi {
  constructor(private readonly rest: BinanceRestClient) {}

  getAccount(): Promise<BinanceAccountInfo> {
    return this.rest.requestPrivate<BinanceAccountInfo>({
      method: "GET",
      endpoint: "/fapi/v3/account"
    });
  }

  getBalance(): Promise<BinanceBalance[]> {
    return this.rest.requestPrivate<BinanceBalance[]>({
      method: "GET",
      endpoint: "/fapi/v3/balance"
    });
  }

  getPositionRisk(symbol?: string): Promise<BinancePositionRisk[]> {
    return this.rest.requestPrivate<BinancePositionRisk[]>({
      method: "GET",
      endpoint: "/fapi/v3/positionRisk",
      query: symbol ? { symbol } : undefined
    });
  }

  getPositionMode(): Promise<BinancePositionMode> {
    return this.rest.requestPrivate<BinancePositionMode>({
      method: "GET",
      endpoint: "/fapi/v1/positionSide/dual"
    });
  }

  startUserDataStream(): Promise<{ listenKey: string }> {
    return this.rest.requestApiKey<{ listenKey: string }>("POST", "/fapi/v1/listenKey");
  }

  keepAliveUserDataStream(listenKey: string): Promise<unknown> {
    return this.rest.requestApiKey("PUT", "/fapi/v1/listenKey", { listenKey });
  }

  closeUserDataStream(listenKey: string): Promise<unknown> {
    return this.rest.requestApiKey("DELETE", "/fapi/v1/listenKey", { listenKey });
  }

  async setLeverage(symbol: string, leverage: number): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "POST",
      endpoint: "/fapi/v1/leverage",
      query: {
        symbol,
        leverage
      }
    });
  }

  async setMarginType(symbol: string, marginType: "CROSSED" | "ISOLATED"): Promise<unknown> {
    try {
      return await this.rest.requestPrivate({
        method: "POST",
        endpoint: "/fapi/v1/marginType",
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
}

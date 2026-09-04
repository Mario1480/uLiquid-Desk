export type TradingAccount = {
  id: string;
  userId: string;
  exchange: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
  botVaultAddress?: string | null;
  marketDataExchangeAccountId: string | null;
  systemKey?: string | null;
};

export type PerpPriceReader = {
  getLastPrice?(symbol: string): Promise<number | null>;
  getTicker?(symbol: string): Promise<{ last?: number | null; mark?: number | null }>;
  marketApi?: {
    getTicker: (...args: any[]) => Promise<unknown>;
    getCandles: (...args: any[]) => Promise<unknown>;
  };
  toExchangeSymbol?(symbol: string): Promise<string> | string;
  productType?: string;
};

export class ManualTradingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "manual_trading_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

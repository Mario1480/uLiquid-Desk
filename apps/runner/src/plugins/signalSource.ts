import type { ActiveFuturesBot } from "../db.js";

export type SignalSourceResolution = {
  sourceId: string;
  metadata: Record<string, unknown>;
  blocked?: {
    reason: string;
  };
};

export type SignalSourceContext = {
  bot: ActiveFuturesBot;
  now: Date;
  workerId?: string;
};

export interface SignalSourceProvider {
  key: string;
  resolve(ctx: SignalSourceContext): Promise<SignalSourceResolution>;
}

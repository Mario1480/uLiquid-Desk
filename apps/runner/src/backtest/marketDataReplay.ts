import type { BacktestCandle } from "./types.js";

export type BacktestReplayFrame = {
  index: number;
  now: BacktestCandle;
  next: BacktestCandle;
  isLastExecutableFrame: boolean;
};

export class BacktestMarketDataReplay {
  private readonly candles: BacktestCandle[];

  constructor(candles: BacktestCandle[]) {
    this.candles = candles
      .slice()
      .sort((a, b) => a.ts - b.ts);
  }

  size(): number {
    return this.candles.length;
  }

  *frames(): Generator<BacktestReplayFrame> {
    for (let i = 0; i < this.candles.length - 1; i += 1) {
      const now = this.candles[i];
      const next = this.candles[i + 1];
      if (!now || !next) continue;
      yield {
        index: i,
        now,
        next,
        isLastExecutableFrame: i === this.candles.length - 2
      };
    }
  }

  lastCandle(): BacktestCandle | null {
    return this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
  }
}


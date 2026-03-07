export class BacktestClock {
  private currentTs: number;

  constructor(initialTs: number) {
    this.currentTs = Math.trunc(initialTs);
  }

  now(): Date {
    return new Date(this.currentTs);
  }

  nowTs(): number {
    return this.currentTs;
  }

  setTs(ts: number): void {
    this.currentTs = Math.trunc(ts);
  }
}


type StateValue = Record<string, unknown>;

export class InMemoryBacktestStateStore {
  private readonly byKey = new Map<string, StateValue>();

  get(key: string): StateValue | null {
    return this.byKey.get(key) ?? null;
  }

  set(key: string, value: StateValue): void {
    this.byKey.set(key, value);
  }
}


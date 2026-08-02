export type AgentCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeAgentCandleRows(raw: unknown): AgentCandle[] {
  const envelope = toRecord(raw);
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(envelope?.data)
      ? envelope.data
      : [];
  return rows.flatMap((entry) => {
    if (Array.isArray(entry)) {
      const ts = toNumber(entry[0]);
      const open = toNumber(entry[1]);
      const high = toNumber(entry[2]);
      const low = toNumber(entry[3]);
      const close = toNumber(entry[4]);
      const volume = toNumber(entry[5]) ?? 0;
      return ts !== null && open !== null && high !== null && low !== null && close !== null
        ? [{ ts, open, high, low, close, volume }]
        : [];
    }
    const row = toRecord(entry);
    const ts = toNumber(row?.t ?? row?.ts ?? row?.timestamp ?? row?.time);
    const open = toNumber(row?.o ?? row?.open);
    const high = toNumber(row?.h ?? row?.high);
    const low = toNumber(row?.l ?? row?.low);
    const close = toNumber(row?.c ?? row?.close);
    const volume = toNumber(row?.v ?? row?.volume) ?? 0;
    return ts !== null && open !== null && high !== null && low !== null && close !== null
      ? [{ ts, open, high, low, close, volume }]
      : [];
  }).sort((a, b) => a.ts - b.ts);
}

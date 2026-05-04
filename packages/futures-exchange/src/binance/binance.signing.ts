import crypto from "node:crypto";

export type BinanceSignableValue = string | number | boolean | undefined | null;

export function buildBinanceQueryString(params: Record<string, BinanceSignableValue>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, String(value)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export function signBinanceQuery(queryString: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

export function buildSignedBinanceQuery(params: {
  params?: Record<string, BinanceSignableValue>;
  secret: string;
  timestampMs: number;
  recvWindowMs: number;
}): string {
  const query = buildBinanceQueryString({
    ...(params.params ?? {}),
    recvWindow: params.recvWindowMs,
    timestamp: params.timestampMs
  });
  const signature = signBinanceQuery(query, params.secret);
  return `${query}&signature=${signature}`;
}


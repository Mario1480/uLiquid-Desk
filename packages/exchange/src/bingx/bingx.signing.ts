import crypto from "node:crypto";

export type BingxSignableValue = string | number | boolean | undefined | null;

function sortedEntries(params: Record<string, BingxSignableValue>): Array<[string, string]> {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

export function buildBingxSigningString(params: Record<string, BingxSignableValue>): string {
  return sortedEntries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function buildBingxQueryString(params: Record<string, BingxSignableValue>): string {
  return new URLSearchParams(sortedEntries(params)).toString();
}

export function signBingxQuery(signingString: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(signingString).digest("hex");
}

export function buildSignedBingxQuery(params: {
  params?: Record<string, BingxSignableValue>;
  secret: string;
  timestampMs: number;
  recvWindowMs: number;
}): string {
  const signedParams = {
    ...(params.params ?? {}),
    recvWindow: params.recvWindowMs,
    timestamp: params.timestampMs
  };
  const signingString = buildBingxSigningString(signedParams);
  const queryString = buildBingxQueryString(signedParams);
  const signature = signBingxQuery(signingString, params.secret);
  return `${queryString}&signature=${signature}`;
}

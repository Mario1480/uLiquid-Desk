export function shouldSendBitgetReduceOnly(params: {
  reduceOnly?: boolean;
  side: "buy" | "sell";
  tradeSide?: "open" | "close";
}): "YES" | undefined {
  if (!params.reduceOnly) return undefined;
  if (params.tradeSide && params.tradeSide !== "close") return undefined;
  return "YES";
}

export function isLikelyBitgetReduceOnlyReject(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  return text.includes("reduceonly")
    || text.includes("reduce only")
    || text.includes("no position to close");
}


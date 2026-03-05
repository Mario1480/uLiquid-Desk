export function preferredBitgetCloseSide(side: "long" | "short"): "buy" | "sell" {
  return side === "long" ? "sell" : "buy";
}

export function fallbackBitgetCloseSide(side: "buy" | "sell"): "buy" | "sell" {
  return side === "buy" ? "sell" : "buy";
}

export function isNoPositionToCloseError(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  return text.includes("no position to close")
    || text.includes("position does not exist")
    || text.includes("position not exists");
}


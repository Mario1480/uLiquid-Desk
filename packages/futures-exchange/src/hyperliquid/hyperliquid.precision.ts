function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(12, Math.trunc(value)));
}

function stripTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function truncateToDecimals(value: number, decimals: number): number {
  const scale = 10 ** clampDecimals(decimals);
  return Math.trunc(value * scale) / scale;
}

export function hyperliquidSizeStepFromSzDecimals(szDecimals: unknown): number | null {
  const scale = toFiniteNumber(szDecimals);
  if (scale === null || scale < 0) return null;
  return 1 / 10 ** Math.trunc(scale);
}

export function hyperliquidMaxPriceDecimals(szDecimals: unknown, type: "perp" | "spot" = "perp"): number | null {
  const scale = toFiniteNumber(szDecimals);
  if (scale === null || scale < 0) return null;
  const maxDecimals = (type === "perp" ? 6 : 8) - Math.trunc(scale);
  return Math.max(0, maxDecimals);
}

export function hyperliquidPriceDecimalsForValue(
  price: unknown,
  szDecimals: unknown,
  type: "perp" | "spot" = "perp"
): number | null {
  const parsedPrice = toFiniteNumber(price);
  const maxDecimals = hyperliquidMaxPriceDecimals(szDecimals, type);
  if (parsedPrice === null || parsedPrice <= 0 || maxDecimals === null) return null;
  if (Number.isInteger(parsedPrice)) return 0;

  const magnitude = Math.floor(Math.log10(Math.abs(parsedPrice)));
  const sigFigDecimals = Math.max(5 - magnitude - 1, 0);
  return Math.max(0, Math.min(maxDecimals, sigFigDecimals));
}

export function hyperliquidPriceTickForValue(
  price: unknown,
  szDecimals: unknown,
  type: "perp" | "spot" = "perp"
): number | null {
  const decimals = hyperliquidPriceDecimalsForValue(price, szDecimals, type);
  if (decimals === null) return null;
  return 1 / 10 ** decimals;
}

export function formatHyperliquidPrice(
  price: unknown,
  szDecimals: unknown,
  type: "perp" | "spot" = "perp"
): string {
  const parsedPrice = toFiniteNumber(price);
  if (parsedPrice === null || parsedPrice <= 0) {
    throw new Error("hyperliquid_invalid_price");
  }
  if (Number.isInteger(parsedPrice)) return String(Math.trunc(parsedPrice));

  const decimals = hyperliquidPriceDecimalsForValue(parsedPrice, szDecimals, type);
  if (decimals === null) {
    throw new Error("hyperliquid_invalid_price_precision");
  }
  return stripTrailingZeros(truncateToDecimals(parsedPrice, decimals).toFixed(decimals));
}

export function formatHyperliquidSize(size: unknown, szDecimals: unknown): string {
  const parsedSize = toFiniteNumber(size);
  const scale = toFiniteNumber(szDecimals);
  if (parsedSize === null || parsedSize <= 0) {
    throw new Error("hyperliquid_invalid_size");
  }
  if (scale === null || scale < 0) {
    throw new Error("hyperliquid_invalid_size_precision");
  }
  const decimals = Math.trunc(scale);
  return stripTrailingZeros(truncateToDecimals(parsedSize, decimals).toFixed(decimals));
}

export type BingxSymbolMeta = {
  symbol: string;
  priceStep?: number;
  qtyStep?: number;
  pricePrecision?: number;
  qtyPrecision?: number;
  minQty?: number;
  minNotional?: number;
};

function pow10(p: number): number {
  return Math.pow(10, p);
}

export function precisionToStep(precision: number | null | undefined): number | undefined {
  if (!Number.isFinite(precision) || precision === null || precision === undefined || precision < 0) return undefined;
  return 1 / pow10(precision);
}

export function roundDownToStep(x: number, step: number): number {
  if (step <= 0) return x;
  const k = Math.floor(x / step + 1e-12);
  return k * step;
}

export function roundDownToPrecision(x: number, precision: number): number {
  const f = pow10(precision);
  return Math.floor(x * f + 1e-12) / f;
}

export function normalizePrice(price: number, meta?: BingxSymbolMeta): number {
  if (!meta) return price;
  if (meta.priceStep && meta.priceStep > 0) {
    if (price > 0 && price < meta.priceStep && typeof meta.pricePrecision === "number") {
      return roundDownToPrecision(price, meta.pricePrecision);
    }
    return roundDownToStep(price, meta.priceStep);
  }
  if (typeof meta.pricePrecision === "number") return roundDownToPrecision(price, meta.pricePrecision);
  return price;
}

export function normalizeQty(qty: number, meta?: BingxSymbolMeta): number {
  if (!meta) return qty;
  if (meta.qtyStep && meta.qtyStep > 0) {
    if (qty > 0 && qty < meta.qtyStep && typeof meta.qtyPrecision === "number") {
      return roundDownToPrecision(qty, meta.qtyPrecision);
    }
    return roundDownToStep(qty, meta.qtyStep);
  }
  if (typeof meta.qtyPrecision === "number") return roundDownToPrecision(qty, meta.qtyPrecision);
  return qty;
}

export function checkMins(params: {
  price: number;
  qty: number;
  meta?: BingxSymbolMeta;
}): { ok: true } | { ok: false; reason: string } {
  const { price, qty, meta } = params;
  if (!meta) return { ok: true };

  if (meta.minQty && qty < meta.minQty) {
    return { ok: false, reason: `qty ${qty} < minQty ${meta.minQty}` };
  }

  const notional = price * qty;
  if (meta.minNotional && notional < meta.minNotional) {
    return { ok: false, reason: `notional ${notional} < minNotional ${meta.minNotional}` };
  }

  return { ok: true };
}

export function roundUpToStep(value: number, step: number | null | undefined): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step ?? NaN) || !step || step <= 0) return value;
  const ratio = value / step;
  return Math.ceil(ratio - 1e-12) * step;
}

export function resolveVenueMinNotional(params: {
  executionExchange: string;
  fallbackMinNotional: number;
  dynamicMinNotional: number;
  explicitMinNotional?: number | null;
}): number {
  const fallback = Math.max(0, Number(params.fallbackMinNotional ?? 0));
  const dynamic = Math.max(0, Number(params.dynamicMinNotional ?? 0));
  const explicit = Math.max(0, Number(params.explicitMinNotional ?? 0));
  const hyperliquidFloor = String(params.executionExchange ?? "").trim().toLowerCase() === "hyperliquid" ? 10 : 0;
  return Number(Math.max(fallback, dynamic, explicit, hyperliquidFloor).toFixed(8));
}

export function resolveRequiredQtyForVenueMinimums(params: {
  qty: number;
  price: number;
  minQty: number | null;
  qtyStep: number | null;
  minNotional: number | null;
  minNotionalStepBuffer?: number;
}): number {
  const price = Number(params.price ?? NaN);
  if (!Number.isFinite(price) || price <= 0) return 0;

  let nextQty = Number(params.qty ?? 0);
  const minQty = Number(params.minQty ?? NaN);
  const qtyStep = Number(params.qtyStep ?? NaN);
  const minNotional = Number(params.minNotional ?? NaN);
  const minNotionalStepBuffer = Math.max(0, Number(params.minNotionalStepBuffer ?? 0));

  if (Number.isFinite(minQty) && minQty > 0) {
    nextQty = Math.max(nextQty, minQty);
  }

  const stepBufferUsd = Number.isFinite(qtyStep) && qtyStep > 0
    ? qtyStep * price * minNotionalStepBuffer
    : 0;
  const requiredMinNotional = Number.isFinite(minNotional) && minNotional > 0
    ? minNotional + stepBufferUsd
    : 0;

  if (requiredMinNotional > 0 && nextQty * price + 1e-9 < requiredMinNotional) {
    nextQty = Math.max(nextQty, requiredMinNotional / price);
  }

  nextQty = roundUpToStep(nextQty, params.qtyStep);
  return Number(nextQty.toFixed(8));
}

export type GridVenueConstraintCacheRow = {
  exchange: string;
  symbol: string;
  minQty: number | null;
  qtyStep: number | null;
  priceTick: number | null;
  minNotionalUSDT: number | null;
  feeRateTaker: number | null;
  feeRateMaker: number | null;
  markPrice: number | null;
  updatedAt: Date;
};

export async function upsertGridVenueConstraintCache(params: {
  db: any;
  exchange: string;
  symbol: string;
  minQty: number | null;
  qtyStep: number | null;
  priceTick: number | null;
  minNotionalUSDT: number | null;
  feeRateTaker: number | null;
  feeRateMaker?: number | null;
  markPrice: number | null;
}): Promise<void> {
  const dbAny = params.db as any;
  if (!dbAny?.gridVenueConstraintCache) return;
  await dbAny.gridVenueConstraintCache.upsert({
    where: {
      exchange_symbol: {
        exchange: params.exchange,
        symbol: params.symbol
      }
    },
    update: {
      minQty: params.minQty,
      qtyStep: params.qtyStep,
      priceTick: params.priceTick,
      minNotionalUSDT: params.minNotionalUSDT,
      feeRateTaker: params.feeRateTaker,
      feeRateMaker: params.feeRateMaker ?? null,
      markPrice: params.markPrice,
      updatedAt: new Date()
    },
    create: {
      exchange: params.exchange,
      symbol: params.symbol,
      minQty: params.minQty,
      qtyStep: params.qtyStep,
      priceTick: params.priceTick,
      minNotionalUSDT: params.minNotionalUSDT,
      feeRateTaker: params.feeRateTaker,
      feeRateMaker: params.feeRateMaker ?? null,
      markPrice: params.markPrice,
      updatedAt: new Date()
    }
  });
}

export async function readGridVenueConstraintCache(params: {
  db: any;
  exchange: string;
  symbol: string;
  ttlSec: number;
}): Promise<GridVenueConstraintCacheRow | null> {
  const dbAny = params.db as any;
  if (!dbAny?.gridVenueConstraintCache) return null;
  const row = await dbAny.gridVenueConstraintCache.findUnique({
    where: {
      exchange_symbol: {
        exchange: params.exchange,
        symbol: params.symbol
      }
    }
  });
  if (!row) return null;
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  const ageMs = Date.now() - updatedAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs > Math.max(1, params.ttlSec) * 1000) return null;
  return {
    exchange: String(row.exchange ?? "").toLowerCase(),
    symbol: String(row.symbol ?? "").toUpperCase(),
    minQty: Number.isFinite(Number(row.minQty)) ? Number(row.minQty) : null,
    qtyStep: Number.isFinite(Number(row.qtyStep)) ? Number(row.qtyStep) : null,
    priceTick: Number.isFinite(Number(row.priceTick)) ? Number(row.priceTick) : null,
    minNotionalUSDT: Number.isFinite(Number(row.minNotionalUSDT)) ? Number(row.minNotionalUSDT) : null,
    feeRateTaker: Number.isFinite(Number(row.feeRateTaker)) ? Number(row.feeRateTaker) : null,
    feeRateMaker: Number.isFinite(Number(row.feeRateMaker)) ? Number(row.feeRateMaker) : null,
    markPrice: Number.isFinite(Number(row.markPrice)) ? Number(row.markPrice) : null,
    updatedAt
  };
}

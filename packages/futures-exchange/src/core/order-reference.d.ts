export declare function normalizeCloid(value: unknown): string | null;
export declare function collectOrderReferenceCandidates(value: unknown): string[];
export declare function collectOrderReferenceSet(values: unknown[]): Set<string>;
export declare function buildOrderReferenceKey(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): string | null;

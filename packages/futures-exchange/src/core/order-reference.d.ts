export type OrderReferenceHint = "exchange" | "client" | "client_or_cloid" | "cloid";
export type CanonicalOrderReference = {
  kind: "client" | "order" | "cloid";
  value: string;
  key: string;
};
export declare function normalizeCloid(value: unknown): string | null;
export declare function canonicalizeOrderReference(value: unknown, hint?: OrderReferenceHint): CanonicalOrderReference | null;
export declare function collectCanonicalOrderReferenceKeys(values: Array<unknown | {
  value: unknown;
  hint?: OrderReferenceHint;
}>): Set<string>;
export declare function collectOrderReferenceCandidates(value: unknown): string[];
export declare function collectOrderReferenceSet(values: unknown[]): Set<string>;
export declare function buildOrderReferenceKey(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): string | null;
export declare function buildOrderReferenceIdentity(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): {
  key: string | null;
  keys: string[];
  client: CanonicalOrderReference | null;
  exchange: CanonicalOrderReference | null;
  cloid: CanonicalOrderReference | null;
};
export declare function orderReferenceInputsMatch(left: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}, right: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): boolean;

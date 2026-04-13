function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export type OrderReferenceHint =
  | "exchange"
  | "client"
  | "client_or_cloid"
  | "cloid";

export type CanonicalOrderReference = {
  kind: "client" | "order" | "cloid";
  value: string;
  key: string;
};

function parseScopedOrderReference(value: string): { prefix: "cloid" | "corewriter"; asset: string; decimal: string } | null {
  const match = /^(cloid|corewriter):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return {
    prefix: match[1] as "cloid" | "corewriter",
    asset: match[2] ?? "0",
    decimal: match[3] ?? ""
  };
}

export function normalizeCloid(value: unknown): string | null {
  return normalizeCloidWithHint(value, "cloid");
}

function normalizeCloidWithHint(value: unknown, hint: OrderReferenceHint): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const scoped = parseScopedOrderReference(text);
  if (scoped) return scoped.decimal || null;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(text)) {
    try {
      return BigInt(text).toString(10);
    } catch {
      return text.toLowerCase();
    }
  }
  if (/^\d+$/.test(text) && (hint === "cloid" || hint === "client_or_cloid")) return text;
  return null;
}

export function canonicalizeOrderReference(value: unknown, hint: OrderReferenceHint = "exchange"): CanonicalOrderReference | null {
  const text = normalizeText(value);
  if (!text) return null;
  const cloid = normalizeCloidWithHint(text, hint);
  if (cloid) {
    return {
      kind: "cloid",
      value: cloid,
      key: `cloid:${cloid}`
    };
  }
  if (hint === "client" || hint === "client_or_cloid") {
    return {
      kind: "client",
      value: text,
      key: `client:${text}`
    };
  }
  return {
    kind: "order",
    value: text,
    key: `order:${text}`
  };
}

export function collectCanonicalOrderReferenceKeys(values: Array<
  | unknown
  | {
      value: unknown;
      hint?: OrderReferenceHint;
    }
>): Set<string> {
  const out = new Set<string>();
  for (const entry of values) {
    const value = typeof entry === "object" && entry !== null && "value" in entry
      ? (entry as { value: unknown; hint?: OrderReferenceHint }).value
      : entry;
    const hint = typeof entry === "object" && entry !== null && "value" in entry
      ? ((entry as { value: unknown; hint?: OrderReferenceHint }).hint ?? "exchange")
      : "exchange";
    const canonical = canonicalizeOrderReference(value, hint);
    if (canonical?.key) out.add(canonical.key);
  }
  return out;
}

export function collectOrderReferenceCandidates(value: unknown): string[] {
  const direct = normalizeText(value);
  if (!direct) return [];
  const out = new Set<string>([direct]);
  const normalizedCloid = normalizeCloidWithHint(direct, "client_or_cloid");
  const scoped = parseScopedOrderReference(direct);
  if (scoped) {
    // Keep legacy `corewriter:` refs interoperable with canonical `cloid:` storage.
    out.add(`cloid:${scoped.asset}:${scoped.decimal}`);
    out.add(`corewriter:${scoped.asset}:${scoped.decimal}`);
    out.add(`cloid:${scoped.decimal}`);
    if (normalizedCloid) {
      out.add(normalizedCloid);
      try {
        out.add(`0x${BigInt(normalizedCloid).toString(16).padStart(32, "0")}`);
      } catch {
        // Ignore malformed bigint conversions while matching venue refs.
      }
    }
    return [...out];
  }
  if (/^\d+$/.test(direct)) {
    out.add(direct);
    out.add(`cloid:${direct}`);
    out.add(`order:${direct}`);
    try {
      out.add(`0x${BigInt(direct).toString(16).padStart(32, "0")}`);
    } catch {
      // Ignore malformed bigint conversions while matching venue refs.
    }
    return [...out];
  }
  if (/^0x[0-9a-fA-F]{1,64}$/.test(direct)) {
    out.add(direct.toLowerCase());
    if (normalizedCloid) out.add(normalizedCloid);
    if (normalizedCloid) out.add(`cloid:${normalizedCloid}`);
    return [...out];
  }
  return [...out];
}

export function collectOrderReferenceSet(values: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    for (const candidate of collectOrderReferenceCandidates(value)) {
      out.add(candidate);
    }
  }
  return out;
}

export function buildOrderReferenceKey(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): string | null {
  const clientRef = canonicalizeOrderReference(params.clientOrderId, "client_or_cloid");
  if (clientRef?.kind === "client") return clientRef.key;
  const cloidRef = canonicalizeOrderReference(params.cloid, "cloid");
  if (cloidRef?.kind === "cloid") return cloidRef.key;
  if (clientRef?.kind === "cloid") return clientRef.key;
  const exchangeRef = canonicalizeOrderReference(params.exchangeOrderId, "exchange");
  if (exchangeRef?.kind === "cloid") return exchangeRef.key;
  if (exchangeRef?.kind === "order") return exchangeRef.key;
  return null;
}

export function buildOrderReferenceIdentity(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): {
  key: string | null;
  keys: string[];
  client: CanonicalOrderReference | null;
  exchange: CanonicalOrderReference | null;
  cloid: CanonicalOrderReference | null;
} {
  const client = canonicalizeOrderReference(params.clientOrderId, "client_or_cloid");
  const exchange = canonicalizeOrderReference(params.exchangeOrderId, "exchange");
  const cloid = canonicalizeOrderReference(params.cloid, "cloid");
  const keys = new Set<string>();
  if (client?.key) keys.add(client.key);
  if (exchange?.key) keys.add(exchange.key);
  if (cloid?.key) keys.add(cloid.key);
  return {
    key: buildOrderReferenceKey(params),
    keys: [...keys],
    client,
    exchange,
    cloid
  };
}

export function orderReferenceInputsMatch(
  left: {
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
    cloid?: string | null;
  },
  right: {
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
    cloid?: string | null;
  }
): boolean {
  const leftIdentity = buildOrderReferenceIdentity(left);
  const rightIdentity = buildOrderReferenceIdentity(right);
  if (leftIdentity.keys.length === 0 || rightIdentity.keys.length === 0) return false;
  const rightKeys = new Set<string>(rightIdentity.keys);
  for (const key of leftIdentity.keys) {
    if (rightKeys.has(key)) return true;
  }
  return false;
}

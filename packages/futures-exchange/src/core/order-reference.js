function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseScopedOrderReference(value) {
  const match = /^(cloid|corewriter):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return {
    prefix: match[1],
    asset: match[2] ?? "0",
    decimal: match[3] ?? ""
  };
}

export function normalizeCloid(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const scoped = parseScopedOrderReference(text);
  if (scoped) return scoped.decimal || null;
  if (/^\d+$/.test(text)) return text;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(text)) {
    try {
      return BigInt(text).toString(10);
    } catch {
      return text.toLowerCase();
    }
  }
  return null;
}

export function collectOrderReferenceCandidates(value) {
  const direct = normalizeText(value);
  if (!direct) return [];
  const out = new Set([direct]);
  const normalizedCloid = normalizeCloid(direct);
  const scoped = parseScopedOrderReference(direct);
  if (scoped) {
    // Keep legacy `corewriter:` refs interoperable with canonical `cloid:` storage.
    out.add(`cloid:${scoped.asset}:${scoped.decimal}`);
    out.add(`corewriter:${scoped.asset}:${scoped.decimal}`);
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
    return [...out];
  }
  return [...out];
}

export function collectOrderReferenceSet(values) {
  const out = new Set();
  for (const value of values) {
    for (const candidate of collectOrderReferenceCandidates(value)) {
      out.add(candidate);
    }
  }
  return out;
}

export function buildOrderReferenceKey(params) {
  const clientOrderId = normalizeText(params.clientOrderId);
  if (clientOrderId) return `client:${clientOrderId}`;
  const cloid = normalizeCloid(params.cloid ?? params.exchangeOrderId);
  if (cloid) return `cloid:${cloid}`;
  const exchangeOrderId = normalizeText(params.exchangeOrderId);
  if (exchangeOrderId) return `order:${exchangeOrderId}`;
  return null;
}

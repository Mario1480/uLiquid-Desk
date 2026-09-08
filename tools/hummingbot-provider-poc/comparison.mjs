function finite(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relativeDifference(left, right) {
  const a = finite(left);
  const b = finite(right);
  if (a === null || b === null) return null;
  const scale = Math.max(Math.abs(a), Math.abs(b), Number.EPSILON);
  return Math.abs(a - b) / scale;
}

function percentile(values, fraction) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function validLevel(value) {
  return Array.isArray(value)
    && value.length >= 2
    && finite(value[0]) !== null
    && finite(value[0]) > 0
    && finite(value[1]) !== null
    && finite(value[1]) > 0;
}

function validPublicSample(sample) {
  const bid = sample?.orderbook?.bids?.[0];
  const ask = sample?.orderbook?.asks?.[0];
  const fetchedAtMs = finite(sample?.fetchedAtMs);
  const durationMs = finite(sample?.durationMs);
  const tickerLast = finite(sample?.ticker?.last);
  const fundingRate = finite(sample?.funding?.rate);
  return Boolean(sample)
    && !sample.error
    && fetchedAtMs !== null
    && fetchedAtMs > 0
    && durationMs !== null
    && durationMs >= 0
    && tickerLast !== null
    && tickerLast > 0
    && validLevel(bid)
    && validLevel(ask)
    && bid[0] < ask[0]
    && fundingRate !== null;
}

export function summarizeProbe(probe) {
  const samples = Array.isArray(probe?.samples) ? probe.samples : [];
  const durations = samples.map((sample) => sample?.durationMs);
  return {
    providerId: String(probe?.providerId ?? "unknown"),
    status: String(probe?.status ?? "invalid"),
    samples: samples.length,
    successfulSamples: samples.filter(validPublicSample).length,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95),
    requestAttempts: finite(probe?.requestAttempts),
    limitations: Array.isArray(probe?.limitations) ? probe.limitations : []
  };
}

export function comparePublicProbes(nativeProbe, hummingbotProbe) {
  const nativeSymbol = String(nativeProbe?.symbol ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const hummingbotSymbol = String(hummingbotProbe?.symbol ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const inputsValid = nativeProbe?.schemaVersion === "1.0.0"
    && hummingbotProbe?.schemaVersion === "1.0.0"
    && nativeProbe?.providerId === "uliquid-native:bitget"
    && hummingbotProbe?.providerId === "hummingbot-poc:bitget-perpetual"
    && nativeProbe?.status === "observed"
    && hummingbotProbe?.status === "observed"
    && nativeProbe?.venue === "bitget"
    && hummingbotProbe?.venue === "bitget"
    && nativeProbe?.marketType === "perpetual"
    && hummingbotProbe?.marketType === "perpetual"
    && nativeSymbol.length > 0
    && nativeSymbol === hummingbotSymbol;
  const nativeSamples = inputsValid && Array.isArray(nativeProbe?.samples)
    ? nativeProbe.samples.filter(validPublicSample)
    : [];
  const hbSamples = inputsValid && Array.isArray(hummingbotProbe?.samples)
    ? hummingbotProbe.samples.filter(validPublicSample)
    : [];
  const paired = Math.min(nativeSamples.length, hbSamples.length);
  const observations = [];
  for (let index = 0; index < paired; index += 1) {
    const native = nativeSamples[index];
    const hb = hbSamples[index];
    observations.push({
      sequence: index + 1,
      observationSkewMs: Math.abs(Number(native?.fetchedAtMs ?? 0) - Number(hb?.fetchedAtMs ?? 0)),
      tickerLastRelativeDifference: relativeDifference(native?.ticker?.last, hb?.ticker?.last),
      bestBidRelativeDifference: relativeDifference(native?.orderbook?.bids?.[0]?.[0], hb?.orderbook?.bids?.[0]?.[0]),
      bestAskRelativeDifference: relativeDifference(native?.orderbook?.asks?.[0]?.[0], hb?.orderbook?.asks?.[0]?.[0]),
      fundingRateAbsoluteDifference: (() => {
        const left = finite(native?.funding?.rate);
        const right = finite(hb?.funding?.rate);
        return left === null || right === null ? null : Math.abs(left - right);
      })()
    });
  }
  return {
    schemaVersion: "1.0.0",
    venue: "bitget",
    marketType: "perpetual",
    symbol: nativeSymbol || hummingbotSymbol || "unknown",
    native: summarizeProbe(nativeProbe),
    hummingbot: summarizeProbe(hummingbotProbe),
    pairedSamples: paired,
    observations,
    decision: paired > 0 ? "public_comparison_observed" : "not_assessed",
    fullPocStatus: "not_assessed",
    integrityWarnings: inputsValid ? [] : ["probe_identity_or_status_invalid"]
  };
}

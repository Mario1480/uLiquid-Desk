import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicPositionAnalysis,
  buildPositionCopilotSnapshot,
  hashPositionCopilotSnapshot,
  shouldNotifyForPositionCopilot
} from "./core.js";

function perpSnapshot(overrides: Record<string, unknown> = {}) {
  return buildPositionCopilotSnapshot({
    exchangeAccountId: "acc_1",
    exchange: "bitget",
    marketType: "perp",
    symbol: "BTCUSDT",
    side: "long",
    size: 0.1,
    entryPrice: 65_000,
    markPrice: 64_000,
    unrealizedPnlUsd: -100,
    leverage: 5,
    marginMode: "isolated",
    marginUsd: 1_280,
    notionalUsd: 6_400,
    liquidationPrice: 61_000,
    liquidationDistancePct: 4.6875,
    roePct: -7.8,
    pnlPct: -1.56,
    stopLossPrice: 62_500,
    takeProfitPrice: 68_000,
    observedAt: "2026-08-02T12:00:00.000Z",
    ...overrides
  });
}

test("snapshot DTO drops secrets and unknown fields", () => {
  const snapshot = buildPositionCopilotSnapshot({
    ...perpSnapshot(),
    apiKey: "secret",
    apiSecret: "secret",
    passphrase: "secret",
    walletSeed: "secret"
  });
  assert.equal("apiKey" in snapshot, false);
  assert.equal("apiSecret" in snapshot, false);
  assert.equal("passphrase" in snapshot, false);
  assert.equal("walletSeed" in snapshot, false);
});

test("identical economic snapshot deduplicates despite observedAt changes", () => {
  const left = perpSnapshot({ observedAt: "2026-08-02T12:00:00.000Z" });
  const right = perpSnapshot({ observedAt: "2026-08-02T12:01:00.000Z" });
  assert.equal(hashPositionCopilotSnapshot(left), hashPositionCopilotSnapshot(right));
});

test("critical liquidation distance produces critical read-only analysis", () => {
  const analysis = buildDeterministicPositionAnalysis(perpSnapshot());
  assert.equal(analysis.riskLevel, "critical");
  assert.equal(analysis.readOnly, true);
  assert.ok(analysis.riskFactors.some((row) => row.code === "liquidation_distance_critical"));
});

test("BingX zero price is explicit, non-critical and distinct from missing data", () => {
  for (const side of ["long", "short"]) {
    const snapshot = perpSnapshot({ exchange: "bingx", side, liquidationPrice: "0.0", liquidationDistancePct: 0 });
    const analysis = buildDeterministicPositionAnalysis(snapshot);
    assert.equal(snapshot.liquidationPrice, 0);
    assert.equal(snapshot.liquidationDistancePct, null);
    assert.equal(snapshot.liquidationStatus, "no_liquidation_price");
    assert.equal(analysis.dataQuality.state, "complete");
    assert.notEqual(analysis.riskLevel, "critical");
    assert.ok(analysis.events.some(row => row.code === "no_liquidation_price"));
    assert.equal(analysis.riskFactors.some(row => row.code.startsWith("liquidation_distance")), false);
    assert.match(buildDeterministicPositionAnalysis(snapshot, new Date(), "de").events[0].message, /Kein Liquidationspreis/);
    assert.equal(shouldNotifyForPositionCopilot({ mode: "critical_only", analysis, now: new Date(), state: { previousSnapshotHash: null, previousRiskLevel: null, lastNotifiedAt: null } }).notify, false);
  }
});

test("missing numeric fields stay missing and unknown provider zero semantics remain degraded", () => {
  for (const value of [null, undefined, "", " ", NaN, Infinity, false]) {
    const snapshot = perpSnapshot({ liquidationPrice: value, liquidationDistancePct: value, pnlPct: value, roePct: value });
    assert.equal(snapshot.liquidationDistancePct, null);
    assert.equal(snapshot.pnlPct, null);
    assert.equal(snapshot.roePct, null);
    assert.equal(snapshot.liquidationStatus, "unavailable");
    const analysis = buildDeterministicPositionAnalysis(snapshot);
    assert.equal(analysis.dataQuality.state, "degraded");
    assert.ok(analysis.dataQuality.missingFields.includes("liquidationDistancePct"));
    assert.equal(analysis.events.some(row => row.code === "liquidation_proximity"), false);
  }
  const unverified = perpSnapshot({ exchange: "other", liquidationPrice: 0, liquidationDistancePct: null });
  assert.equal(unverified.liquidationStatus, "unavailable");
  assert.equal(buildDeterministicPositionAnalysis(unverified).dataQuality.state, "degraded");
});

test("zero price preserves other risk warnings and genuine zero distance remains critical", () => {
  const analysis = buildDeterministicPositionAnalysis(perpSnapshot({ exchange: "bingx", liquidationPrice: 0, liquidationDistancePct: null, roePct: -30, stopLossPrice: null }));
  assert.equal(analysis.riskLevel, "high");
  assert.ok(analysis.riskFactors.some(row => row.code === "drawdown_high"));
  assert.ok(analysis.riskFactors.some(row => row.code === "stop_loss_missing"));
  const stale = buildDeterministicPositionAnalysis(perpSnapshot({ exchange: "bingx", liquidationPrice: 0, liquidationDistancePct: null, dataDegraded: true }));
  assert.equal(stale.dataQuality.state, "degraded");
  assert.ok(stale.riskFactors.some(row => row.code === "data_quality_degraded"));
  assert.equal(buildDeterministicPositionAnalysis(perpSnapshot({ liquidationPrice: 64000, liquidationDistancePct: 0 })).riskLevel, "critical");
  assert.notEqual(hashPositionCopilotSnapshot(perpSnapshot({ exchange: "bingx", liquidationPrice: 0, liquidationDistancePct: null })), hashPositionCopilotSnapshot(perpSnapshot({ exchange: "bingx", liquidationPrice: null, liquidationDistancePct: null })));
});

test("deterministic fallback follows the requested German locale", () => {
  const analysis = buildDeterministicPositionAnalysis(perpSnapshot(), new Date("2026-08-02T12:00:00.000Z"), "de");
  assert.match(analysis.summary, /kritisches Positionsrisiko/i);
  assert.match(analysis.riskFactors[0]?.message ?? "", /Liquidationsdistanz/i);
});

test("spot snapshot does not require liquidation fields", () => {
  const snapshot = buildPositionCopilotSnapshot({
    exchangeAccountId: "acc_1",
    exchange: "bitget",
    marketType: "spot",
    symbol: "ETHUSDT",
    side: "long",
    size: 1,
    entryPrice: 3_000,
    markPrice: 3_050,
    notionalUsd: 3_050,
    pnlPct: 1.67,
    observedAt: "2026-08-02T12:00:00.000Z"
  });
  const analysis = buildDeterministicPositionAnalysis(snapshot);
  assert.equal(analysis.dataQuality.missingFields.includes("liquidationDistancePct"), false);
  assert.equal(snapshot.liquidationStatus, "not_applicable");
});

test("degraded snapshot exposes missing fields", () => {
  const analysis = buildDeterministicPositionAnalysis(perpSnapshot({ markPrice: null, dataDegraded: true }));
  assert.equal(analysis.dataQuality.state, "degraded");
  assert.ok(analysis.dataQuality.missingFields.includes("markPrice"));
});

test("trigger cooldown and duplicate snapshot suppress repeated important notifications", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const analysis = buildDeterministicPositionAnalysis(perpSnapshot(), now);
  const first = shouldNotifyForPositionCopilot({
    mode: "important_changes",
    analysis,
    state: { previousSnapshotHash: null, previousRiskLevel: null, lastNotifiedAt: null },
    now
  });
  assert.equal(first.notify, true);
  const second = shouldNotifyForPositionCopilot({
    mode: "important_changes",
    analysis,
    state: { previousSnapshotHash: analysis.snapshotHash, previousRiskLevel: analysis.riskLevel, lastNotifiedAt: now },
    now: new Date(now.getTime() + 60_000)
  });
  assert.deepEqual(second, { notify: false, reason: "cooldown_active" });
});

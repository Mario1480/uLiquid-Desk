import assert from "node:assert/strict";
import test from "node:test";
import { projectDecisionLogs } from "./decisionLogs.js";

const createdAt = new Date("2026-09-04T10:00:00.000Z");
const completedAt = new Date("2026-09-04T10:00:02.000Z");

test("projects an exact, redacted decision log with version provenance", () => {
  const items = projectDecisionLogs([{
    id: "run-1", status: "completed", createdAt, completedAt, modelClass: "analysis", latencyMs: 2000, errorCode: null,
    profileSnapshot: { baseProfileKey: "market_analyst", name: "Market Analyst", version: 2 },
    contextSnapshot: { symbol: "BTCUSDT", marketType: "perp", selectedVenue: "auto", selectedExchangeAccountId: "must-not-leak" },
    traceLogs: [{ parsedResponse: { assistantMessageId: "message-1" } }],
    toolCalls: [{ id: "tool-1", toolName: "market.get_funding_rate", status: "degraded", venue: "binance", durationMs: 14, errorCode: null, resultSummary: { sourceProvider: "binance-native", sourceVenue: "binance", observedAt: createdAt.toISOString(), fetchedAt: completedAt.toISOString(), ageMs: 2000, quality: "degraded", warnings: ["funding_interval_unavailable"], skillVersion: 2, outputSchemaId: "market.get_funding_rate.v2", routineVersions: [{ id: "derivatives.funding-snapshot.v1", version: "1.0.0" }] } }]
  }], [{ id: "message-1", role: "assistant", content: "Read-only recommendation", blocks: [{ type: "summary", text: "Wait" }], createdAt: completedAt }]);
  assert.equal(items[0]?.recommendation?.content, "Read-only recommendation");
  assert.equal(items[0]?.legacyAssociation, false);
  assert.equal(items[0]?.evidence[0]?.skillVersion, 2);
  assert.deepEqual(items[0]?.permission, { readOnly: true, execution: "not_permitted" });
  assert.equal(JSON.stringify(items).includes("must-not-leak"), false);
});

test("uses bounded legacy association and never fabricates failed recommendations", () => {
  const messages = [{ id: "legacy", role: "assistant", content: "Legacy", blocks: [], createdAt: new Date("2026-09-04T10:00:03.000Z") }];
  const base = { id: "run-legacy", createdAt, completedAt, modelClass: null, latencyMs: null, errorCode: null, profileSnapshot: {}, contextSnapshot: {}, traceLogs: [], toolCalls: [] };
  const completed = projectDecisionLogs([{ ...base, status: "completed" }], messages)[0];
  const failed = projectDecisionLogs([{ ...base, status: "failed", errorCode: "provider_failed" }], messages)[0];
  assert.equal(completed?.legacyAssociation, true);
  assert.equal(completed?.recommendation?.messageId, "legacy");
  assert.equal(failed?.recommendation, null);
  assert.equal(failed?.dataQuality.state, "unavailable");
});

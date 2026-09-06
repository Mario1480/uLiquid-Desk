import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_ROUTINES, AGENT_ROUTINE_IDS, executeAgentRoutine, routineVersionRefs } from "./registry.js";

test("routine registry exposes unique, versioned and schema-validated routines", () => {
  assert.equal(new Set(AGENT_ROUTINES.map((routine) => routine.id)).size, AGENT_ROUTINES.length);
  assert.deepEqual(routineVersionRefs([AGENT_ROUTINE_IDS.orderbookSnapshot]), [{ id: "orderbook.snapshot.v1", version: "1.0.0" }]);
  assert.equal(AGENT_ROUTINES.every((routine) => /^\d+\.\d+\.\d+$/.test(routine.version)), true);
});

test("routine execution validates inputs and outputs", () => {
  assert.throws(() => executeAgentRoutine(AGENT_ROUTINE_IDS.orderbookSnapshot, { bids: "invalid", asks: [] }));
  const result = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.fundingSnapshot, { rate: 0.0001, fundingIntervalHours: null });
  assert.equal(result.rateBps, 1);
});

test("versioned position routines validate and retain the no-price status", () => {
  const input = { exchange: "bingx", symbol: "FIXTUREUSDT", side: "long", size: 1, entryPrice: 100, markPrice: 100, liquidationPrice: 0, liquidationDistancePct: null };
  const snapshot = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionSnapshot, { input });
  assert.equal(snapshot.liquidationStatus, "no_liquidation_price");
  assert.equal(snapshot.liquidationPrice, 0);
  assert.equal(snapshot.liquidationDistancePct, null);
  const { analysis } = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionRisk, { input: snapshot });
  assert.notEqual(analysis.riskLevel, "critical");
  assert.equal(analysis.dataQuality.state, "complete");
  assert.deepEqual(routineVersionRefs([AGENT_ROUTINE_IDS.positionSnapshot, AGENT_ROUTINE_IDS.positionRisk]), [
    { id: "position.snapshot.v1", version: "1.1.0" }, { id: "position.risk.v1", version: "1.1.0" }
  ]);
});
